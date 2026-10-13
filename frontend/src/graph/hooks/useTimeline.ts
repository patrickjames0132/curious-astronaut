/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The layout physics hook — the ONE owner of the sim's d3 forces, for both
 * layouts. Timeline: pinning each node's x to its publication year, the
 * collide force that spreads a year column out, the year-axis painter, and
 * the effects that keep all of it in sync as graphs load and the year slider
 * moves, plus the expansion streams above the seed's timeline (see
 * `../streamForce.ts`). Force: the relation clustering (see
 * `../clusterForce.ts` — sector anchors around the seed, expansion groups out
 * past them and the bridges between, per-link distances measured between
 * the plan's homes) plus its own collide for in-cluster spacing,
 * or, while the interconnected-links button is on, the connected layout
 * the links between papers shape. Single ownership matters because both
 * layouts write the same force slots ('collide', 'link', 'cluster', 'stream')
 * — two hooks doing that would fight over them on every switch.
 *
 * State (layout mode, pins) stays in GraphExplorer — this hook only mutates
 * the simulation's node objects and d3 forces through the shared `fgRef`,
 * exactly as the inline code it replaced did.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef } from 'react'
// react-force-graph's own force lib (d3-force-3d) ships no types; we only need
// forceCollide to space nodes out by their radius.
// @ts-expect-error - no type declarations
import { forceCollide } from 'd3-force-3d'
import {
  clusterForce,
  clusterRadius,
  connectedRadius,
  expansionGroups,
  layoutPlan,
} from '../clusterForce'
import { nodeRadius } from '../model'
import type { Base, VLink, VNode } from '../model'
import { streamForce } from '../streamForce'
import { YEAR_SPACING } from '../theme'

/** The shortest a link touching an expansion group or a bridge may get. */
const MIN_GROUP_LINK_DISTANCE = 40
/**
 * The connected layout's spacing, measured on a real graph (Atari's 290 papers
 * and 281 links between them, simulated offline) rather than eyeballed. The
 * gap between linked papers tracks the collision margin, about twice it: at
 * the first cut's 4 the linked papers packed 8 units apart (median) against
 * 44 for the unlinked ones, the knot Patrick saw. A margin of 20, links that
 * rest 80 past the two papers' radii, and a charge of -60 open it to 40
 * against 54, while linked papers still sit about a third as far apart as
 * random pairs do (the clustering survives) and the graph grows ~10%.
 */
const CONNECTED_COLLIDE_MARGIN = 20
/** How far past the two papers' radii a link between papers rests. */
const BETWEEN_LINK_GAP = 80
/** The connected layout's charge (the sector layout keeps d3's -30). */
const CONNECTED_CHARGE = -60
/**
 * A lone paper's charge and collision margin in the connected layout (one no
 * link between papers reaches; see `../clusterForce.ts`). Measured the same
 * way (Atari, 194 lone citers): at the linked papers' -60 and 20, the lone
 * citers' cluster repelled itself into a disc that wrapped almost the whole
 * way round the seed; at -15 and 8, with the cluster force's stronger pull
 * home, it holds a wedge about ±30° wide. They need no air for lines: none
 * run between them.
 */
const LONE_CHARGE = -15
const LONE_COLLIDE_MARGIN = 8

/** Arguments for {@link useTimeline}. */
export interface UseTimelineArgs {
  /** The stable per-graph dataset whose node objects the sim mutates. */
  base: Base | null
  /** The current layout mode. */
  layout: 'force' | 'timeline'
  /** The interconnected-links button: Force drops its sectors and lets the
   *  links between papers shape the layout. */
  connected: boolean
  /** The ForceGraph2D ref (for d3 forces, reheat, zoomToFit, coords). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: { current: any }
  /** The canvas size (drawAxis spans the visible viewport). */
  size: { width: number; height: number }
  /** Shared "zoomToFit already ran for this layout" latch. */
  fitDone: { current: boolean }
  /** The selected year window (Timeline refits when it changes). */
  yearLo: number
  yearHi: number
}

