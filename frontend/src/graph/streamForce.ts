/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Timeline's parallel streams (v8.18.0): each expansion group (an expanded
 * paper and the papers its expansion added, see `clusterForce.ts`'s
 * `expansionGroups`) gets a horizontal band of its own **above** the seed's
 * timeline, stacked upward in the order the groups formed. A custom d3 force
 * that moves y only: x is pinned to the year, so a stream is a second
 * timeline running parallel to the seed's. A paper the expansion only linked
 * to (one already on the graph) stays in the seed's stream.
 *
 * Each band sits above the one before it with clear air between. A band's
 * height comes from its fullest year column, so a stream with twenty papers
 * from one year gets the room to stack them. The seed's stream stays where
 * it settled (its heights freeze once the sim stops, see `useTimeline`'s
 * `freezeSettledY`), and its top edge is read live each tick.
 *
 * Until v8.18.0 an expansion's papers banded outward from their origin's side
 * of the timeline, inside the seed's own mass when the origin sat mid-column.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { expansionGroups, GLIDE, MAX_SPEED } from './clusterForce'
import type { ExpansionGroups } from './clusterForce'
import { nodeRadius } from './model'
import type { VNode } from './model'

/** Clear air between two streams, in graph units. */
const STREAM_GAP = 60
/** The smallest half-height a stream gets. */
const MIN_HALF_HEIGHT = 30
/** Half-height per paper in a stream's fullest year column. */
const HALF_HEIGHT_PER_PAPER = 9
/** How hard a stream's papers are pulled to its centre line (per unit alpha). */
const STREAM_PULL = 0.15

/**
 * Each stream's half-height: enough room for its fullest year column.
 *
 * @param nodes The sim's nodes.
 * @param groups The graph's expansion groups.
 * @returns Half-height per group id.
 */
export function streamHalfHeights(nodes: VNode[], groups: ExpansionGroups): Map<string, number> {
  const columns = new Map<string, Map<number, number>>()
  for (const node of nodes) {
    const group = groups.groupOf.get(node.id)
    if (!group) continue
    const perYear = columns.get(group) ?? new Map<number, number>()
    const year = node.year ?? 0
    perYear.set(year, (perYear.get(year) ?? 0) + 1)
    columns.set(group, perYear)
  }
  const halves = new Map<string, number>()
  for (const [group, perYear] of columns) {
    const fullest = Math.max(...perYear.values())
    halves.set(group, Math.max(MIN_HALF_HEIGHT, fullest * HALF_HEIGHT_PER_PAPER))
  }
  return halves
}

/**
 * Build the stream force. d3 contract: a function of `alpha` with an
 * `initialize(nodes)` the simulation calls whenever its node list changes,
 * which is where the groups and band heights refresh.
 *
 * @returns The custom force, ready for `fg.d3Force('stream', ...)`.
 */
export function streamForce() {
  let nodes: VNode[] = []
  let groups: ExpansionGroups = { groupOf: new Map(), order: [], sizes: new Map() }
  let halves: Map<string, number> = new Map()

  const force = (alpha: number) => {
    if (groups.order.length === 0) return
    // The seed's stream: everyone outside a group. Its top edge is where the
    // first band's bottom edge goes.
    let mainTop = Infinity
    for (const node of nodes) {
      if (groups.groupOf.has(node.id) || typeof node.y !== 'number') continue
      mainTop = Math.min(mainTop, node.y - nodeRadius(node))
    }
    if (!Number.isFinite(mainTop)) mainTop = 0
    const centres = new Map<string, number>()
    let edge = mainTop - STREAM_GAP
    for (const group of groups.order) {
      const half = halves.get(group)
      if (half === undefined) continue
      centres.set(group, edge - half)
      edge -= 2 * half + STREAM_GAP
    }
    for (const node of nodes) {
      const group = groups.groupOf.get(node.id)
      const centre = group ? centres.get(group) : undefined
      if (centre === undefined || node.fy !== undefined) continue
      node.vy = (node.vy ?? 0) + (centre - (node.y ?? 0)) * STREAM_PULL * alpha
      // Glide up into the stream rather than jump (see clusterForce's GLIDE).
      const limit = Math.max(MAX_SPEED, GLIDE * Math.abs(centre - (node.y ?? 0)))
      node.vy = Math.max(-limit, Math.min(limit, node.vy))
    }
  }
  force.initialize = (simNodes: VNode[]) => {
    nodes = simNodes
    groups = expansionGroups(simNodes)
    halves = streamHalfHeights(simNodes, groups)
  }
  return force
}
