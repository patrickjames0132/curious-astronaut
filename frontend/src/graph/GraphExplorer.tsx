/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The graph exploration area: the canvas, its controls, the legend, and the
 * detail panel (plus its figure lightbox) — plus every piece of state only
 * they read (the `base` sim dataset, declutter filters, hover, selection,
 * canvas size).
 *
 * Store boundary (the Phase 6 state directive, drawn precisely here):
 *   READS  workspace.graph (to build `base`), workspace discoveries (merged
 *          into the sim in place as they arrive), workspace.layout, and the
 *          highlight ids the teacher lights up.
 *   OWNS   everything mutable/sim-side — `base` keeps object identity for a
 *          graph's whole life; react-force-graph mutates its objects, which
 *          is exactly why none of this may live in Redux.
 *
 * `children` renders inside the canvas wrap — the shell drops its overlays
 * (hit list, loading/error/hint) there without this component knowing them.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { threadEdited } from '../store/explorations'
import {
  discoveryMerged,
  expansionUndone,
  graphFocusRequested,
  viewFiltersSet,
} from '../store/workspace'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { expandPaper, generateTldr } from '../api'
import type { AnswerFigure, ExpandHop } from '../api'
import type { ExpansionStatus } from '../detail/DetailPanel'
import { useAppDispatch, useAppSelector } from '../store'
import { highlightSet, selectHighlightSet } from '../store/highlight'
import {
  layoutSet,
  loadGraph,
  nodeSelectionAdded,
  nodeSelectionCleared,
  nodeSelectionToggled,
  selectNodeSelectionSet,
  selectWorkspace,
  visibleNodesSet,
} from '../store/workspace'
import { useSelection } from '../detail/useSelection'
import { usePresence } from '../ui/usePresence'
import DetailPanel from '../detail/DetailPanel'
import Lightbox from '../figures/Lightbox'
import GraphCanvas from './canvas/GraphCanvas'
import FindBar from './controls/FindBar'
import GraphControls from './controls/GraphControls'
import Legend from './controls/Legend'
import { useBuildShape } from './buildShape'
import { CHIP_TYPES, REL_TYPES } from './theme'
import { deriveOrigins } from './clusterForce'
import { hopAdded, withoutHop } from './expansions'
import { linkKey, useDiscovery } from './hooks/useDiscovery'
import { useCameraChase } from './hooks/useCameraChase'
import { useEscapeClear } from './hooks/useEscapeClear'
import { useMarquee } from './hooks/useMarquee'
import { usePaperLinks } from './hooks/usePaperLinks'
import { usePinning } from './hooks/usePinning'
import { useTimeline } from './hooks/useTimeline'
import {
  CITE_SLIDER_STEPS,
  betweenLinkType,
  citationWindow,
  findMatches,
  focusAnchor,
  focusOf,
  type Base,
  type VLink,
  type VNode,
} from './model'

/**
 * Render the graph area: canvas + controls + legend + detail panel, plus the
 * shell's overlays as `children`. `tourStage` is the guided tour's staging
 * signal: when it asks for `'details'` and nothing is selected, the seed is
 * selected so the detail-panel stops have a panel to walk, and `'controls'`
 * passes down to GraphControls to expand a collapsed panel (the selection
 * and the expansion both stay after — a tour that tidies up behind itself
 * would be jarring).
 *
 * @returns The graph exploration area.
 */
/**
 * The citation-source note: tells the user which citation source backs an s2
 * graph's citers, or null when it doesn't apply (OpenAlex returns its citers
 * server-sorted; no graph yet means nothing to annotate).
 *
 * @param provider        The active data provider.
 * @param citationSource  Where the s2 graph's citers came from ('corpus' full
 *                        history, or 'live' recency-biased), when known.
 * @returns The note text, or null when no note should show.
 */
function citationNote(
  provider: 's2' | 'openalex',
  citationSource: 'corpus' | 'live' | null | undefined,
): string | null {
  if (provider !== 's2') return null
  if (citationSource === 'corpus') {
    return 'Semantic Scholar: citations are drawn from the offline citations corpus — the full citation history, ranked by citation count.'
  }
  return 'Semantic Scholar: the most-cited citers here are the top-cited among the ~10k most recent (live-API limit), not the full citation history — the citations corpus will lift this.'
}