/** What {@link useTimeline} returns for GraphExplorer to wire up. */
export interface TimelineApi {
  /**
   * A node's timeline x: its year plus a month fraction, so papers sit
   * *between* the yearly gridlines by publication month (unknown month → start
   * of year). An undated node has no honest x and Timeline filters it out of the
   * view entirely (see `GraphExplorer`'s `nodeOk`), so this only runs on dated
   * nodes — bar an undated *seed*, which is always shown and anchors at the
   * earliest year.
   */
  nodeTimelineX: (node: { year: number | null; month?: number | null }) => number
  /**
   * Apply a layout's physics: Timeline pins every node's x to its year column
   * and adds a radius-sized collide force; Force releases the pins and
   * registers the relation clustering (sector anchors, orbit-length links,
   * its own collide — see `../clusterForce.ts`). Does NOT touch pin state —
   * the caller clears `pinned` itself. The interconnected-links button
   * re-registers the forces without this, so showing or hiding keeps every pin.
   */
  applyLayoutPhysics: (mode: 'force' | 'timeline') => void
  /**
   * Paint the year axis behind the graph in Timeline mode: a faint gridline +
   * label per year, thinned out when zoomed too far to fit them all. Passed
   * to ForceGraph2D's `onRenderFramePre`.
   */
  drawAxis: (ctx: CanvasRenderingContext2D, globalScale: number) => void
  /**
   * Once the sim settles in Timeline, freeze y as well (x is already pinned
   * by year) so the layout is stable and dragging one node can't re-relax
   * the rest. Called from the engine-stop handler; no-ops in Force mode.
   */
  freezeSettledY: (pinned: Set<string>) => void
}

/**
 * Own both layouts' physics (and Timeline's painting) for GraphExplorer.
 *
 * Also runs two effects: re-applying the active layout's physics when a new
 * graph loads, and refitting the camera when the year slider narrows.
 *
 * @returns The x-placement, physics, axis-painting, and settle-freeze handles.
 */
