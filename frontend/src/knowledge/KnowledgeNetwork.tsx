/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge network (Phase 5b): a short course on what a reader needs
 * to know before a paper makes sense, drawn as a **graph of ideas**. The
 * paper sits in the middle; breaking an item down adds the concepts it needs
 * as new nodes, and a concept two items share is one node with two arrows
 * into it. A click opens the item's lesson in a side panel; a double-click
 * breaks it down. The course controls (2D / 3D and the citation
 * graph's Release · Fit · Clear row) fold into a sliders button like the
 * citation graph's, a legend
 * sits bottom-left, and the citation graph's find bar sits bottom-right
 * (v8.20.0): it dims every item whose name doesn't match, and "select"
 * (or Enter) adds the matches to the check-off selection.
 *
 * Since v8.25.0 a passage highlighted in a lesson can be explained by the
 * course's assistant (`assistant/`, docked by the shell) or expanded into a
 * concept the lesson's item needs.
 *
 * This component owns the in-flight state (which items are being broken
 * down, which failed) and the calls; the course itself lives on the thread
 * (`ThreadRecord.knowledge`), so it saves with the exploration and survives
 * leaving the tool.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  expandKnowledge,
  expandPhrase,
  synthesizeKnowledge,
  type AnswerFigure,
  type KnowledgePaper,
} from '../api'
import Lightbox from '../figures/Lightbox'
import { useAppDispatch } from '../store'
import {
  knowledgeDeleted,
  knowledgeForgotten,
  knowledgeExpanded,
  knowledgePrerequisiteAdded,
  knowledgeKnownSet,
  knowledgeKnownToggled,
  knowledgeLessonCleared,
  knowledgeOpened,
  knowledgeStarted,
  knowledgeRestored,
  knowledgeSynthesized,
  type ThreadRecord,
} from '../store/explorations'
import FindBar, { type FindCopy } from '../graph/controls/FindBar'
import { usePresence } from '../ui/usePresence'
import { useBoxSelect } from '../ui/useBoxSelect'
import { useEscapeClear } from '../graph/hooks/useEscapeClear'
import { focusAnchor, focusOf } from '../graph/model'
import KnowledgeControls, { KnowledgeNavigationHelp, NAVIGATION_HINT } from './KnowledgeControls'
import KnowledgeGraph, { type KnowledgeEngine } from './KnowledgeGraph'
import KnowledgeLegend from './KnowledgeLegend'
import KnowledgePanel, { type PhraseNote } from './KnowledgePanel'
import { askCourse, explainMessage } from './assistant/askCourse'
import {
  SYNTHESIS_PREFIX,
  courseNames,
  createMap,
  neighbourhood,
  findItems,
  findSynthesis,
  fitNeeds,
  isCurrentMap,
  missingChildren,
  nameKey,
  redundancy,
  stepOf,
  synthesisTarget,
  synthesizable,
  tutorPath,
  withPrerequisite,
  withoutItems,
} from './model'
import { useLessons } from './useLessons'
import './knowledge.css'

/** three.js only loads when someone flips to 3D. */
const KnowledgeGraph3D = lazy(() => import('./KnowledgeGraph3D'))

/** The find bar's wording over a course. */
const FIND_COPY: FindCopy = {
  toggleLabel: 'Find a concept on the graph',
  toggleTitle: 'Find a concept on the graph by name',
  placeholder: 'Find a concept…',
  inputLabel: 'Find a concept on the graph by name',
  inputTitle:
    'Spotlight the concepts whose names contain this. Enter selects them all, ready to check off or delete.',
  selectTitle: (count) =>
    `Select all ${count} matching item${count === 1 ? '' : 's'}, ready to check off or delete`,
}

/** localStorage keys for the per-browser view preferences. */
const MODE_KEY = 'ca.knowledge3d'

/** How long the "Deleted …" note stays up, in ms. */
const DELETED_NOTE_MS = 6000