export default function GraphExplorer({
  children,
  tourStage,
}: {
  children?: ReactNode
  tourStage?: string
}) {
  const dispatch = useAppDispatch()
  const { graph, discoveredNodes, discoveredEdges, layout, loading, seedRef, provider } =
    useAppSelector(selectWorkspace)
  const savedFilters = useAppSelector((state) => state.workspace.viewFilters)
  const initialFilters = useRef(savedFilters)
  const highlightIds = useAppSelector(selectHighlightSet)
  // The teacher's scope — the reader's pick, or the one a message chose
  // (`send` makes it the selection). It sits ABOVE the filters (see
  // `scope/resolve.ts`), so a selected paper the filters would hide is drawn
  // anyway, marked — the view shows what the agent is reasoning over, and a
  // filter is a lens, not a retraction of a pick or an ask.
  const selectedIds = useAppSelector(selectNodeSelectionSet)

  // Declutter controls, one chip per relation. Two relations used to be held
  // on unconditionally here — `search` and `similar` — because they had no
  // chip of their own; neither can be created any more (v7.3.0, v7.5.0), so a
  // node still carrying one comes from a session saved before that and is
  // shown via the edge-less branch in `nodeOk` below.
  const [enabled, setEnabled] = useState<Set<string>>(new Set(CHIP_TYPES))
  // The Surveys chip: on rings the surveys and reviews orange, off (the
  // default) leaves them looking like any paper. It marks, it never hides: a
  // survey is drawn either way, so it isn't a member of `enabled` (whose
  // chips decide what's drawn) and it never touches the default scope.
  const [surveyRings, setSurveyRings] = useState(initialFilters.current?.surveys ?? false)
  const [yearLo, setYearLo] = useState(0)
  const [yearHi, setYearHi] = useState(0)
  // The citation-count window's knob positions (0…CITE_SLIDER_STEPS). Full-open
  // by default (show every paper); a display filter over the already
  // citation-budgeted pool the backend ships — see `citationThreshold`.
  const [citeLo, setCiteLo] = useState(0)
  const [citeHi, setCiteHi] = useState(CITE_SLIDER_STEPS)
  // Per-relation display caps: how many papers of each relation to show, most-
  // cited first. A missing key means "all of them", which is every relation
  // until the user drags a slider. These only exist while the build is
  // user-sized — an adaptive build is already trimmed by the backend's own
  // rules, and stacking a second trim on top of it is the clutter the adaptive
  // sizing exists to avoid.
  const [relCaps, setRelCaps] = useState<Record<string, number>>(
    initialFilters.current?.relCaps ?? {},
  )
  // The interconnected-links button: the citations among the papers on the
  // graph, painted under it (see hooks/usePaperLinks.ts).
  const [showLinks, setShowLinks] = useState(initialFilters.current?.links ?? false)
  // The links between papers are a Force feature: Timeline's x is the date,
  // so there's no room to pull linked papers together without breaking the
  // time series. The links keep their setting across a trip to Timeline.
  const linksActive = showLinks && layout === 'force'
  // Bumped by the button to re-ask after a failed lookup.
  const [linksAttempt, setLinksAttempt] = useState(0)
  // The graph is still settling around a change to the links (shown, hidden,
  // or refreshed after an expansion): the button spins until the sim stops,
  // so the links arrive with visible progress, not all at once from nowhere.
  const [linksSettling, setLinksSettling] = useState(false)
  // Each paper's Expand buttons, by paper then hop, as far as this session
  // knows: in flight, just done, just undone, or failed. Cleared with every
  // new graph; a hop's lasting ✓ is read off the discovery lists instead
  // (`expansionOf`).
  const [expansions, setExpansions] = useState<
    Record<string, Partial<Record<ExpandHop, ExpansionStatus>>>
  >({})
  const buildShape = useBuildShape()
  const capsActive = !buildShape.adaptive
  const [hoverId, setHoverId] = useState<string | null>(null)
  // The local find (the floating bottom-right FindBar): spotlights on-screen
  // papers by title/author substring. Purely lexical — no API call.
  const [findQuery, setFindQuery] = useState('')
  // The detail panel's figures, enlarged full-screen (same lightbox the
  // teacher's answer figures use).
  const [lightbox, setLightbox] = useState<AnswerFigure | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  /** One-shot latch: zoomToFit runs once per graph/layout, on engine stop. */
  const fitDone = useRef(false)

  // Track the canvas container's size so ForceGraph2D always fills it.
  useEffect(() => {
    if (!wrapRef.current) return
    const el = wrapRef.current
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /**
   * Stable per-graph node/link objects. react-force-graph mutates these (adds
   * x/y, resolves source/target), and pins set fx/fy on them — so they MUST
   * survive filter changes. Rebuilt only when a new graph loads.
   */
  const base = useMemo<Base | null>(() => {
    if (!graph) return null
    fitDone.current = false
    const nodes: VNode[] = graph.nodes.map((node) => ({ ...node }))
    const links: VLink[] = graph.edges.map((edge) => ({
      ...edge,
      _s: edge.source,
      _t: edge.target,
    }))
    // A restored session's discoveries arrive folded into the graph itself —
    // re-derive their expansion origins so the satellites re-form (live
    // discoveries get stamped by useDiscovery's merge instead).
    deriveOrigins(nodes, links, graph.seed.id)
    const years = nodes
      .map((node) => node.year)
      .filter((year): year is number => typeof year === 'number')
    const counts: Record<string, number> = { reference: 0, citation: 0 }
    nodes.forEach((node) =>
      node.rels.forEach((rel) => {
        if (rel in counts) counts[rel]++
      }),
    )
    // The citation slider's bounds ignore the seed — it's fixed-large and always
    // shown, so it shouldn't stretch the scale the neighbors filter on. Spanning
    // the real min…max (like the year slider) keeps both knobs live.
    const neighborCitations = nodes
      .filter((node) => !node.is_seed)
      .map((node) => node.citation_count ?? 0)
    const minCitations = neighborCitations.length ? Math.min(...neighborCitations) : 0
    const maxCitations = neighborCitations.length ? Math.max(...neighborCitations) : 0
    return {
      nodes,
      links,
      minYear: years.length ? Math.min(...years) : 0,
      maxYear: years.length ? Math.max(...years) : 0,
      counts,
      minCitations,
      maxCitations,
    }
  }, [graph])

  // Reset the declutter controls whenever a new graph loads. (Selection and
  // pins reset themselves inside their own hooks.)
  useEffect(() => {
    if (!base) return
    setEnabled(new Set(initialFilters.current?.enabled ?? CHIP_TYPES))
    setYearLo(initialFilters.current?.yearLo ?? base.minYear)
    setYearHi(initialFilters.current?.yearHi ?? base.maxYear)
    // A fresh graph shows every citation count; the user narrows from there.
    setCiteLo(initialFilters.current?.citeLo ?? 0)
    setCiteHi(initialFilters.current?.citeHi ?? CITE_SLIDER_STEPS)
    setShowLinks(initialFilters.current?.links ?? false)
    setSurveyRings(initialFilters.current?.surveys ?? false)
    setExpansions({})
    setHoverId(null)
  }, [base])

  useEffect(() => {
    if (!base || yearHi === 0) return
    dispatch(
      viewFiltersSet({
        enabled: [...enabled],
        yearLo,
        yearHi,
        citeLo,
        citeHi,
        relCaps,
        links: showLinks,
        surveys: surveyRings,
      }),
    )
  }, [base, enabled, yearLo, yearHi, citeLo, citeHi, relCaps, showLinks, surveyRings, dispatch])

  // Timeline layout physics (year-column pinning, collide force, year axis,
  // settle-freeze) — plus its keep-in-sync effects.
  const { nodeTimelineX, applyLayoutPhysics, drawAxis, freezeSettledY } = useTimeline({
    base,
    layout,
    connected: linksActive,
    fgRef,
    size,
    fitDone,
    yearLo,
    yearHi,
  })

  // User pins: drag-to-pin, the detail panel's Pin button, Release-all.
  // The held focus's papers, for the group drag (set below, once known).
  const heldFocus = useRef<Set<string> | null>(null)
  const { pinned, clearPins, onNodeDrag, onNodeDragEnd, releaseHeld, togglePin, releaseAll } =
    usePinning({
      base,
      layout,
      nodeTimelineX,
      fgRef,
      selectedIds,
      visibleIds: heldFocus,
    })

  const doLoadGraph = useCallback(
    (seed: string) => {
      dispatch(loadGraph({ seed }))
    },
    [dispatch],
  )

  /**
   * Re-fetch the current seed bypassing the server's day-cached snapshot,
   * busting the exact cache entry (`graph:{seedRef}`) so a paper whose S2 data
   * changed mid-session picks up the new neighborhood on demand.
   */
  const onRefresh = useCallback(() => {
    if (seedRef) dispatch(loadGraph({ seed: seedRef, refresh: true }))
  }, [dispatch, seedRef])

  // A quick double-click re-seeds the whole graph on the paper (back in
  // v8.33.0; see `useSelection`), as the panel's "Explore in a thread" does.
  const onDoubleClick = useCallback(
    (node: VNode) => {
      if (!node.is_seed) doLoadGraph(node.id)
    },
    [doLoadGraph],
  )

  // Selection: the open detail panel, its hydration + figures + code links +
  // category tags.
  const {
    selectedId,
    setSelectedId,
    selected,
    detailLoading,
    figures,
    codeLinks,
    categories,
    onNodeClick,
    mergeDetail,
  } = useSelection({ base, graph, provider, onDoubleClick })
  // The detail panel slides out rather than vanishing (ui/usePresence). The
  // selection is already null by then, so the exit shows the last paper that
  // was actually in the panel.
  const detailPanel = usePresence(!!selected)
  const lastSelected = useRef(selected)
  if (selected) lastSelected.current = selected
  const shownNode = selected ?? lastSelected.current

  // The guided tour's detail-panel stops: when the tour stages 'details' and
  // nothing is selected (the user ✕'d the panel), select the seed so the
  // walk has a panel to spotlight.
  useEffect(() => {
    if (tourStage === 'details' && !selectedId && graph) setSelectedId(graph.seed.id)
  }, [tourStage, selectedId, graph, setSelectedId])

  // "Show in Citation Graph" from the Reader's citation card (v8.43.0) and
  // Peer Reviews: select the paper and centre it once the layout has placed
  // it (a graph just built hasn't yet). Cleared either way, so it acts once.
  // The paper may not be on the canvas yet either: Peer Reviews adds a citer
  // the graph lacks as a discovery, which the discovery effect below pushes
  // into `base` after this one runs, so the node is looked for until placed.
  const focusRequest = useAppSelector((state) => state.workspace.focusRequest)
  useEffect(() => {
    if (!focusRequest || !base) return
    dispatch(graphFocusRequested(null))
    // Not cancelled when the request clears (that's this effect's own
    // dispatch); it gives up after two seconds, and a gone canvas is a no-op.
    const started = performance.now()
    let selected = false
    const centre = () => {
      const node = base.nodes.find((candidate) => candidate.id === focusRequest)
      if (node && !selected) {
        selected = true
        if (node.id !== selectedId) onNodeClick(node)
      }
      if (node?.x !== undefined && node.y !== undefined)
        fgRef.current?.centerAt(node.x, node.y, 600)
      else if (performance.now() - started < 2000) requestAnimationFrame(centre)
    }
    centre()
    // Acts on the request alone, not on every selection change after it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest, base])

  // A graph opened from a chat citation used to land with its seed's detail
  // panel already open, on the theory that the click asked to see that paper.
  // It doesn't (v7.11.0): what the click asks for is the *map* around the
  // paper, and the panel arrived on top of the graph the moment it appeared —
  // covering the one thing the reader was waiting to see. Clicking the seed
  // opens it, like any other node.

  /**
   * Canvas click: a shift-click toggles the node in the hand-picked
   * selection without opening anything; a plain click falls through to the
   * usual select (which also holds its links in focus), and centres the
   * paper in view (v8.21.0, as the Knowledge Graph does): a
   * pan, no zoom change. A click on the paper already open closes its panel
   * and lets go of the focus, and a quick double-click re-seeds on the paper
   * (`useSelection`).
   */
  const onCanvasNodeClick = useCallback(
    (node: VNode, event?: MouseEvent) => {
      if (event?.shiftKey) {
        dispatch(nodeSelectionToggled(node.id))
        return
      }
      // Centre only what opens: a click on the open paper closes it.
      const opening = node.id !== selectedId
      onNodeClick(node)
      if (opening && node.x !== undefined && node.y !== undefined)
        fgRef.current?.centerAt(node.x, node.y, 600)
    },
    [dispatch, onNodeClick, selectedId],
  )

  // The sim-side discovery merge. The discovery LISTS live in the store (the
  // teacher dispatches them); this effect feeds them into the in-place merge,
  // whose internal dedupe makes re-feeding the full arrays safe.
  const { graphVersion, onDiscover, onPrune } = useDiscovery({
    base,
    layout,
    pinned,
    nodeTimelineX,
    fgRef,
    onYearLo: setYearLo,
    onYearHi: setYearHi,
  })
  useEffect(() => {
    // Prune first: an undone Expand hop shrinks the lists (v8.18.0), and the
    // sim has to let go of what they no longer hold.
    if (graph) {
      onPrune(
        new Set([...graph.nodes, ...discoveredNodes].map((node) => node.id)),
        new Set(
          [...graph.edges, ...discoveredEdges].map((edge) =>
            linkKey(edge.source, edge.target, edge.type),
          ),
        ),
      )
    }
    if (discoveredNodes.length || discoveredEdges.length)
      onDiscover(discoveredNodes, discoveredEdges)
  }, [graph, discoveredNodes, discoveredEdges, onDiscover, onPrune])

  const paperLinks = usePaperLinks({
    base,
    graphVersion,
    provider,
    on: linksActive,
    attempt: linksAttempt,
  })
  // Any change to the drawn links reheats the graph: busy until it settles.
  const lastLinks = useRef(paperLinks.links)
  useEffect(() => {
    if (lastLinks.current === paperLinks.links) return
    lastLinks.current = paperLinks.links
    setLinksSettling(true)
  }, [paperLinks.links])
  const linksBusy = (linksActive && paperLinks.status === 'loading') || linksSettling

  // A refit an expansion asked for waits for the merge: re-arming the one-shot
  // fit at the click would spend it on whichever run ends next, which while
  // the graph is still settling is the run *before* the group moved out.
  // The merge bumps graphVersion and reheats, so the next stop is its own.
  const refitOnGrowth = useRef(false)
  useEffect(() => {
    if (!refitOnGrowth.current) return
    refitOnGrowth.current = false
    fitDone.current = false
  }, [graphVersion])

  /**
   * Expand a paper by one hop from the detail panel (v8.18.0). What comes
   * back merges exactly like a researcher discovery: into the store's
   * discovery lists, so it is drawn, saved with the thread, and in the
   * assistant's scope like any other paper on the graph.
   */
  const expand = useCallback(
    async (nodeId: string, hop: ExpandHop) => {
      if (!base) return
      const mark = (status: ExpansionStatus) =>
        setExpansions((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], [hop]: status } }))
      mark({ state: 'busy' })
      try {
        const grown = await expandPaper(
          nodeId,
          hop,
          provider,
          base.nodes.map((node) => node.id),
          base.nodes.find((node) => node.id === nodeId)?.arxiv_id ?? null,
        )
        // The reader asked for this one, so once it settles, refit the camera
        // to take in the group it formed out past the seed's formation. (A
        // researcher discovery leaves the camera alone: the reader may be
        // reading, not looking at the graph.) Armed before the dispatch: the
        // store re-renders synchronously, so the merge has already run by the
        // time the dispatch returns.
        if (grown.nodes.length) refitOnGrowth.current = true
        dispatch(discoveryMerged(grown))
        dispatch(threadEdited())
        mark({ state: 'done', added: grown.nodes.length, fresh: true })
      } catch (error) {
        mark({ state: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    },
    [base, provider, dispatch],
  )

  /**
   * Undo one of a paper's Expand hops (v8.18.0): the reader reclicked its ✓.
   * Its papers leave the graph unless something else still links them.
   */
  const unexpand = useCallback(
    (nodeId: string, hop: ExpandHop) => {
      if (!graph) return
      const remaining = withoutHop(nodeId, hop, graph, discoveredNodes, discoveredEdges)
      dispatch(expansionUndone({ nodeId, hop }))
      dispatch(threadEdited())
      setExpansions((prev) => ({
        ...prev,
        [nodeId]: {
          ...prev[nodeId],
          [hop]: { state: 'removed', removed: discoveredNodes.length - remaining.nodes.length },
        },
      }))
    },
    [graph, discoveredNodes, discoveredEdges, dispatch],
  )

  /**
   * The papers an Expand hop has run on, read off the discovery lists like
   * the hops' ✓: drawn pink, so the paper an expansion grew from stands out
   * from what it brought. The seed is never one: the build is its expansion.
   */
  const expandedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const edge of discoveredEdges) {
      ids.add(edge.type === 'reference' ? edge.source : edge.target)
    }
    if (graph) ids.delete(graph.seed.id)
    return ids
  }, [discoveredEdges, graph])

  /**
   * Where each of a paper's Expand hops stands. A hop's ✓ is read off the
   * discovery lists, which are saved with the thread, so it survives a
   * reload; what's in flight, what failed, and what was just undone live
   * only in this session's state.
   */
  const expansionOf = useCallback(
    (nodeId: string): Partial<Record<ExpandHop, ExpansionStatus>> => {
      const local = expansions[nodeId] ?? {}
      const out: Partial<Record<ExpandHop, ExpansionStatus>> = {}
      for (const hop of ['references', 'citations'] as const) {
        const status = local[hop]
        const added = hopAdded(nodeId, hop, discoveredNodes, discoveredEdges)
        if (status?.state === 'busy' || status?.state === 'error') out[hop] = status
        else if (added !== null)
          out[hop] = { state: 'done', added, fresh: status?.state === 'done' && status.fresh }
        // A hop that came back empty has nothing to read back, so its local
        // status is all there is; so is one just undone.
        else if (status) out[hop] = status
      }
      return out
    },
    [expansions, discoveredNodes, discoveredEdges],
  )

  /**
   * The filtered view the canvas renders. Nodes keep their identity (so
   * positions/pins persist); links are copied with source/target reset to ids
   * so RFG re-resolves cleanly.
   */
  /**
   * Each relation's papers ranked most-cited first, as `id -> rank`, plus how
   * many it holds — what the per-chip count sliders bound and trim against.
   *
   * Ranked over `base`, not the filtered view, so dragging the year slider
   * doesn't silently renumber what "top 20 landmarks" means. Most-cited first
   * mirrors how the backend ranks each relation, so the slider trims the tail
   * the same way the adaptive budget would have.
   */
  const { relRank, relTotals } = useMemo(() => {
    const rank = new Map<string, Map<string, number>>()
    const totals: Record<string, number> = {}
    if (!base) return { relRank: rank, relTotals: totals }
    for (const type of REL_TYPES) {
      const members = base.nodes
        .filter((node) => !node.is_seed && node.rels.includes(type))
        .sort((one, other) => (other.citation_count ?? 0) - (one.citation_count ?? 0))
      rank.set(type, new Map(members.map((node, index) => [node.id, index])))
      totals[type] = members.length
    }
    return { relRank: rank, relTotals: totals }
  }, [base])

  const view = useMemo(() => {
    if (!base) {
      return {
        nodes: [] as VNode[],
        links: [] as VLink[],
        eligibleIds: new Set<string>(),
        ghostIds: new Set<string>(),
      }
    }
    // The citation window a neighbor must fall inside (0…maxCitations = filter
    // off). The backend already ranks by citations and caps the pool; this is a
    // live display trim on top of it.
    // A knob at rest bounds nothing (see `citationWindow`).
    const [citeMin, citeMax] = citationWindow(citeLo, citeHi, base.minCitations, base.maxCitations)
    // An edge is allowed when its relation chip is toggled on. Node-type
    // filtering lives entirely in the chips; the citation slider trims by
    // magnitude on the node side below.
    const linkOk = (link: VLink) => enabled.has(link.type)
    // A neighbor is shown when at least one enabled edge reaches it; the seed is
    // always shown. Nodes reached only via a hidden relation drop out — that's
    // how a chip trims the graph, dedupe-safe (a paper kept by its reference
    // edge stays even if its similar relation is hidden). `linked` tracks nodes
    // with ANY edge, so a genuinely edge-less node (an ungrounded topic-search
    // hit) can be told apart from one hidden by its relation.
    const reachable = new Set<string>()
    const linked = new Set<string>()
    base.links.forEach((link) => {
      linked.add(link._s)
      linked.add(link._t)
      if (linkOk(link)) {
        reachable.add(link._s)
        reachable.add(link._t)
      }
    })
    const nodeOk = (node: VNode) => {
      // The seed has its own chip since v7.17.0 — it used to be unconditionally
      // shown, which made it the one paper a reader could not scope out of a
      // lecture. Still exempt from the year and citation sliders below: those
      // trim a *population* of neighbours, and the seed isn't part of one.
      if (node.is_seed) return enabled.has('seed')
      // Timeline is a time axis: placing a paper on it claims a publication
      // date, and an undated paper gives us none to claim. They used to be
      // parked on the seed's column, which drew them as a vertical bar through
      // the seed — so Timeline hides them and Force (where x means nothing)
      // still shows them.
      if (layout === 'timeline' && typeof node.year !== 'number') return false
      if (typeof node.year === 'number' && (node.year < yearLo || node.year > yearHi)) return false
      const citations = node.citation_count ?? 0
      if (citations < citeMin || citations > citeMax) return false
      if (reachable.has(node.id)) return true
      // An edge-less node has no relation chip that could hide it, so the
      // chips don't get to: show it, and let the year and citation sliders
      // above do the trimming. Nothing can create one any more (the edge-less
      // `search` hits went in v7.3.0), so in practice this is a paper from a
      // session saved before then — drawn grey via `primaryRel`'s `unknown`
      // rather than silently dropped. A node that HAS edges but none enabled
      // is a different case and stays hidden, below.
      if (!linked.has(node.id)) return true
      return false
    }
    const filtered = base.nodes.filter(nodeOk)
    // PER-RELATION COUNT CAPS — the sliders that exist only while the build is
    // user-sized (adaptive off). Non-adaptive builds ship everything up to the
    // payload guard, so this is where the user trims it back to something
    // readable. A node survives when it ranks inside the cap of at least ONE of
    // its enabled relations, mirroring the reachability rule above: a paper
    // that's both a top reference and a mid-ranked landmark keeps the slot its
    // best relation earns it.
    const eligible = capsActive
      ? filtered.filter((node) => {
          const capped = node.rels.filter((rel) => enabled.has(rel) && relCaps[rel] !== undefined)
          // No capped relation applies (or it's the seed) — nothing to trim by.
          if (node.is_seed || capped.length === 0) return true
          return capped.some((rel) => (relRank.get(rel)?.get(node.id) ?? 0) < relCaps[rel])
        })
      : filtered
    // ELIGIBILITY vs DRAWING. `eligible` is what the filters admit, and it is
    // what gets published as the default scope. On top of it the canvas also
    // draws every scoped paper the filters would hide (`ghosts`) — a selected
    // paper after a slider change, "the references" with the references chip
    // off — because the scope outranks the filters and the reader should see
    // what the agent is reasoning over. Kept apart on purpose: if the drawn
    // set were published, a paper shown only because it was asked for would
    // leak into the default scope of the next, unscoped question.
    const eligibleIds = new Set(eligible.map((node) => node.id))
    const ghosts = base.nodes.filter(
      (node) => selectedIds.has(node.id) && !eligibleIds.has(node.id),
    )
    const nodes = [...eligible, ...ghosts]
    const ids = new Set(nodes.map((node) => node.id))
    const ghostIds = new Set(ghosts.map((node) => node.id))
    // A ghost keeps its edges even when their chip is off, or it would float
    // unattached — the chip hid the relation, the scope brought it back.
    const ghostLink = (link: VLink) => ghostIds.has(link._s) || ghostIds.has(link._t)
    const links: VLink[] = base.links
      .filter((link) => (linkOk(link) || ghostLink(link)) && ids.has(link._s) && ids.has(link._t))
      .map((link) => ({ ...link, source: link._s, target: link._t }))
    // The links between papers (v8.18.0), while they are shown: real links
    // in the simulation, so they shape the layout the way Connected Papers'
    // do, coloured by the citing paper's relation (`betweenLinkType`). They
    // live only here, never in `base.links`: they aren't saved, and they never
    // make a paper reachable for the chips above. Drawn when both papers are.
    const byId = new Map(nodes.map((node) => [node.id, node]))
    // A citation the graph already draws (every seed edge, and an expansion's)
    // comes back from the links too; drawing it twice would pull twice.
    const drawn = new Set(base.links.map((link) => `${link._s}|${link._t}`))
    paperLinks.links.forEach((link) => {
      const citing = byId.get(link.source)
      const cited = byId.get(link.target)
      if (!citing || !cited || drawn.has(`${link.source}|${link.target}`)) return
      links.push({
        source: link.source,
        target: link.target,
        _s: link.source,
        _t: link.target,
        type: betweenLinkType(citing, cited),
        influential: null,
        _between: true,
      })
    })
    return { nodes, links, eligibleIds, ghostIds }
    // graphVersion isn't read directly — it's a signal that base.nodes/links
    // were mutated in place (discoveries) and this must recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    base,
    enabled,
    layout,
    yearLo,
    yearHi,
    citeLo,
    citeHi,
    graphVersion,
    capsActive,
    relCaps,
    relRank,
    selectedIds,
    paperLinks.links,
  ])

  // Publish the filter-passing ids — the default scope (`selectScope`) — not
  // the drawn set, which also holds the ghosts. Fires whenever the filters
  // change; consumers re-render only when the id set actually differs.
  useEffect(() => {
    dispatch(visibleNodesSet([...view.eligibleIds]))
  }, [view, dispatch])

  // Alt-drag marquee selection: arms while Alt is held, captures the drag on an
  // overlay so RFG never pans, and commits the enclosed nodes to the selection.
  const marquee = useMarquee({ view, fgRef, wrapRef })

  /** Drop every active highlight at once — the hand-picked selection, the
   * teacher's lit papers (whose beat/answer/ref marks follow the emptied
   * highlight; see useConversation), AND the local find. One gesture,
   * wherever the light came from. */
  const onClearAll = useCallback(() => {
    dispatch(nodeSelectionCleared())
    dispatch(highlightSet([]))
    setFindQuery('')
  }, [dispatch])
  // Esc, in two steps (v8.22.0, Patrick): the first press does the same
  // reset, and once nothing is lit, the next closes the focused paper's
  // panel, letting go of its focus. One press used to drop both, so clearing
  // a selection also lost the paper it had been picked around. Not while an
  // overlay owns the key: the lightbox and the tour both close on their own
  // Esc, and clearing the graph underneath them would be a surprise.
  const anythingLit = selectedIds.size > 0 || highlightIds.size > 0 || findQuery !== ''
  useEscapeClear(
    useCallback(() => {
      if (lightbox || tourStage) return
      if (anythingLit) onClearAll()
      else setSelectedId(null)
    }, [lightbox, tourStage, anythingLit, onClearAll, setSelectedId]),
  )

  /**
   * A paper and everything linked to it: the links between papers count
   * while they're shown.
   */
  const neighboursOf = useCallback(
    (id: string) => {
      const neighbors = new Set<string>([id])
      base?.links.forEach((link) => {
        if (link._s === id) neighbors.add(link._t)
        if (link._t === id) neighbors.add(link._s)
      })
      paperLinks.links.forEach((link) => {
        if (link.source === id) neighbors.add(link.target)
        if (link.target === id) neighbors.add(link.source)
      })
      return neighbors
    },
    // graphVersion: base.links grows in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, graphVersion, paperLinks.links],
  )

  /** Neighbors of the hovered node (for focus-on-hover dimming). */
  const hoverSet = useMemo(
    () => (base && hoverId ? neighboursOf(hoverId) : null),
    [base, hoverId, neighboursOf],
  )

  /** Neighbors of the paper open in the detail panel, held while it stays
   *  open (v8.21.0; a ⌘-click held them from v8.18.0's polish). Hover focus
   *  only shows while the pointer is on a paper, which made the linked papers
   *  impossible to reach: they dimmed the moment it left. Holding them on the
   *  click that opens the panel means no modifier to learn; closing the panel
   *  (✕, Esc) lets go. Gone with its paper (an undone expansion). */
  const heldSet = useMemo(
    () =>
      base && selectedId && base.nodes.some((node) => node.id === selectedId)
        ? neighboursOf(selectedId)
        : null,
    // graphVersion: base.nodes changes in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, selectedId, neighboursOf, graphVersion],
  )
  heldFocus.current = heldSet

  /** The local find's matches over the VISIBLE view (hidden papers can't
   * match invisibly), or null when the box is empty. */
  const findSet = useMemo(() => findMatches(view.nodes, findQuery), [view, findQuery])

  // A new graph starts with an empty find box — a query about the old
  // neighborhood has nothing honest to match against the new one.
  useEffect(() => {
    setFindQuery('')
  }, [base])

  /** What the canvas lights up: an active find takes the highlight machinery
   * over from the teacher (glow + labels on matches — clearing the box hands
   * it back). */
  const litSet = useMemo(() => findSet ?? highlightIds, [findSet, highlightIds])

  /** The find pill's one-press select: commit every current match to the
   * hand-picked teacher scope (additive, like the marquee) and clear the
   * find, so the cyan selection — not the find spotlight — shows the result. */
  const onFindSelectAll = useCallback(() => {
    if (!findSet || findSet.size === 0) return
    dispatch(nodeSelectionAdded([...findSet]))
    setFindQuery('')
  }, [dispatch, findSet])

  /** What to focus the canvas on, by `model.focusOf`'s priority: the find,
   * hover over one of the held papers, the open paper's held focus, hover,
   * then the teacher's papers. */
  const focusSet = useMemo(
    () =>
      focusOf({
        find: findSet,
        held: heldSet,
        hover: hoverSet,
        hoverId,
        highlights: highlightIds,
      }),
    [heldSet, hoverSet, hoverId, findSet, highlightIds],
  )
  /** Whose point of view the edges are coloured from: the paper that focus
   * is centred on (`model.focusAnchor`), the seed's when null. */
  const anchorId = useMemo(
    () =>
      focusAnchor({
        find: findSet,
        held: heldSet,
        heldId: selectedId,
        hover: hoverSet,
        hoverId,
      }),
    [findSet, heldSet, selectedId, hoverSet, hoverId],
  )

  // Whether a survey ring is on screen: the legend names it only then (the
  // seed never wears one, so it doesn't count).
  const hasSurveyRings = surveyRings && view.nodes.some((node) => !node.is_seed && node.is_survey)

  /** Ring the surveys or stop (the Surveys chip). */
  const toggleSurveys = useCallback(() => {
    dispatch(threadEdited())
    setSurveyRings((prev) => !prev)
  }, [dispatch])

  /** Toggle one relation type's visibility (the filter chips). */

  const toggleType = useCallback(
    (type: string) => {
      dispatch(threadEdited())
      setEnabled((prev) => {
        const next = new Set(prev)
        if (next.has(type)) next.delete(type)
        else next.add(type)
        return next
      })
    },
    [dispatch],
  )

  // The camera follows a layout switch from its first frame (v8.21.0),
  // instead of waiting out the settle.
  const { start: startChase, stop: stopChase } = useCameraChase(fgRef)

  /**
   * Switch layout. The physics live in useTimeline; clearing pin state stays
   * here because switching layout releases all user pins. (A restored
   * session's layout arrives via the store instead — useTimeline's own
   * new-base effect pins its year columns, no user pins to clear.)
   */
  const setLayoutMode = useCallback(
    (mode: 'force' | 'timeline') => {
      dispatch(threadEdited())
      dispatch(layoutSet(mode))
      if (!base) return
      applyLayoutPhysics(mode)
      clearPins()
      startChase()
    },
    [dispatch, base, applyLayoutPhysics, clearPins, startChase],
  )

  /** When the sim settles: end any camera chase, freeze Timeline y positions
   * and run the one-shot zoomToFit. */
  const onEngineStop = useCallback(() => {
    stopChase()
    // A group drop's bystanders, held still until now (`usePinning`).
    releaseHeld()
    setLinksSettling(false)
    freezeSettledY(pinned)
    if (!fitDone.current && fgRef.current) {
      fgRef.current.zoomToFit(400, 60)
      fitDone.current = true
    }
  }, [freezeSettledY, pinned, stopChase, releaseHeld])

  // Repaint when highlight/selection/pins/focus/layout change (the sim may be at rest).
  useEffect(() => {
    fgRef.current?.refresh?.()
  }, [
    hoverId,
    heldSet,
    selectedId,
    selectedIds,
    pinned,
    view,
    highlightIds,
    layout,
    paperLinks.links,
  ])

  const hasGraph = !!base && base.nodes.length > 0

  return (
    <>
      <main className="canvas-wrap" ref={wrapRef}>
        {children}

        {hasGraph && (
          <GraphControls
            layout={layout}
            onLayout={setLayoutMode}
            enabled={enabled}
            onToggleType={toggleType}
            surveyRings={surveyRings}
            onToggleSurveys={toggleSurveys}
            showRelCaps={capsActive}
            relCaps={relCaps}
            relTotals={relTotals}
            onRelCap={(type, cap) => {
              dispatch(threadEdited())
              setRelCaps((prev) => {
                const next = { ...prev }
                // At full span the cap stops existing rather than being set to
                // the total — so a later discovery widening the relation isn't
                // silently clipped to yesterday's count.
                if (cap >= (relTotals[type] ?? 0)) delete next[type]
                else next[type] = cap
                return next
              })
            }}
            minYear={base!.minYear}
            maxYear={base!.maxYear}
            yearLo={yearLo}
            yearHi={yearHi}
            onYearLo={(value) => {
              dispatch(threadEdited())
              setYearLo(value)
            }}
            onYearHi={(value) => {
              dispatch(threadEdited())
              setYearHi(value)
            }}
            minCitations={base!.minCitations}
            maxCitations={base!.maxCitations}
            citeLo={citeLo}
            citeHi={citeHi}
            onCiteLo={(value) => {
              dispatch(threadEdited())
              setCiteLo(value)
            }}
            onCiteHi={(value) => {
              dispatch(threadEdited())
              setCiteHi(value)
            }}
            visibleCount={view.eligibleIds.size}
            totalCount={base!.nodes.length}
            selectedCount={selectedIds.size}
            litCount={highlightIds.size}
            onClearAll={onClearAll}
            pinnedCount={pinned.size}
            onReleaseAll={releaseAll}
            onFit={() => fgRef.current?.zoomToFit(400, 60)}
            onRefresh={onRefresh}
            refreshing={loading}
            linksOn={showLinks}
            // Force only: in Timeline the switch isn't offered at all.
            onLinks={
              layout === 'force'
                ? (on) => {
                    // Asked again while already on: a retry after a failure.
                    if (on && showLinks) {
                      setLinksAttempt((attempt) => attempt + 1)
                      return
                    }
                    dispatch(threadEdited())
                    setShowLinks(on)
                  }
                : undefined
            }
            linksBusy={linksBusy}
            linksStatus={paperLinks.status}
            linksCount={paperLinks.links.length}
            providerNote={citationNote(provider, graph?.citation_source)}
            stagedOpen={tourStage === 'controls'}
          />
        )}

        {hasGraph && (
          <GraphCanvas
            fgRef={fgRef}
            width={size.width}
            height={size.height}
            data={view}
            focusSet={focusSet}
            anchorId={anchorId}
            pinned={pinned}
            expandedIds={expandedIds}
            surveyRings={surveyRings}
            selectedId={selectedId}
            selectedIds={selectedIds}
            selectionDims={!heldSet}
            ghostIds={view.ghostIds}
            highlightIds={litSet}
            onNodeClick={onCanvasNodeClick}
            onNodeHover={setHoverId}
            onNodeDrag={onNodeDrag}
            onNodeDragEnd={onNodeDragEnd}
            onEngineStop={onEngineStop}
            onRenderFramePre={drawAxis}
          />
        )}

        {/* Marquee node-selector: the arm overlay captures the alt-drag (so RFG
            never pans) and the outline paints the in-progress rectangle. The arm
            sits below the controls (z-index) so alt-interacting with the panel
            still works; it's inert unless Alt is held. */}
        {hasGraph && (
          <div
            className={`marquee-arm${marquee.armed ? ' armed' : ''}`}
            onMouseDown={marquee.onArmMouseDown}
          />
        )}
        {marquee.rect && (
          <div
            className="marquee-rect"
            style={{
              left: marquee.rect.left,
              top: marquee.rect.top,
              width: marquee.rect.width,
              height: marquee.rect.height,
            }}
          />
        )}

        {hasGraph && (
          <div className="graph-footer">
            <Legend
              hasExpanded={expandedIds.size > 0}
              hasSurveys={hasSurveyRings}
              hasGhosts={view.ghostIds.size > 0}
            />
            <FindBar
              query={findQuery}
              onQuery={setFindQuery}
              count={findSet ? findSet.size : null}
              onSelectAll={onFindSelectAll}
            />
          </div>
        )}
      </main>

      {detailPanel.present && shownNode && (
        <DetailPanel
          node={shownNode}
          detailLoading={detailLoading === shownNode.id}
          fieldsLabel={provider === 'openalex' ? 'OpenAlex tags' : 'Semantic Scholar tags'}
          figures={figures[shownNode.arxiv_id ?? shownNode.id]}
          codeLinks={shownNode.arxiv_id ? codeLinks[shownNode.arxiv_id] : undefined}
          categories={shownNode.arxiv_id ? categories[shownNode.arxiv_id] : undefined}
          onEnlarge={setLightbox}
          isPinned={pinned.has(shownNode.id)}
          onTogglePin={() => togglePin(shownNode.id)}
          onClose={() => setSelectedId(null)}
          onExplore={doLoadGraph}
          expansion={expansionOf(shownNode.id)}
          onExpand={(hop) => expand(shownNode.id, hop)}
          onUnexpand={(hop) => unexpand(shownNode.id, hop)}
          onGenerateTldr={async () => {
            // The panel's TL;DR toggle — the one gesture allowed to bill.
            const tldr = await generateTldr(shownNode.id, shownNode.title, shownNode.abstract ?? '')
            mergeDetail(shownNode.id, { tldr })
          }}
          closing={detailPanel.closing}
          onAnimationEnd={detailPanel.onAnimationEnd}
        />
      )}
      <Lightbox figure={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
