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
 * the plan's homes) plus its own collide for in-cluster spacing. Single ownership matters because both
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
import { clusterForce, clusterRadius, expansionGroups, layoutPlan } from '../clusterForce'
import { nodeRadius } from '../model'
import type { Base, VLink, VNode } from '../model'
import { streamForce } from '../streamForce'
import { YEAR_SPACING } from '../theme'

/** The shortest a link touching an expansion group or a bridge may get. */
const MIN_GROUP_LINK_DISTANCE = 40

/** Arguments for {@link useTimeline}. */
export interface UseTimelineArgs {
  /** The stable per-graph dataset whose node objects the sim mutates. */
  base: Base | null
  /** The current layout mode. */
  layout: 'force' | 'timeline'
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
   * the caller clears `pinned` itself.
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

  // Register a layout's forces, leaving every node's fx/fy alone (the
  // pin resets are applyLayoutPhysics's).
  const configureForces = useCallback(
    (mode: 'force' | 'timeline') => {
      if (!base) return
      const fg = fgRef.current
      const charge = fg?.d3Force?.('charge')
      if (charge) charge.strength(-30)
      const linkForce = fg?.d3Force?.('link')
      if (linkForce && !linkDefaults.current) {
        linkDefaults.current = { distance: linkForce.distance(), strength: linkForce.strength() }
      }
      if (mode === 'timeline') {
        // Timeline: a collision force sized to each node's radius spreads
        // papers apart within a year column (no overlap, even spacing); the
        // cluster force comes out (x is pinned by year — sector pulls would
        // only fight the columns), the expansion streams go in, and the link
        // force gets its defaults back, except that no link pulls from a
        // stream to the seed's (v8.18.0's polish): it dragged the papers an expansion shares
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
        // seed, which was most of the layout's clutter.
        fg?.d3Force?.(
          'collide',
          forceCollide((node: VNode) => nodeRadius(node) + 4),
        )
        fg?.d3Force?.(
          'cluster',
          clusterForce(() => base.links),
        )
        fg?.d3Force?.('stream', null)
        if (linkForce) {
          // The cluster force's plan, rebuilt at each link initialization (d3
          // asks for link 0 first) over the papers the links join, since an
          // expansion changes the groups. Rebuilt here rather than read off
          // the cluster force, because d3 initializes the link force first.
          let plan = layoutPlan([], [])
          const refresh = (links: VLink[]) => {
            const papers = new Map<string, VNode>()
            for (const link of links) {
              for (const end of [link.source, link.target]) {
                if (typeof end === 'object' && end) papers.set((end as VNode).id, end as VNode)
              }
            }
            plan = layoutPlan([...papers.values()], base.links)
          }
          const planned = (id: string) => plan.groups.groupOf.has(id) || plan.bridges.has(id)
          linkForce.distance((link: VLink, index: number, links: VLink[]) => {
            if (index === 0) refresh(links)
            // Touching a group or a bridge: as long as their homes are apart,
            // so the links agree with the cluster force about where each sits.
            const from = plan.homes.get(link._s)
            const to = plan.homes.get(link._t)
            if ((planned(link._s) || planned(link._t)) && from && to) {
              return Math.max(MIN_GROUP_LINK_DISTANCE, Math.hypot(from.dx - to.dx, from.dy - to.dy))
            }
            return clusterRadius(plan.counts[link.type ?? ''] ?? 0)
          })
          linkForce.strength(0.08)
        }
      }
      fitDone.current = false
      fg?.d3ReheatSimulation?.()
    },
    [base, fgRef, fitDone],
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
