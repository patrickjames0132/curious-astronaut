/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Force layout's clustering: a custom d3 force that pulls every
 * neighbor toward an angular sector around the seed, one sector per relation,
 * so the neighborhood reads as distinct clusters instead of one
 * undifferentiated cloud (the Force-layout counterpart to Timeline's
 * separation by date).
 *
 * Geometry: each relation owns a fixed compass heading (stable across graphs,
 * so the map always reads the same way) — references west, echoing Timeline's
 * past-is-left; citations due east. A cluster's orbit radius grows with the
 * square root of its population (area scales linearly with the papers in it),
 * which spaces big clusters farther from the seed — and from each other —
 * while small ones stay close. Anchors are computed from the seed's LIVE
 * position every tick, so the whole formation follows if the seed drifts or
 * is dragged.
 *
 * **Expansion groups** are the exception (v8.18.0; satellites since v5.24.0).
 * An expanded paper and the papers its expansion added form a group of their
 * own (`expansionGroups`), and the whole group, the expanded paper included,
 * leaves the formation for an anchor out past it: on its origin's side,
 * angled off the relation axis so it never lands on a sector. A paper the
 * expansion only linked to (one already on the graph) is no member and stays
 * in the seed's formation. Until v8.18.0 the satellites gathered just beyond
 * an origin that stayed in its sector, which read as a clump stuck to the
 * formation rather than a neighbourhood of its own.
 *
 * A group is laid out the way the seed's neighbourhood is, at its own scale:
 * the expanded paper at the anchor, the references it brought in to its west
 * and the citers to its east. And a paper the expansion **linked to** (one
 * already on the graph, so a neighbour of both the seed and the expanded
 * paper) is a **bridge**: it leaves its sector for the point between its
 * sector and the group (between all of its groups, if it links to several),
 * so the papers the two neighbourhoods share sit visibly between them.
 *
 * All of it is one plan, `layoutPlan`: a home for every node, as an offset
 * from the seed. The cluster force pulls each node to its home, and
 * `useTimeline`'s link distances are measured between homes, so the links
 * never fight the clusters.
 *
 * Wired up (with the matching collide force and per-link distances) in
 * `hooks/useTimeline.ts`'s `applyLayoutPhysics`, the one owner of the sim's
 * d3 forces.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { primaryRel } from './model'
import type { VNode } from './model'

/**
 * Each relation's compass heading around the seed, in radians (canvas y grows
 * downward). References west — the past on the left, matching Timeline — and
 * citations due east, opposite them. A relation with no heading here falls
 * back to the default orbit, which is what the retired relations (`search`,
 * v7.3.0; `similar`, v7.5.0) do on a session saved before they went.
 *
 * Citations sat at -PI/3 (up-right) until v7.17.0, sharing the eastern half
 * with `latest` at +PI/3 (down-right) — one sector each for the two citer
 * pools. With one citing relation the split has nothing left to separate, so
 * the sector recentres on due east: the axis now reads references-west /
 * citations-east, which is the whole story the layout is trying to tell.
 */
const SECTOR_ANGLE: Record<string, number> = {
  reference: Math.PI,
  citation: 0,
}

/** The smallest cluster orbit — clear air between the seed and any cluster. */
const BASE_RADIUS = 170
/** Orbit growth per √(cluster population) — area scales with the papers. */
const RADIUS_PER_NODE = 20
/** How hard a node accelerates toward its cluster anchor (per unit alpha). */
const PULL = 0.08
/** Clear air between the formation's outer edge and an expansion group. */
const GROUP_GAP = 90
/** Group spread per √population — groups are smaller, so tighter. */
const GROUP_RADIUS_PER_NODE = 12
/** Group pull — a touch stronger than the sectors', so a group stays visibly
 *  gathered against the formation's collide pressure and its seed links. */
const GROUP_PULL = 0.12
/** How far out each further lap of groups on the same side sits. */
const GROUP_LAP = 220
/** How far a group's references (west) or citers (east) sit from its paper. */
const GROUP_SIDE_BASE = 50
/** Side growth per √(papers on that side). */
const GROUP_SIDE_PER_NODE = 10
/**
 * The speed cap's floor, in graph units per tick: no node is ever held below
 * it, however close it is to where it's going (and the stream force's flat
 * cap, see `streamForce.ts`).
 */
export const MAX_SPEED = 12
/**
 * The speed cap's share of the remaining trip: a node may cover at most this
 * fraction of the distance to its home in one tick. Without a cap, a reheat
 * after an expansion moved a group heading 900 units out by up to a hundred a
 * tick, so it seemed to teleport. A flat cap of 12 (v8.18.0's first try)
 * glided, but stranded a long trip: switching from Timeline, whose year
 * columns spread papers over thousands of units, the sim cooled with the
 * references still strung out in a line. Proportional, every trip is an
 * ease-out: quick while far, gentle on arrival, about two seconds whatever
 * the distance.
 */