export function useTimeline({
  base,
  layout,
  connected,
  fgRef,
  size,
  fitDone,
  yearLo,
  yearHi,
}: UseTimelineArgs): TimelineApi {
  // Map a year to its gridline x on the timeline.
  const yearToX = useCallback(
    (year: number) => {
      if (!base) return 0
      return (year - base.minYear) * YEAR_SPACING
    },
    [base],
  )

  // Undated papers used to be parked on the seed's own exact column, on the
  // reasoning that S2 not knowing a date isn't evidence the paper is old, and a
  // citer tends to be contemporaneous with its seed anyway. True enough — but
  // every one of them landed on a single x, so they rendered as a vertical bar
  // skewered through the seed. Placing a paper on a time axis IS a claim about
  // when it came out, and we have no such claim to make here; the view filters
  // them out instead (GraphExplorer's `nodeOk`). Only an undated seed survives
  // the filter — it's always shown — and it anchors at the earliest year.
  const nodeTimelineX = useCallback(
    (node: { year: number | null; month?: number | null }) => {
      if (!base) return 0
      if (typeof node.year !== 'number') return 0
      const frac = typeof node.month === 'number' ? (node.month - 1) / 12 : 0
      return (node.year - base.minYear + frac) * YEAR_SPACING
    },
    [base],
  )

  // The default link force's accessors, captured before the Force branch
  // overrides them (per-cluster distances) so Timeline can restore them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkDefaults = useRef<{ distance: any; strength: any } | null>(null)

  // Register a layout's forces, leaving every node's fx/fy alone: the
  // interconnected-links button calls this on its own, so showing or hiding them keeps
  // the user's pins and Timeline's frozen heights.
  const configureForces = useCallback(
    (mode: 'force' | 'timeline') => {
      if (!base) return
      const fg = fgRef.current
      const charge = fg?.d3Force?.('charge')
      if (charge) charge.strength(mode === 'force' && connected ? CONNECTED_CHARGE : -30)
      const linkForce = fg?.d3Force?.('link')
      if (linkForce && !linkDefaults.current) {
        linkDefaults.current = { distance: linkForce.distance(), strength: linkForce.strength() }
      }
      if (mode === 'timeline') {
        // Timeline: a collision force sized to each node's radius spreads
        // papers apart within a year column (no overlap, even spacing); the
        // cluster force comes out (x is pinned by year — sector pulls would
        // only fight the columns), the expansion streams go in, and the link
        // force gets its defaults back. A link between papers pulls on
        // nothing (none are drawn in Timeline anyway: `linksActive` keeps the
        // links to Force). Nor does a link from a stream to the
        // seed's (v8.18.0's polish): it dragged the papers an expansion shares
        // with the seed halfway up to the group, a third row between the two,
        // and tugged the expanded paper back down. Each stream holds its own.
        fg?.d3Force?.(
          'collide',
          forceCollide((node: VNode) => nodeRadius(node) + 6),
        )
        fg?.d3Force?.('cluster', null)
        fg?.d3Force?.('stream', streamForce())
        if (linkForce && linkDefaults.current) {
          const defaults = linkDefaults.current
          linkForce.distance(defaults.distance)
          let groups = expansionGroups(base.nodes)
          linkForce.strength((link: VLink, index: number, links: VLink[]) => {
            if (index === 0) groups = expansionGroups(base.nodes)
            if (link._between) return 0
            const sourceGroup = groups.groupOf.get(link._s)
            const targetGroup = groups.groupOf.get(link._t)
            if (sourceGroup !== targetGroup) return 0
            return typeof defaults.strength === 'function'
              ? defaults.strength(link, index, links)
              : defaults.strength
          })
        }
      } else {
        // Force: cluster the neighborhood by relation (see ../clusterForce.ts)
        // with a collide for in-cluster spacing, and stretch each link to its
        // relation cluster's orbit at low strength — the default (distance 30,
        // leaf-strength 1) yanked every neighbor into one clump around the
        // seed, which was most of the layout's clutter. Connected, the
        // sectors go and the links between papers do the clustering.
        // The cluster force's plan, rebuilt at each link initialization (d3
        // asks for link 0 first) over the papers the links join: an expansion
        // changes the groups, and the links between papers change the degrees
        // and who is lone. Rebuilt here rather than read off the cluster
        // force, because d3 initializes the link force first.
        let plan = layoutPlan([], [], connected)
        const collide = forceCollide(
          (node: VNode) =>
            nodeRadius(node) +
            (!connected
              ? 4
              : plan.lone.has(node.id)
                ? LONE_COLLIDE_MARGIN
                : CONNECTED_COLLIDE_MARGIN),
        )
        fg?.d3Force?.('collide', collide)
        const chargeOf = (node: VNode) =>
          !connected ? -30 : plan.lone.has(node.id) ? LONE_CHARGE : CONNECTED_CHARGE
        if (charge) charge.strength(chargeOf)
        fg?.d3Force?.(
          'cluster',
          // The sim's own links (the links between papers among them, which
          // say who is lone), falling back to the base's before the first.
          clusterForce(connected, () => linkForce?.links?.() ?? base.links),
        )
        fg?.d3Force?.('stream', null)
        if (linkForce) {
          let degree = new Map<string, number>()
          const refresh = (links: VLink[]) => {
            const papers = new Map<string, VNode>()
            for (const link of links) {
              for (const end of [link.source, link.target]) {
                if (typeof end === 'object' && end) papers.set((end as VNode).id, end as VNode)
              }
            }
            plan = layoutPlan([...papers.values()], links, connected)
            // d3 sizes the collide and the charge per node when the nodes
            // arrive, before the links do: size them again now that the plan
            // knows who is lone.
            if (connected) {
              collide.radius(collide.radius())
              charge?.strength(chargeOf)
            }
            degree = new Map()
            for (const link of links) {
              if (!link._between) continue
              degree.set(link._s, (degree.get(link._s) ?? 0) + 1)
              degree.set(link._t, (degree.get(link._t) ?? 0) + 1)
            }
          }
          const planned = (id: string) =>
            plan.groups.groupOf.has(id) || plan.bridges.has(id) || plan.lone.has(id)
          linkForce.distance((link: VLink, index: number, links: VLink[]) => {
            if (index === 0) refresh(links)
            // Touching a group or a bridge: as long as their homes are apart,
            // so the links agree with the cluster force about where each sits.
            const from = plan.homes.get(link._s)
            const to = plan.homes.get(link._t)
            if ((planned(link._s) || planned(link._t)) && from && to) {
              return Math.max(MIN_GROUP_LINK_DISTANCE, Math.hypot(from.dx - to.dx, from.dy - to.dy))
            }
            if (link._between) {
              const ends = [link.source, link.target].map((end) =>
                typeof end === 'object' && end ? nodeRadius(end as VNode) : 0,
              )
              return BETWEEN_LINK_GAP + ends[0] + ends[1]
            }
            if (connected) {
              const population = Object.values(plan.counts).reduce((sum, count) => sum + count, 0)
              return connectedRadius(population)
            }
            return clusterRadius(plan.counts[link.type ?? ''] ?? 0)
          })
          linkForce.strength((link: VLink, index: number, links: VLink[]) => {
            if (index === 0) refresh(links)
            const grouped = planned(link._s) || planned(link._t)
            if (link._between) {
              if (grouped) return 0.02
              // d3's own rule, scaled: a paper with many links gets a gentler
              // pull from each, so a hub doesn't collapse its neighbourhood.
              const busiest = Math.min(degree.get(link._s) ?? 1, degree.get(link._t) ?? 1)
              return 0.6 / busiest
            }
            return connected && !grouped ? 0.05 : 0.08
          })
        }
      }
      fitDone.current = false
      fg?.d3ReheatSimulation?.()
    },
    [base, connected, fgRef, fitDone],
  )

  const applyLayoutPhysics = useCallback(
    (mode: 'force' | 'timeline') => {
      if (!base) return
      base.nodes.forEach((node) => {
        if (mode === 'timeline') {
          node.fx = nodeTimelineX(node)
          node.fy = undefined
        } else {
          node.fx = undefined
          node.fy = undefined
        }
      })
      configureForces(mode)
    },
    [base, nodeTimelineX, configureForces],
  )

  // The interconnected-links button reshapes Force (and takes the links'
  // pull out of Timeline) without touching a single pin.
  const lastConnected = useRef(connected)
  useEffect(() => {
    if (lastConnected.current === connected) return
    lastConnected.current = connected
    configureForces(layout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  // Re-apply the active layout's physics when a new graph loads: Timeline
  // re-pins its year columns (a fresh graph has no user pins yet), Force
  // re-registers the relation clustering for the new node set.
  useEffect(() => {
    if (!base) return
    applyLayoutPhysics(layout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  // In Timeline, refit when the visible year range changes so narrowing the
  // slider zooms into those years — bigger nodes, less empty space.
  useEffect(() => {
    if (layout !== 'timeline') return
    const id = setTimeout(() => fgRef.current?.zoomToFit(400, 60), 150)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, yearLo, yearHi])

  const drawAxis = useCallback(
    (ctx: CanvasRenderingContext2D, globalScale: number) => {
      const fg = fgRef.current
      if (layout !== 'timeline' || !base || !fg || base.maxYear <= base.minYear) return
      const tl = fg.screen2GraphCoords(0, 0)
      const br = fg.screen2GraphCoords(size.width, size.height)
      // Only label as many years as comfortably fit (≥28px apart on screen).
      const px = YEAR_SPACING * globalScale
      const step = px < 28 ? Math.ceil(28 / px) : 1
      ctx.save()
      ctx.font = `${11 / globalScale}px -apple-system, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.lineWidth = 1 / globalScale
      for (let yr = base.minYear; yr <= base.maxYear; yr++) {
        if ((yr - base.minYear) % step !== 0) continue
        const lineX = yearToX(yr)
        ctx.strokeStyle = 'rgba(120,130,150,0.12)'
        ctx.beginPath()
        ctx.moveTo(lineX, tl.y)
        ctx.lineTo(lineX, br.y)
        ctx.stroke()
        ctx.fillStyle = 'rgba(150,160,180,0.65)'
        ctx.fillText(String(yr), lineX, tl.y + 4 / globalScale)
      }
      ctx.restore()
    },
    [layout, base, size, yearToX, fgRef],
  )

  const freezeSettledY = useCallback(
    (pinned: Set<string>) => {
      if (layout !== 'timeline' || !base) return
      base.nodes.forEach((node) => {
        if (!pinned.has(node.id) && typeof node.y === 'number') node.fy = node.y
      })
    },
    [layout, base],
  )

  return { nodeTimelineX, applyLayoutPhysics, drawAxis, freezeSettledY }
}