/**
 * The note after hiding (v8.23.0, "Delete" until v8.26.0), with the way
 * back; or after a permanent delete, which has none.
 *
 * @param picked How many items the reader hid.
 * @param extra How many more went with them.
 * @param forever Deleted for good (v8.26.0), not hidden.
 * @returns E.g. "Hid 2 items and 3 more with them. …".
 */
function deletedMessage(picked: number, extra: number, forever = false): string {
  const them = picked === 1 ? 'it' : 'them'
  const verb = forever ? 'Deleted' : 'Hid'
  const head = picked === 1 ? `${verb} it` : `${verb} ${picked} items`
  const tail = extra > 0 ? ` and ${extra} more with ${them}` : ''
  if (forever) return `${head} for good${tail}.`
  return `${head}${tail}. Double-click what needed ${them} to bring ${them} back.`
}

/**
 * The paper at the root of a thread's course.
 *
 * @param thread The paper thread.
 * @returns The paper, from the thread's hydrated details or its seed.
 */
function rootPaper(thread: ThreadRecord): KnowledgePaper {
  const paper = thread.paper
  if (paper)
    return {
      id: paper.id,
      title: paper.title,
      year: paper.year,
      abstract: paper.abstract,
      arxiv_id: paper.arxiv_id,
      url: paper.url,
      authors: paper.authors,
    }
  const seed = thread.data.graph_ref?.seed
  return { id: seed?.id ?? thread.id, title: seed?.title ?? thread.title }
}

/**
 * Read a remembered view preference.
 *
 * @param key Its localStorage key.
 * @returns The stored value, or null when absent or unreadable.
 */
function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Remember a view preference; a private window just doesn't remember it.
 *
 * @param key Its localStorage key.
 * @param value The value.
 */
function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Unwritable storage: the choice lasts for this visit only.
  }
}

/**
 * Render a paper thread's knowledge network.
 *
 * @param props Component props.
 * @param props.thread The active paper thread.
 * @param props.children The shell's floating overlays (the ‹ pill, errors).
 * @param props.onAssistant Open the course's assistant (a lesson's Explain).
 * @returns The network.
 */