export const GLIDE = 0.04

/**
 * The headings a group may take, per side of the seed, in the order groups
 * fill them. Off the relation axis (west for references, east for citers) so
 * a group never lands on a sector, and alternating above and below it.
 */
const GROUP_HEADINGS: Record<'west' | 'east' | 'none', number[]> = {
  west: [-0.65 * Math.PI, 0.65 * Math.PI, -0.82 * Math.PI, 0.82 * Math.PI],
  east: [-0.35 * Math.PI, 0.35 * Math.PI, -0.18 * Math.PI, 0.18 * Math.PI],
  none: [-0.5 * Math.PI, 0.5 * Math.PI],
}

/**
 * A cluster's orbit radius for its population.
 *
 * @param count Papers in the cluster.
 * @returns The anchor's distance from the seed, in graph units.
 */
export function clusterRadius(count: number): number {
  return BASE_RADIUS + RADIUS_PER_NODE * Math.sqrt(count)
}

/**
 * How far an expansion group's references or citers sit from the paper that
 * was expanded: the group-scale counterpart of {@link clusterRadius}.
 *
 * @param count Papers on that side of the group.
 * @returns The distance, in graph units.
 */
export function groupSideRadius(count: number): number {
  return GROUP_SIDE_BASE + GROUP_SIDE_PER_NODE * Math.sqrt(count)
}

/** The expansion groups on a graph: who belongs to which, and in what order. */
export interface ExpansionGroups {
  /** Each member's group id: the id of the paper that was expanded. */
  groupOf: Map<string, string>
  /** Group ids in the order the groups formed. */
  order: string[]
  /** Members per group, the expanded paper included. */
  sizes: Map<string, number>
}

/**
 * Group an expansion's papers with the paper they were expanded from.
 *
 * A node with an `_origin` belongs to its origin's group, and the origin
 * belongs to its own. An origin that was itself added by an expansion leads
 * its own group rather than staying in its parent's. The seed never joins a
 * group: expanding it is what the build already did.
 *
 * @param nodes The sim's nodes, in the order they joined the graph.
 * @returns The groups.
 */
export function expansionGroups(nodes: VNode[]): ExpansionGroups {
  const seedId = nodes.find((node) => node.is_seed)?.id
  const origins = new Set<string>()
  const order: string[] = []
  for (const node of nodes) {
    if (node._origin && node._origin !== seedId && !origins.has(node._origin)) {
      origins.add(node._origin)
      order.push(node._origin)
    }
  }
  const groupOf = new Map<string, string>()
  const sizes = new Map<string, number>()
  for (const node of nodes) {
    if (node.is_seed) continue
    const group = origins.has(node.id) ? node.id : node._origin
    if (!group || !origins.has(group)) continue
    groupOf.set(node.id, group)
    sizes.set(group, (sizes.get(group) ?? 0) + 1)
  }
  return { groupOf, order, sizes }
}

/**
 * Per-relation cluster populations (by each node's primary relation, the same
 * one that colors it — a multi-relation node clusters where it's painted).
 * Expansion-group members are left out (they gather at their group's anchor),
 * and so are bridges (they sit between their sector and their groups).
 *
 * @param nodes The sim's nodes.
 * @param groups The graph's expansion groups (computed when omitted).
 * @param bridges The graph's bridges (none when omitted).
 * @returns Population per relation key.
 */
export function clusterCounts(
  nodes: VNode[],
  groups: ExpansionGroups = expansionGroups(nodes),
  bridges: Map<string, string[]> = new Map(),
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const node of nodes) {
    if (node.is_seed || groups.groupOf.has(node.id) || bridges.has(node.id)) continue
    const rel = primaryRel(node)
    counts[rel] = (counts[rel] ?? 0) + 1
  }
  return counts
}

/** Where each expansion group gathers, relative to the seed. */
export interface GroupAnchor {
  /** The heading from the seed, in radians. */
  angle: number
  /** The distance from the seed, in graph units. */
  distance: number
}

/**
 * Place every expansion group: a heading on its origin's side of the seed and
 * a distance past the formation's outer edge.
 *
 * @param nodes The sim's nodes.
 * @param groups The graph's expansion groups.
 * @returns Each group's anchor, by group id.
 */