export default function KnowledgeNetwork({
  thread,
  children,
  onAssistant,
}: {
  thread: ThreadRecord
  children?: ReactNode
  onAssistant?: () => void
}) {
  const dispatch = useAppDispatch()
  const threadId = thread.id
  const provider = thread.data.provider ?? 's2'
  const map = isCurrentMap(thread.knowledge) ? thread.knowledge : undefined
  const [expanding, setExpanding] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null)
  const [threeD, setThreeD] = useState(() => readPreference(MODE_KEY) === '1')
  const [fitSignal, setFitSignal] = useState(0)
  const { drafts, write, quick, writing, refit, refitting } = useLessons(threadId, provider)
  // A lesson image enlarged full-screen (v8.24.0); held here, outside the
  // sliding panel, like the other tools' lightboxes.
  const [enlarged, setEnlarged] = useState<AnswerFigure | null>(null)
  // Items picked to check off together (v8.17.0): shift-click toggles one,
  // an alt-drag box adds the nodes inside it, as on the citation graph. Not
  // saved: a selection is a moment's gesture, not part of the course.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  // A synthesis in flight, and why the last one failed (v8.23.0).
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthesisError, setSynthesisError] = useState<string | null>(null)
  useEffect(() => setSynthesisError(null), [selected])
  // The find bar's text. Not saved either, and a new course starts empty.
  const [findQuery, setFindQuery] = useState('')
  useEffect(() => setFindQuery(''), [threadId])
  const engineRef = useRef<KnowledgeEngine | null>(null)
  // Nodes pinned by dragging, for the controls' Release count. The pins live
  // on the view's own node objects, so switching 2D/3D starts unpinned.
  const [pinned, setPinned] = useState(0)

  // The canvas fills whatever the panel leaves it.
  const wrapRef = useRef<HTMLDivElement>(null)
  const clearSelection = useCallback(() => setSelected(new Set()), [])
  const toggleSelected = useCallback(
    (nodeId: string) =>
      setSelected((previous) => {
        const next = new Set(previous)
        if (!next.delete(nodeId)) next.add(nodeId)
        return next
      }),
    [],
  )
  const box = useBoxSelect({
    wrapRef,
    // Only what the focus lights, as on the citation graph: a dimmed item
    // inside the box stays out of the selection.
    hitTest: (bounds) =>
      (engineRef.current?.nodesIn(bounds) ?? []).filter(
        (nodeId) => !litRef.current || litRef.current.has(nodeId),
      ),
    onPick: (ids) => setSelected((previous) => new Set([...previous, ...ids])),
    onClear: clearSelection,
  })
  const [size, setSize] = useState({ width: 800, height: 600 })
  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The first open starts the course with the paper as its only node (and
  // replaces a course saved in an older shape).
  useEffect(() => {
    if (!map) dispatch(knowledgeStarted({ threadId, map: createMap(rootPaper(thread)) }))
  }, [dispatch, thread, threadId, map])

  const found = useMemo(() => (map ? findItems(map, findQuery) : null), [map, findQuery])
  // The citation graph's focus (v8.23.0), by its own rules (`graph/model`):
  // the open item holds its links lit; hovering one of them shows that
  // one's links instead; hovering with nothing open lights the hovered
  // item's; a find outranks them all. Only the anchor's edges stay lit.
  const [hoverId, setHoverId] = useState<string | null>(null)
  // The item a Connections row points at (v8.23.0): it lights like a hover,
  // but alone with the open item (and the edge between them), not with its
  // whole neighbourhood as a hover on the canvas does (Patrick).
  const [pointedId, setPointedId] = useState<string | null>(null)
  const heldId = map?.openId && map.nodes[map.openId] ? map.openId : null
  const held = useMemo(() => (map && heldId ? neighbourhood(map, heldId) : null), [map, heldId])
  const hover = useMemo(
    () => (map && hoverId && map.nodes[hoverId] ? neighbourhood(map, hoverId) : null),
    [map, hoverId],
  )
  const pointed = useMemo(
    () =>
      map && pointedId && map.nodes[pointedId]
        ? new Set([pointedId, ...(heldId ? [heldId] : [])])
        : null,
    [map, pointedId, heldId],
  )
  // Memoised: the 3D view rebuilds its sprites whenever `lit` changes.
  const litHoverId = hover ? hoverId : null
  const focusLit = useMemo(
    () => focusOf({ find: found, held, hover, hoverId: litHoverId, highlights: new Set() }),
    [found, held, hover, litHoverId],
  )
  const focusAnchorId = useMemo(
    () => focusAnchor({ find: found, held, heldId, hover, hoverId: litHoverId }),
    [found, held, heldId, hover, litHoverId],
  )
  const lit = pointed ?? focusLit
  const anchorId = pointed ? (heldId ?? pointedId) : focusAnchorId
  const litRef = useRef(lit)
  litRef.current = lit
  // "select" (or Enter) adds every match to the selection and clears the
  // find, so the selection's blue rings and its bar show what was picked.
  const selectFound = useCallback(() => {
    if (!found || found.size === 0) return
    setSelected((previous) => new Set([...previous, ...found]))
    setFindQuery('')
  }, [found])

  // The map as of the latest render, for callbacks that outlive one.
  const mapRef = useRef(map)
  mapRef.current = map

  // Break an item down. One already broken down brings back what its
  // breakdown gave and was since deleted, with no call (v8.23.0); `again`
  // asks the tutor for a fresh breakdown instead, past the server's cache.
  const expand = useCallback(
    (nodeId: string, again = false) => {
      const current = mapRef.current
      const node = current?.nodes[nodeId]
      // A synthesis is never broken down: it is made of concepts already here.
      if (!current || !node || node.kind === 'synthesis') return
      if (node.expanded && !again) {
        if (missingChildren(current, nodeId).length)
          dispatch(knowledgeRestored({ threadId, nodeId }))
        return
      }
      setExpanding((previous) => (previous.has(nodeId) ? previous : new Set(previous).add(nodeId)))
      setFailed(({ [nodeId]: _dropped, ...rest }) => rest)
      expandKnowledge({
        item: {
          ...stepOf(node),
          ...(node.paper ? { paper_id: node.paper.id } : {}),
        },
        path: tutorPath(current, nodeId),
        existing: courseNames(current),
        provider,
        ...(again && { fresh: true }),
      })
        .then((found) => dispatch(knowledgeExpanded({ threadId, nodeId, children: found, again })))
        .catch((error: unknown) =>
          setFailed((previous) => ({
            ...previous,
            [nodeId]: error instanceof Error ? error.message : 'Could not break this down',
          })),
        )
        .finally(() =>
          setExpanding((previous) => {
            const next = new Set(previous)
            next.delete(nodeId)
            return next
          }),
        )
    },
    [dispatch, provider, threadId],
  )

  // A lesson's Explain (v8.25.0): the course's assistant opens and answers
  // about the passage. Nothing is added to the graph.
  const explain = useCallback(
    (nodeId: string, passage: string) => {
      const node = mapRef.current?.nodes[nodeId]
      if (!node) return
      onAssistant?.()
      void dispatch(
        askCourse({ threadId, question: explainMessage(passage, node.title), provider }),
      )
    },
    [dispatch, onAssistant, provider, threadId],
  )

  // A lesson's Expand (v8.25.0): the tutor names the idea the passage is
  // about, and it hangs under the lesson's item like a breakdown's concept
  // (a concept already on the course gets an edge, not a second node).
  const [phrase, setPhrase] = useState<PhraseNote | null>(null)
  useEffect(() => setPhrase(null), [threadId])
  const expandPassage = useCallback(
    (nodeId: string, passage: string) => {
      const current = mapRef.current
      const node = current?.nodes[nodeId]
      if (!current || !node || node.kind === 'synthesis') return
      setPhrase({ nodeId, state: 'working', text: passage.slice(0, 60) })
      expandPhrase({
        phrase: passage,
        item: stepOf(node),
        path: tutorPath(current, nodeId),
        existing: courseNames(current),
        paper_id: current.nodes[current.rootId]?.paper?.id,
      })
        .then((child) => {
          if (!child) {
            setPhrase({ nodeId, state: 'self', text: passage.slice(0, 60) })
            return
          }
          const before = mapRef.current
          if (!before) return
          const childId = nameKey(child.name)
          const after = withPrerequisite(before, nodeId, child)
          const edged = after.edges.some((edge) => edge.from === nodeId && edge.to === childId)
          // Unchanged with the edge there: it already was. Unchanged without
          // it: the concept already needs this item, and the course keeps its order.
          const state = after !== before ? 'added' : edged ? 'linked' : 'loop'
          if (state === 'added') dispatch(knowledgePrerequisiteAdded({ threadId, nodeId, child }))
          setPhrase({ nodeId, state, text: child.name, childId })
        })
        .catch((error: unknown) =>
          setPhrase({
            nodeId,
            state: 'error',
            text: error instanceof Error ? error.message : 'Could not expand this',
          }),
        )
    },
    [dispatch, threadId],
  )
  // The item an Expand is working on wears the breakdown's dashed ring
  // (v8.26.0, Patrick): it is a breakdown of one, after all.
  const ringed = useMemo(
    () =>
      phrase?.state === 'working' && !expanding.has(phrase.nodeId)
        ? new Set(expanding).add(phrase.nodeId)
        : expanding,
    [expanding, phrase],
  )

  // Hide items (v8.23.0; "Delete" until v8.26.0): never the paper, and with
  // them what only they needed and the syntheses they leave short. A note
  // says how many went, and how to bring them back.
  const [deletedNote, setDeletedNote] = useState<string | null>(null)
  useEffect(() => {
    if (!deletedNote) return undefined
    const timer = window.setTimeout(() => setDeletedNote(null), DELETED_NOTE_MS)
    return () => window.clearTimeout(timer)
  }, [deletedNote])
  const hideItems = useCallback(
    (nodeIds: string[]) => {
      const current = mapRef.current
      if (!current) return
      const doomed = nodeIds.filter((nodeId) => current.nodes[nodeId] && nodeId !== current.rootId)
      if (!doomed.length) return
      const after = withoutItems(current, doomed)
      const extra =
        Object.keys(current.nodes).length - Object.keys(after.nodes).length - doomed.length
      dispatch(knowledgeDeleted({ threadId, nodeIds: doomed }))
      setSelected(new Set())
      setDeletedNote(deletedMessage(doomed.length, extra))
    },
    [dispatch, threadId],
  )
  // Delete one for good (v8.26.0): hidden, and forgotten, so no unhide
  // brings it back. The panel's ⋮ only, behind a confirmation.
  const forgetItem = useCallback(
    (nodeId: string) => {
      const current = mapRef.current
      if (!current?.nodes[nodeId] || nodeId === current.rootId) return
      const after = withoutItems(current, [nodeId])
      const extra = Object.keys(current.nodes).length - Object.keys(after.nodes).length - 1
      dispatch(knowledgeForgotten({ threadId, nodeId }))
      setSelected(new Set())
      setDeletedNote(deletedMessage(1, extra, true))
    },
    [dispatch, threadId],
  )

  // Delete (or Backspace) deletes the selection, as the selection bar's
  // Delete does; never while typing (the find box), and never the paper.
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return
      if (!selectedRef.current.size) return
      event.preventDefault()
      hideItems([...selectedRef.current])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hideItems])

  // The paper breaks down on its own the first time: a graph of one node
  // would be a course with nothing in it.
  const rootId = map?.rootId
  const rootExpanded = !!map && !!map.nodes[map.rootId]?.expanded
  useEffect(() => {
    if (rootId && !rootExpanded && !expanding.has(rootId) && !failed[rootId]) expand(rootId)
  }, [rootId, rootExpanded, expanding, failed, expand])

  // Opening an item writes its lesson, the first time only.
  const openId = map?.openId ?? null
  // Also when the open item's lesson is cleared under it ("Break it down
  // again" rewrites it, v8.23.0).
  const openHasLesson = !!(map && openId && map.nodes[openId]?.lesson)
  useEffect(() => {
    if (map && openId) write(map, openId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open, not on every map edit
  }, [openId, openHasLesson, write])
  // An open lesson whose "How it fits in" section was written for other
  // items than need it now gets that section rewritten (v8.23.0), on open or
  // when a breakdown or deletion changes what needs it.
  const fitKey = map && openId ? fitNeeds(map, openId).join('|') : ''
  useEffect(() => {
    if (map && openId) refit(map, openId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open or a change in what needs it
  }, [openId, fitKey, refit])

  const open = useCallback(
    (nodeId: string) => dispatch(knowledgeOpened({ threadId, nodeId })),
    [dispatch, threadId],
  )
  // Opening an item, by a click on its node, Next lesson or a panel link,
  // centres it in view (a click only opened the lesson until v8.17.0).
  const openAndFocus = useCallback(
    (nodeId: string) => {
      open(nodeId)
      setFocus((previous) => ({ id: nodeId, seq: (previous?.seq ?? 0) + 1 }))
    },
    [open],
  )
  const close = useCallback(
    () => dispatch(knowledgeOpened({ threadId, nodeId: null })),
    [dispatch, threadId],
  )

  // Esc in two steps, as on the citation graph (v8.23.0): the first press
  // drops a selection or a find, and once neither is left, the next closes
  // the panel. Until then Esc only dropped the selection, from a window
  // listener that also fired on Esc typed in the find box; `useEscapeClear`
  // skips form controls, so the box's own Esc just clears the box.
  const anythingLit = selected.size > 0 || findQuery !== ''
  useEscapeClear(
    useCallback(() => {
      if (anythingLit) {
        clearSelection()
        setFindQuery('')
      } else close()
    }, [anythingLit, clearSelection, close]),
  )

  // The panel slides out rather than vanishing, showing the last item it held.
  const panel = usePresence(!!openId)
  const lastOpen = useRef(openId)
  if (openId) lastOpen.current = openId
  const shownId = openId ?? lastOpen.current
  // A row unmounts without a mouseleave when its item opens.
  useEffect(() => setPointedId(null), [shownId])

  // Same outer structure as below, so the canvas element (and its size
  // observer) survives the course arriving.
  if (!map)
    return (
      <div className="knowledge">
        <div className="knowledge-canvas" ref={wrapRef}>
          {children}
        </div>
      </div>
    )
  const graphProps = {
    map,
    width: size.width,
    height: size.height,
    expanding: ringed,
    focus,
    fitSignal,
    selected,
    lit,
    anchorId,
    onHover: setHoverId,
    onOpen: openAndFocus,
    onExpand: expand,
    onSelect: toggleSelected,
    onClose: close,
    engineRef,
    onPinned: setPinned,
  }
  // The selection's first action marks them all known, or, when every one is
  // already known, takes them all back. Syntheses check off too.
  const picked = [...selected].filter((nodeId) => map.nodes[nodeId])
  const allKnown = picked.length > 0 && picked.every((nodeId) => map.known.includes(nodeId))
  // Its second synthesizes two or more concepts or syntheses (v8.23.0): the tutor names
  // what they become toward the deepest item needing them all, and the new
  // synthesis opens. Synthesizing the same concepts again opens the one already made.
  const synthesisMembers = picked.filter((nodeId) => synthesizable(map, nodeId))
  // Its third deletes them, all but the paper (v8.23.0).
  const deletable = picked.filter((nodeId) => nodeId !== map.rootId)
  // A pick already inside another pick makes the group redundant.
  const redundant = redundancy(map, synthesisMembers)
  const synthesize = () => {
    const existing = findSynthesis(map, synthesisMembers)
    if (existing) {
      clearSelection()
      openAndFocus(existing)
      return
    }
    const toward = synthesisTarget(map, synthesisMembers)
    setSynthesizing(true)
    setSynthesisError(null)
    synthesizeKnowledge({
      members: synthesisMembers.map((nodeId) => stepOf(map.nodes[nodeId])),
      toward: stepOf(map.nodes[toward]),
      path: tutorPath(map, toward),
      paper_id: map.nodes[map.rootId]?.paper?.id,
    })
      .then((named) => {
        dispatch(knowledgeSynthesized({ threadId, ...named, members: synthesisMembers, toward }))
        clearSelection()
        openAndFocus(SYNTHESIS_PREFIX + nameKey(named.name))
      })
      .catch((error: unknown) =>
        setSynthesisError(error instanceof Error ? error.message : 'Could not synthesize these'),
      )
      .finally(() => setSynthesizing(false))
  }

  return (
    <div className="knowledge" data-tour="knowledge">
      <div
        className={`knowledge-canvas${threeD && size.width >= 640 ? ' knowledge-canvas-3d-wide' : ''}`}
        ref={wrapRef}
      >
        {threeD ? (
          <Suspense
            fallback={
              <p className="knowledge-loading">
                <span className="spin" /> Loading 3D…
              </p>
            }
          >
            <KnowledgeGraph3D {...graphProps} />
          </Suspense>
        ) : (
          <KnowledgeGraph {...graphProps} />
        )}

        <KnowledgeControls
          threeD={threeD}
          onThreeD={(on) => {
            setThreeD(on)
            setPinned(0)
            // 3D reports no hover: a 2D one would otherwise stay lit there.
            setHoverId(null)
            writePreference(MODE_KEY, on ? '1' : '0')
          }}
          onFit={() => setFitSignal((count) => count + 1)}
          pinnedCount={pinned}
          onRelease={() => engineRef.current?.release()}
          selectedCount={picked.length}
          onClear={clearSelection}
        />
        {/* The alt-drag box: the arm overlay captures the drag (so the
            engine never pans) and the outline paints the box. Shared CSS with
            the citation graph's marquee. */}
        <div
          className={`marquee-arm${box.armed ? ' armed' : ''}`}
          onMouseDown={box.onArmMouseDown}
        />
        {box.rect && (
          <div
            className="marquee-rect"
            style={{
              left: box.rect.left,
              top: box.rect.top,
              width: box.rect.width,
              height: box.rect.height,
            }}
          />
        )}
        {picked.length > 0 && (
          <div className="knowledge-selection" role="toolbar" aria-label="Selected items">
            <span>{picked.length} selected</span>
            <button
              type="button"
              className="knowledge-selection-mark"
              onClick={() => {
                dispatch(knowledgeKnownSet({ threadId, nodeIds: picked, known: !allKnown }))
                clearSelection()
              }}
            >
              {allKnown ? 'Not known' : '✓ I know these'}
            </button>
            {synthesisMembers.length >= 2 &&
              (synthesizing ? (
                <span className="lesson-status">
                  <span className="spin" /> Synthesizing…
                </span>
              ) : (
                <button
                  type="button"
                  className="knowledge-selection-mark synthesis"
                  onClick={synthesize}
                  disabled={!!redundant}
                  title={
                    redundant
                      ? `“${map.nodes[redundant.outer].title}” already ${redundant.how === 'includes' ? 'includes' : 'builds on'} “${map.nodes[redundant.inner].title}”: take one of them out of the selection`
                      : 'Add a synthesis to the course: how these concepts (or syntheses) come together, taught just before what they build up to'
                  }
                >
                  ◆ Synthesize
                </button>
              ))}
            {synthesisError && <span className="lesson-error">{synthesisError}</span>}
            <button
              type="button"
              className="knowledge-selection-mark delete"
              onClick={() => hideItems(picked)}
              disabled={!deletable.length}
              title={
                deletable.length
                  ? 'Hide these (Delete key), with what only they need and any synthesis left short. Double-click what needed them to bring them back'
                  : 'The paper can’t be hidden'
              }
            >
              Hide
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={clearSelection}
              title="Clear the selection (Esc)"
            >
              Clear
            </button>
          </div>
        )}
        {picked.length === 0 && deletedNote && (
          <div className="knowledge-selection knowledge-deleted" role="status">
            <span>{deletedNote}</span>
          </div>
        )}
        <div className="knowledge-footer">
          <KnowledgeLegend
            hasSyntheses={Object.values(map.nodes).some((node) => node.kind === 'synthesis')}
          />
          <FindBar
            query={findQuery}
            onQuery={setFindQuery}
            count={found ? found.size : null}
            onSelectAll={selectFound}
            copy={FIND_COPY}
            tour="knowledge-find"
          />
          {threeD && size.width < 640 && <KnowledgeNavigationHelp />}
        </div>
        {threeD && size.width >= 640 && (
          <p className="knowledge-navigation-hint">{NAVIGATION_HINT}</p>
        )}
        {failed[map.rootId] && (
          <div className="overlay overlay-card knowledge-failed">
            {failed[map.rootId]}{' '}
            <button type="button" onClick={() => expand(map.rootId)}>
              Try again
            </button>
          </div>
        )}
        {children}
      </div>

      {panel.present && shownId && map.nodes[shownId] && (
        <KnowledgePanel
          map={map}
          nodeId={shownId}
          draft={drafts[shownId]}
          writing={writing(shownId)}
          refitting={refitting.has(shownId)}
          expanding={expanding.has(shownId)}
          expandError={failed[shownId]}
          closing={panel.closing}
          onAnimationEnd={panel.onAnimationEnd}
          onOpen={openAndFocus}
          onExpand={expand}
          onToggleKnown={(nodeId) => dispatch(knowledgeKnownToggled({ threadId, nodeId }))}
          onRetry={() => write(map, shownId)}
          onQuick={() => quick(map, shownId)}
          onRewrite={() => dispatch(knowledgeLessonCleared({ threadId, nodeId: shownId }))}
          onHide={(nodeId) => hideItems([nodeId])}
          onDelete={forgetItem}
          onHover={threeD ? undefined : setPointedId}
          onEnlarge={setEnlarged}
          onExplain={(passage) => explain(shownId, passage)}
          onExpandPhrase={(passage) => expandPassage(shownId, passage)}
          phrase={phrase}
          onClose={close}
        />
      )}
      <Lightbox figure={enlarged} onClose={() => setEnlarged(null)} />
    </div>
  )
}