export function groupAnchors(nodes: VNode[], groups: ExpansionGroups): Map<string, GroupAnchor> {
  const counts = clusterCounts(nodes, groups)
  // The formation's outer edge: the farthest cluster's orbit plus its spread.
  const reach = BASE_RADIUS + 2 * RADIUS_PER_NODE * Math.sqrt(Math.max(0, ...Object.values(counts)))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const taken: Record<'west' | 'east' | 'none', number> = { west: 0, east: 0, none: 0 }
  const anchors = new Map<string, GroupAnchor>()
  for (const group of groups.order) {
    const origin = byId.get(group)
    const rel = origin ? primaryRel(origin) : undefined
    const side = rel === 'reference' ? 'west' : rel === 'citation' ? 'east' : 'none'
    const headings = GROUP_HEADINGS[side]
    const slot = taken[side]++
    const size = groups.sizes.get(group) ?? 1
    anchors.set(group, {
      angle: headings[slot % headings.length],
      distance:
        reach +
        GROUP_GAP +
        GROUP_RADIUS_PER_NODE * Math.sqrt(size) +
        GROUP_LAP * Math.floor(slot / headings.length),
    })
  }
  return anchors
}

/** The endpoints of a link, as raw ids (`_s`/`_t`). */
export interface PlanLink {
  _s: string
  _t: string
}

/**
 * The papers an expansion linked to rather than added: on the graph already,
 * outside every group, and joined to a group's expanded paper by a citation
 * edge. The seed never is one.
 *
 * @param nodes The sim's nodes.
 * @param links The graph's links.
 * @param groups The graph's expansion groups.
 * @returns Each bridge's group ids, in the order its links name them.
 */
export function bridgesOf(
  nodes: VNode[],
  links: PlanLink[],
  groups: ExpansionGroups,
): Map<string, string[]> {
  const bridges = new Map<string, string[]>()
  if (groups.order.length === 0) return bridges
  const leaders = new Set(groups.order)
  const eligible = new Set(
    nodes.filter((node) => !node.is_seed && !groups.groupOf.has(node.id)).map((node) => node.id),
  )
  for (const link of links) {
    for (const [paper, leader] of [
      [link._s, link._t],
      [link._t, link._s],
    ]) {
      if (!leaders.has(leader) || !eligible.has(paper)) continue
      const linked = bridges.get(paper) ?? []
      if (!linked.includes(leader)) linked.push(leader)
      bridges.set(paper, linked)
    }
  }
  return bridges
}

/** A position relative to the seed, in graph units. */
export interface Offset {
  dx: number
  dy: number
}

/** Where everything on the Force layout belongs (see the module doc). */
export interface LayoutPlan {
  /** The expansion groups. */
  groups: ExpansionGroups
  /** Each group's anchor. */
  anchors: Map<string, GroupAnchor>
  /** Each bridge's groups. */
  bridges: Map<string, string[]>
  /** Per-relation populations of the seed's formation. */
  counts: Record<string, number>
  /** Each node's home as an offset from the seed. A node with none (a
   *  relation with no sector) goes where its links take it. The seed's is
   *  the origin. */
  homes: Map<string, Offset>
}

/**
 * Plan the Force layout: every node's home relative to the seed.
 *
 * @param nodes The sim's nodes.
 * @param links The graph's links (for the bridges).
 * @returns The plan.
 */
export function layoutPlan(nodes: VNode[], links: PlanLink[]): LayoutPlan {
  const groups = expansionGroups(nodes)
  const anchors = groupAnchors(nodes, groups)
  const bridges = bridgesOf(nodes, links, groups)
  const counts = clusterCounts(nodes, groups, bridges)
  const toward = (angle: number, distance: number): Offset => ({
    dx: Math.cos(angle) * distance,
    dy: Math.sin(angle) * distance,
  })
  const centres = new Map<string, Offset>()
  for (const [group, anchor] of anchors) centres.set(group, toward(anchor.angle, anchor.distance))
  // Each group's references and citers, counted apart: they sit on opposite
  // sides of the expanded paper, each as far out as its own population needs.
  const sides = new Map<string, number>()
  const sideKey = (group: string, node: VNode) => `${group}|${primaryRel(node)}`
  for (const node of nodes) {
    const group = groups.groupOf.get(node.id)
    if (!group || group === node.id) continue
    sides.set(sideKey(group, node), (sides.get(sideKey(group, node)) ?? 0) + 1)
  }
  const homes = new Map<string, Offset>()
  for (const node of nodes) {
    if (node.is_seed) {
      homes.set(node.id, { dx: 0, dy: 0 })
      continue
    }
    const group = groups.groupOf.get(node.id)
    if (group) {
      const centre = centres.get(group)
      if (!centre) continue
      if (group === node.id) {
        homes.set(node.id, centre)
        continue
      }
      const rel = primaryRel(node)
      const side = rel === 'reference' ? -1 : rel === 'citation' ? 1 : 0
      const reach = groupSideRadius(sides.get(sideKey(group, node)) ?? 1)
      homes.set(node.id, { dx: centre.dx + side * reach, dy: centre.dy })
      continue
    }
    const angle = SECTOR_ANGLE[primaryRel(node)]
    const sector =
      angle === undefined ? undefined : toward(angle, clusterRadius(counts[primaryRel(node)] ?? 0))
    const linked = (bridges.get(node.id) ?? [])
      .map((leader) => centres.get(leader))
      .filter((centre): centre is Offset => centre !== undefined)
    if (linked.length) {
      // Between its own place and every group it links to (with no sector of
      // its own, between the seed and them).
      const own = sector ?? { dx: 0, dy: 0 }
      const points = [own, ...linked]
      homes.set(node.id, {
        dx: points.reduce((sum, point) => sum + point.dx, 0) / points.length,
        dy: points.reduce((sum, point) => sum + point.dy, 0) / points.length,
      })
      continue
    }
    if (sector) homes.set(node.id, sector)
  }
  return { groups, anchors, bridges, counts, homes }
}

/**
 * Re-derive `_origin` for a RESTORED graph's discovered nodes. A live
 * discovery gets its origin stamped by useDiscovery's merge, but a save
 * folds discoveries into the graph itself, so a reopened session arrives
 * with plain `discovered` nodes and no stamps — without this, the expansion
 * groups would silently fall back into the seed's sectors after every
 * restore. Same rule as the live merge: the origin is the other endpoint of
 * the node's first edge, when that endpoint isn't the seed.
 *
 * @param nodes The freshly built sim nodes (mutated in place).
 * @param links The sim links (`_s`/`_t` raw endpoint ids).
 * @param seedId The graph's seed id (a seed-anchored discovery is no satellite).
 */
export function deriveOrigins(
  nodes: VNode[],
  links: { _s: string; _t: string }[],
  seedId: string,
): void {
  for (const node of nodes) {
    if (!node.discovered) continue
    const edge = links.find((link) => link._s === node.id || link._t === node.id)
    if (!edge) continue
    const other = edge._s === node.id ? edge._t : edge._s
    if (other !== seedId) node._origin = other
  }
}

/**
 * Hold a node's velocity to its share of the trip left ({@link GLIDE}),
 * never below {@link MAX_SPEED}, direction kept.
 *
 * @param node The node (mutated).
 * @param distance How far the node is from where it's going.
 */
export function capSpeed(node: VNode, distance: number): void {
  const limit = Math.max(MAX_SPEED, GLIDE * distance)
  const speed = Math.hypot(node.vx ?? 0, node.vy ?? 0)
  if (speed <= limit) return
  node.vx = ((node.vx ?? 0) * limit) / speed
  node.vy = ((node.vy ?? 0) * limit) / speed
}

/**
 * Build the clustering force. d3 contract: a function of `alpha` with an
 * `initialize(nodes)` the simulation calls whenever its node list changes —
 * which is where the seed handle and the plan refresh, so filter changes and
 * expansions re-balance the layout for free.
 *
 * It is also where every node's speed is capped ({@link capSpeed}), so
 * nodes glide rather than jump: the forces run in the order they were
 * registered and this one comes after link, charge and collide, so the cap
 * sees their pushes too before d3 moves anything.
 *
 * The seed is left free: it has to slide out of its citers to the apex of
 * their cone. Held at the centre, the citers had to go round it and set into
 * a ring all the way round the seed (tried and reverted in v8.18.0).
 *
 * @param linksOf The graph's links, read at each initialization (for the bridges).
 * @returns The custom force, ready for `fg.d3Force('cluster', ...)`.
 */
export function clusterForce(linksOf: () => PlanLink[] = () => []) {
  let nodes: VNode[] = []
  let seed: VNode | undefined
  let plan: LayoutPlan = layoutPlan([], [])

  const force = (alpha: number) => {
    if (!seed || typeof seed.x !== 'number' || typeof seed.y !== 'number') return
    for (const node of nodes) {
      if (node.is_seed) continue
      const home = plan.homes.get(node.id)
      if (!home) continue
      const pull = plan.groups.groupOf.has(node.id) || plan.bridges.has(node.id) ? GROUP_PULL : PULL
      node.vx = (node.vx ?? 0) + (seed.x + home.dx - (node.x ?? 0)) * pull * alpha
      node.vy = (node.vy ?? 0) + (seed.y + home.dy - (node.y ?? 0)) * pull * alpha
    }
    for (const node of nodes) {
      // Measured to its home, or, with none, to the seed (or the centre, for
      // the seed itself): roughly how far it has to go.
      const home = plan.homes.get(node.id)
      const targetX = node.is_seed ? 0 : seed.x + (home?.dx ?? 0)
      const targetY = node.is_seed ? 0 : seed.y + (home?.dy ?? 0)
      capSpeed(node, Math.hypot(targetX - (node.x ?? 0), targetY - (node.y ?? 0)))
    }
  }
  force.initialize = (simNodes: VNode[]) => {
    nodes = simNodes
    seed = simNodes.find((node) => node.is_seed)
    plan = layoutPlan(simNodes, linksOf())
  }
  return force
}
