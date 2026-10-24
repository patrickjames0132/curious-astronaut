/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What the knowledge graph looks like and how its data reaches the canvas —
 * shared by the 2D and 3D views so the two can never disagree about which
 * node is the paper, what grey means, or where a new node appears.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { REL_COLOR, SELECTION_RING, dimColor, type CanvasInk } from '../graph/theme'
import { missingChildren, synthesisLinks, type KnowledgeMap, type KnowledgeNode } from './model'
import { ROW_GAP, type Spot } from './pyramid'

/** Fill per role: the paper in gold (as on the citation graph), concepts in violet. */
export const KNOWLEDGE_COLOR = {
  root: REL_COLOR.seed,
  concept: '#b197fc',
  /** A concept not yet explored (never opened or broken down): it turns
   *  violet once explored (v8.17.0). */
  fresh: '#a7afbd',
  /** A known item's fill — the citation graph's citation green. Until v8.17.0
   *  a known item was grey with a ✓ on it. */
  known: REL_COLOR.citation,
  /** A synthesis (v8.23.0): teal, a hue nothing else on the course uses. Green
   *  once known, like a concept. */
  synthesis: '#38d9a9',
} as const

/** A synthesis's line, a step fainter than its fill (v8.23.0). */
export const SYNTHESIS_EDGE = 'rgba(56,217,169,0.55)'
/** The same line where a focus has dimmed it (v8.24.0): its teal, faint. */
export const SYNTHESIS_EDGE_DIM = 'rgba(56,217,169,0.2)'

/** A node as the force engine holds it: our node plus the engine's position fields. */
export interface CanvasNode {
  id: string
  // oxlint-disable-next-line id-length -- the force engine's own field names
  x?: number
  // oxlint-disable-next-line id-length
  y?: number
  // oxlint-disable-next-line id-length
  z?: number
  /** The engine's velocity, which a custom force nudges. */
  vx?: number
  vy?: number
  vz?: number
  /** The engine's fixed position: set by a drag to pin a node, cleared by Release. */
  fx?: number
  fy?: number
  fz?: number
}

/**
 * Pin a dragged node where it was dropped, as the citation graph does.
 *
 * @param node The node, as the engine holds it.
 */
export function pinNode(node: CanvasNode): void {
  node.fx = node.x
  node.fy = node.y
  if (node.z !== undefined) node.fz = node.z
}

/**
 * Unpin every node.
 *
 * @param nodes The view's nodes.
 */
export function releaseNodes(nodes: CanvasNode[]): void {
  for (const node of nodes) {
    node.fx = undefined
    node.fy = undefined
    node.fz = undefined
  }
}

/** A "needs" edge as the engine holds it (ids until the engine resolves them). */
export interface CanvasLink {
  source: string | CanvasNode
  target: string | CanvasNode
  /** A synthesis's line (v8.23.0), drawn dashed: never a "needs" edge. */
  synthesis?: boolean
}

/**
 * A node's fill (v8.17.0, Patrick). A known item is **green**. A concept is
 * **grey** until it has been explored (its lesson opened, or broken down) and
 * **violet** after; the paper is always gold. Outlines follow the citation
 * graph and are the views' business: black on every node, the canvas's hard
 * ink on the open one, the selection blue on picked ones. Until
 * v8.17.0 an opened item was grey and a known one grey with a ✓, and a
 * dashed ring marked "more to break down", which was nearly always true,
 * since the tutor can keep breaking anything down.
 *
 * @param map The course.
 * @param node The item.
 * @returns Its fill colour.
 */
export function nodeLook(map: KnowledgeMap, node: KnowledgeNode): { color: string } {
  if (node.kind === 'synthesis')
    return {
      color: map.known.includes(node.id) ? KNOWLEDGE_COLOR.known : KNOWLEDGE_COLOR.synthesis,
    }
  // A lesson waiting to be rewritten after a "Break it down again" reads as
  // new again, whatever its breakdown, until it is opened (v8.23.0, Patrick).
  const explored = (!!node.visited || !!node.expanded) && !node.freshLesson
  const base =
    node.id === map.rootId
      ? KNOWLEDGE_COLOR.root
      : explored
        ? KNOWLEDGE_COLOR.concept
        : KNOWLEDGE_COLOR.fresh
  return {
    color: map.known.includes(node.id) ? KNOWLEDGE_COLOR.known : base,
  }
}

/**
 * A node's fill when the focus has dimmed it (v8.23.0): its own colour
 * faded, as on the citation graph, so known, explored and new still read
 * behind a focus.
 *
 * @param map The course.
 * @param node The item.
 * @returns The faded fill.
 */
export function dimLook(map: KnowledgeMap, node: KnowledgeNode): string {
  return dimColor(nodeLook(map, node).color)
}

/**
 * The id at one end of an edge, before or after the engine resolves it.
 *
 * @param end The end: an id, or the engine's node.
 * @returns The id.
 */
function endId(end: string | CanvasNode): string {
  return typeof end === 'string' ? end : end.id
}

/**
 * Whether an edge stays lit, by the citation graph's rule (`graph/model`'s
 * `edgeLit`, v8.23.0 here): under a focused item only its own edges; under a
 * find, those touching a match; with no focus, every edge.
 *
 * @param link The edge.
 * @param lit The lit items, or null for no focus.
 * @param anchorId The item in focus, or null.
 * @returns True to draw it in full colour.
 */
export function linkLit(
  link: CanvasLink,
  lit: ReadonlySet<string> | null,
  anchorId: string | null,
): boolean {
  if (!lit) return true
  const ends = [endId(link.source), endId(link.target)]
  if (anchorId) return ends.includes(anchorId)
  return ends.some((end) => lit.has(end))
}

/**
 * Whether an edge touches an item.
 *
 * @param link The edge.
 * @param nodeId The item, or null.
 * @returns True when one end is it.
 */
export function touches(link: CanvasLink, nodeId: string | null): boolean {
  return !!nodeId && (endId(link.source) === nodeId || endId(link.target) === nodeId)
}

/**
 * An edge's colour (v8.24.0), the one rule both views paint by. A "needs"
 * edge is a neutral slate, a hue no node uses (Patrick: violet read as a
 * concept, and a synthesis's line is teal): fainter where a focus dims it,
 * brighter where a focus that isn't its own lights it (a hovered neighbour,
 * a find), and the selection blue on the open item's own edges. A synthesis's
 * line keeps its teal, faint when dimmed.
 *
 * @param link The edge.
 * @param lit The lit items, or null with no focus.
 * @param anchorId The focused item, whose own edges alone stay lit.
 * @param openId The item whose lesson is open.
 * @param ink The theme's canvas inks.
 * @param bright Paint every undimmed edge the brighter slate: 3D, which has
 *   no hover to brighten one and draws its lines at reduced opacity, so the
 *   plain slate read as permanently dark there (Patrick).
 * @returns The colour.
 */
export function edgeColor(
  link: CanvasLink,
  lit: ReadonlySet<string> | null,
  anchorId: string | null,
  openId: string | null,
  ink: CanvasInk,
  bright = false,
): string {
  if (!linkLit(link, lit, anchorId))
    return link.synthesis ? SYNTHESIS_EDGE_DIM : ink.knowledgeEdgeDim
  if (touches(link, openId)) return SELECTION_RING
  if (link.synthesis) return SYNTHESIS_EDGE
  return lit || bright ? ink.knowledgeEdgeLit : ink.knowledgeEdge
}

/** Zoom past which the 2D view names every node. Lower than the citation
 *  graph's 1.6 (`graph/canvas/GraphCanvas.tsx`): a course is smaller and
 *  sparser, so its names can stay on further out (Patrick, v8.17.0). */
export const LABEL_ZOOM = 0.6

/**
 * Whether a node's label is drawn, by the citation graph's rule (v8.17.0),
 * with its own threshold: zoomed in past `LABEL_ZOOM`, every node is named; zoomed out, only the
 * paper, the open item, picked items and the node under the pointer keep
 * their names. The 3D view passes no zoom and names everything: its labels
 * shrink with distance, which does the same job. (Until v8.17.0 a Nearby /
 * All toggle chose between naming the neighbourhood in focus and every node.)
 *
 * @param map The course.
 * @param nodeId The node.
 * @param hoverId The node under the pointer, if any.
 * @param picked Whether the node is picked to check off.
 * @param zoom The 2D canvas's zoom; omitted in 3D.
 * @returns True to draw its label.
 */
export function labelled(
  map: KnowledgeMap,
  nodeId: string,
  hoverId: string | null,
  picked: boolean,
  zoom?: number,
): boolean {
  if (zoom === undefined || zoom > LABEL_ZOOM) return true
  return nodeId === map.rootId || nodeId === map.openId || nodeId === hoverId || picked
}

/**
 * A node's radius in graph units: the paper larger than its concepts.
 *
 * @param map The course.
 * @param node The item.
 * @returns The radius.
 */
export function nodeRadius(map: KnowledgeMap, node: KnowledgeNode): number {
  if (node.kind === 'synthesis') return 6.5
  return node.id === map.rootId ? 9 : 5.5
}

/** The hidden-count badge's red (v8.26.0), a notification count's. */
export const HIDDEN_BADGE = '#e5484d'

/**
 * How many of each item's breakdown are hidden (v8.26.0), for the badge on
 * its node: the count a double-click (or the panel's Unhide) brings back.
 *
 * @param map The course.
 * @returns Item id → count, only for items with any hidden.
 */
export function hiddenCounts(map: KnowledgeMap): Map<string, number> {
  const counts = new Map<string, number>()
  for (const node of Object.values(map.nodes)) {
    if (!node.expanded) continue
    const count = missingChildren(map, node.id).length
    if (count) counts.set(node.id, count)
  }
  return counts
}

/**
 * A badge's words: the count, and "9+" past nine, as a notification's.
 *
 * @param count How many are hidden.
 * @returns The text.
 */
export function badgeText(count: number): string {
  return count > 9 ? '9+' : String(count)
}

/**
 * A label short enough to sit under a node.
 *
 * @param title The full title.
 * @returns At most 34 characters.
 */
export function shortLabel(title: string): string {
  return title.length > 34 ? `${title.slice(0, 32).trimEnd()}…` : title
}

/**
 * The engine's graph data, kept **stable across updates**: the force engine
 * writes positions onto node objects, so an item already on screen keeps its
 * object (and its place), and a new prerequisite starts beside the item that
 * needs it rather than flying in from the origin.
 *
 * @param map The course.
 * @returns Nodes and links for react-force-graph.
 */
export function useGraphData(map: KnowledgeMap): { nodes: CanvasNode[]; links: CanvasLink[] } {
  const objects = useRef(new Map<string, CanvasNode>())
  return useMemo(() => {
    const kept = objects.current
    for (const id of Object.keys(map.nodes)) {
      if (kept.has(id)) continue
      // A synthesis starts beside its first concept.
      const parent = map.edges.find((edge) => edge.to === id)
      const member = map.nodes[id].members?.[0]
      const anchor = parent ? kept.get(parent.from) : member ? kept.get(member) : undefined
      const jitter = () => (Math.random() - 0.5) * 30
      // A z only in 3D, where the anchor has one: a 2D node given a z made
      // the centring force average z over the course, which turned every
      // other node's missing z into NaN, and the hierarchy force spread it
      // to x and y, so a synthesis blanked the graph (v8.23.0).
      kept.set(
        id,
        anchor?.x !== undefined
          ? {
              id,
              x: anchor.x + jitter(),
              y: (anchor.y ?? 0) + jitter(),
              ...(anchor.z !== undefined && { z: anchor.z + jitter() }),
            }
          : { id },
      )
    }
    for (const id of [...kept.keys()]) if (!map.nodes[id]) kept.delete(id)
    return {
      nodes: [...kept.values()],
      links: [
        ...map.edges.map((edge) => ({ source: edge.from, target: edge.to })),
        ...synthesisLinks(map).map((link) => ({
          source: link.from,
          target: link.to,
          synthesis: true,
        })),
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- synthesisLinks reads map.nodes only
  }, [map.nodes, map.edges])
}

/** How long two clicks on one node may be apart and still count as a double-click. */
const DOUBLE_CLICK_MS = 350

/**
 * Click and double-click on a node, which the force engine doesn't tell apart:
 * a click opens the lesson, a quick second click on the same node breaks it
 * down (the citation graph's re-seed gesture until v8.21.0, when it went). A
 * shift-click adds the node to, or takes it out of, the selection (v8.17.0),
 * again as on the citation graph, and never opens or breaks anything down.
 *
 * **A slower second click on the open item closes it** (v8.23.0, Patrick, as
 * on the citation graph), letting go of its focus. So that it can't swallow
 * the double-click, a click on the open item waits out the double-click
 * window first: a second click inside it breaks the item down instead, and
 * only a lone click closes. Until v8.23.0 it re-centred the item.
 *
 * @param openId The item whose lesson is open, if any.
 * @param onOpen Open an item's lesson.
 * @param onExpand Break an item down.
 * @param onSelect Toggle an item in the selection.
 * @param onClose Close the open lesson.
 * @returns The engine's `onNodeClick` handler.
 */
export function useNodeClicks(
  openId: string | null,
  onOpen: (nodeId: string) => void,
  onExpand: (nodeId: string) => void,
  onSelect: (nodeId: string) => void,
  onClose: () => void,
): (node: CanvasNode, event?: MouseEvent) => void {
  const last = useRef({ id: '', time: 0 })
  const closing = useRef<number | null>(null)
  const cancelClose = useCallback(() => {
    if (closing.current === null) return
    clearTimeout(closing.current)
    closing.current = null
  }, [])
  useEffect(() => cancelClose, [cancelClose])
  return useCallback(
    (node: CanvasNode, event?: MouseEvent) => {
      cancelClose()
      if (event?.shiftKey) {
        last.current = { id: '', time: 0 }
        onSelect(node.id)
        return
      }
      const now = performance.now()
      if (last.current.id === node.id && now - last.current.time < DOUBLE_CLICK_MS) {
        last.current = { id: '', time: 0 }
        onExpand(node.id)
        return
      }
      last.current = { id: node.id, time: now }
      if (node.id === openId) {
        closing.current = window.setTimeout(() => {
          closing.current = null
          onClose()
        }, DOUBLE_CLICK_MS)
        return
      }
      onOpen(node.id)
    },
    [openId, onOpen, onExpand, onSelect, onClose, cancelClose],
  )
}

/**
 * Run `fit` when the Fit button's signal changes, and only then: never for the
 * value the view mounted with. The signal lives in `KnowledgeNetwork` and so
 * outlives a 2D/3D switch. Firing it on mount fitted the camera to a course
 * whose nodes had only their starting positions, bunched at the centre, and
 * the course then spread out around a camera parked inside it: the 3D view
 * came up blank whenever Fit had been pressed before the switch (v8.17.0).
 *
 * @param signal The Fit button's counter.
 * @param fit Frame the course.
 */
export function useFitButton(signal: number, fit: () => void): void {
  const seen = useRef(signal)
  const latest = useRef(fit)
  latest.current = fit
  useEffect(() => {
    if (signal === seen.current) return
    seen.current = signal
    latest.current()
  }, [signal])
}

/** The gap between the course's rings (v8.23.0): an item one step from the
 *  paper sits this far out, two steps twice that, a radial tree. A little
 *  more than the links' 48 at rest, so a ring has room between its items. */
export const LEVEL_GAP = 70
/** How hard an item is drawn to its ring, against the charge and links. */
export const LEVEL_STRENGTH = 0.25
/** Where a synthesis of plain concepts sits, in level gaps outward from the
 *  item it builds toward; one more level of synthesis inside it divides it
 *  (so a synthesis of syntheses sits closer: the more abstract, the nearer
 *  its parent, Patrick). */
export const SYNTHESIS_REACH = 0.6
/** How hard a synthesis is drawn to its spot. */
export const SYNTHESIS_STRENGTH = 0.3
/** A synthesis's dashed lines to its members barely pull, so they don't
 *  drag it out among them on the rings. */
export const MEMBER_LINK_STRENGTH = 0.03
/** A link's length at rest; a synthesis's line to its parent is shorter. */
export const LINK_DISTANCE = 48

/**
 * Each item's ring: the fewest "needs" steps from the paper (its route's
 * length, as `routeTo` measures it), the paper 0. Syntheses have none: they
 * are placed by their parent instead.
 *
 * @param map The course.
 * @returns Ring per item id.
 */
export function courseDepths(map: KnowledgeMap): Map<string, number> {
  const depths = new Map([[map.rootId, 0]])
  const queue = [map.rootId]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of map.edges) {
      if (edge.from !== current || depths.has(edge.to)) continue
      depths.set(edge.to, depths.get(current)! + 1)
      queue.push(edge.to)
    }
  }
  return depths
}

/**
 * How abstract a synthesis is: 1 for one of plain concepts, one more for
 * each level of synthesis inside it.
 *
 * @param map The course.
 * @param synthesisId The synthesis.
 * @param seen Guards against a loop (none should exist; see `withSynthesis`).
 * @returns Its height, at least 1.
 */
export function synthesisHeight(
  map: KnowledgeMap,
  synthesisId: string,
  seen: Set<string> = new Set(),
): number {
  if (seen.has(synthesisId)) return 1
  seen.add(synthesisId)
  let inner = 0
  for (const member of map.nodes[synthesisId]?.members ?? [])
    if (map.nodes[member]?.kind === 'synthesis')
      inner = Math.max(inner, synthesisHeight(map, member, seen))
  return inner + 1
}

/**
 * The force that keeps the course a tree (v8.23.0, Patrick: "keeping the
 * nodes in a more hierarchical tree-like structure"). Two pulls:
 *
 * - **Rings.** Each item is drawn to the ring at its depth (`courseDepths`)
 *   around the paper, so what an item needs sits outside it.
 * - **Syntheses beside their parent.** A synthesis is drawn to a spot just
 *   outside the item it builds toward, on the side its members lie,
 *   `SYNTHESIS_REACH / height` level gaps out (`synthesisHeight`): the more
 *   abstract, the nearer its parent, whatever that parent is. The first cut
 *   (a spot 60% of the way from its members to the target) left a synthesis
 *   of deep concepts far out among them.
 *
 * Works in 2D and 3D (z is used only when finite: see `hasZ`). d3 calls it
 * with alpha.
 *
 * @param map The course.
 * @param nodes The engine's nodes.
 * @returns The force.
 */
export function hierarchyForce(map: KnowledgeMap, nodes: CanvasNode[]): (alpha: number) => void {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const depths = courseDepths(map)
  const heights = new Map(
    Object.values(map.nodes)
      .filter((node) => node.kind === 'synthesis')
      .map((node) => [node.id, synthesisHeight(map, node.id)]),
  )
  return (alpha: number) => {
    const root = byId.get(map.rootId)
    if (root?.x === undefined || root.y === undefined) return
    for (const node of nodes) {
      if (node.id === map.rootId || node.x === undefined || node.y === undefined) continue
      const item = map.nodes[node.id]
      if (!item) continue
      if (item.kind === 'synthesis') {
        placeSynthesis(
          node,
          item.members ?? [],
          item.toward,
          heights.get(node.id) ?? 1,
          byId,
          alpha,
        )
        continue
      }
      const depth = depths.get(node.id)
      if (depth === undefined) continue
      const offX = node.x - root.x
      const offY = node.y - root.y
      const inDepth = hasZ(node) && hasZ(root)
      const offZ = inDepth ? node.z! - root.z! : 0
      const distance = Math.hypot(offX, offY, offZ)
      if (!(distance > 1e-6)) continue
      const pull = ((depth * LEVEL_GAP - distance) / distance) * LEVEL_STRENGTH * alpha
      node.vx = (node.vx ?? 0) + offX * pull
      node.vy = (node.vy ?? 0) + offY * pull
      if (inDepth) node.vz = (node.vz ?? 0) + offZ * pull
    }
  }
}

/**
 * Whether a node has a real depth: in 3D it does; in 2D its z is missing, and
 * a NaN one must never leak into x and y.
 *
 * @param node The node.
 * @returns True when its z is a finite number.
 */
function hasZ(node: CanvasNode): boolean {
  return Number.isFinite(node.z)
}

/**
 * Draw one synthesis toward its spot beside its parent (see `hierarchyForce`).
 *
 * @param node The synthesis, as the engine holds it.
 * @param members Its members' ids.
 * @param towardId The item it builds toward.
 * @param height How abstract it is.
 * @param byId The engine's nodes by id.
 * @param alpha The simulation's alpha.
 */
function placeSynthesis(
  node: CanvasNode,
  members: string[],
  towardId: string | undefined,
  height: number,
  byId: Map<string, CanvasNode>,
  alpha: number,
): void {
  const toward = towardId ? byId.get(towardId) : undefined
  const placed = members
    .map((id) => byId.get(id))
    .filter((member): member is CanvasNode => member?.x !== undefined)
  if (toward?.x === undefined || toward.y === undefined || !placed.length) return
  const mean = (pick: (member: CanvasNode) => number) =>
    placed.reduce((sum, member) => sum + pick(member), 0) / placed.length
  const awayX = mean((member) => member.x ?? 0) - toward.x
  const awayY = mean((member) => member.y ?? 0) - toward.y
  const inDepth = hasZ(node) && hasZ(toward) && placed.every(hasZ)
  const awayZ = inDepth ? mean((member) => member.z!) - toward.z! : 0
  const length = Math.hypot(awayX, awayY, awayZ)
  if (!(length > 1e-6)) return
  const reach = (SYNTHESIS_REACH * LEVEL_GAP) / height / length
  const pull = SYNTHESIS_STRENGTH * alpha
  node.vx = (node.vx ?? 0) + (toward.x + awayX * reach - (node.x ?? 0)) * pull
  node.vy = (node.vy ?? 0) + (toward.y + awayY * reach - (node.y ?? 0)) * pull
  if (inDepth) node.vz = (node.vz ?? 0) + (toward.z! + awayZ * reach - node.z!) * pull
}

/**
 * Register `hierarchyForce` on a view's engine and set every link's length
 * and pull, again whenever the course or its nodes change:
 *
 * - **A synthesis's line to its parent** is a short, full-strength spring,
 *   `SYNTHESIS_REACH / height` level gaps long. The spot alone was too soft:
 *   the charge of the items around it pushed a synthesis two gaps out
 *   (Patrick: "the diamond isn't close to the parent"). The spring holds the
 *   distance; the spot still picks the side.
 * - **Its lines to its members** barely pull (`MEMBER_LINK_STRENGTH`).
 * - **Every other link** keeps d3's own strength, one over the busier end's
 *   count, at `LINK_DISTANCE`.
 *
 * @param fgRef The engine's handle.
 * @param map The course.
 * @param data The engine's nodes and links.
 * @param data.nodes Its nodes.
 * @param data.links Its links.
 * @param enabled False in the pyramid, which places nodes by its own pull.
 */
export function useHierarchyForce(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: { current: any },
  map: KnowledgeMap,
  data: { nodes: CanvasNode[]; links: CanvasLink[] },
  enabled = true,
): void {
  useEffect(() => {
    const engine = fgRef.current
    if (!engine || !enabled) return
    engine.d3Force('hierarchy', hierarchyForce(map, data.nodes))
    const count = new Map<string, number>()
    for (const link of data.links)
      for (const end of [endId(link.source), endId(link.target)])
        count.set(end, (count.get(end) ?? 0) + 1)
    const toParent = (link: CanvasLink) =>
      !!link.synthesis && map.nodes[endId(link.target)]?.toward === endId(link.source)
    engine
      .d3Force('link')
      ?.distance((link: CanvasLink) =>
        toParent(link)
          ? (SYNTHESIS_REACH * LEVEL_GAP) / synthesisHeight(map, endId(link.target))
          : LINK_DISTANCE,
      )
      .strength((link: CanvasLink) => {
        if (toParent(link)) return 1
        if (link.synthesis) return MEMBER_LINK_STRENGTH
        return (
          1 /
          Math.max(
            1,
            Math.min(count.get(endId(link.source)) ?? 1, count.get(endId(link.target)) ?? 1),
          )
        )
      })
  }, [fgRef, map, data, enabled])
}

/** How hard the pyramid pulls a node to its spot, every tick (v8.37.0). Not
 *  scaled by alpha, so the nodes reach their rows before the engine cools. */
export const PYRAMID_PULL = 0.2

/**
 * Lay the pyramid out on a view's engine (v8.37.0): the charge, links and
 * centring are switched off and each node is pulled straight to its spot
 * (`pyramidLayout`), so a new breakdown's concepts glide into their rows from
 * beside the item that needs them.
 *
 * @param fgRef The engine's handle.
 * @param data The engine's nodes and links.
 * @param data.nodes Its nodes.
 * @param data.links Its links.
 * @param spots Each item's spot, or null outside the pyramid.
 */
export function usePyramidForce(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: { current: any },
  data: { nodes: CanvasNode[]; links: CanvasLink[] },
  spots: ReadonlyMap<string, Spot> | null,
): void {
  useEffect(() => {
    const engine = fgRef.current
    if (!engine || !spots) return
    engine.d3Force('charge')?.strength(0)
    engine.d3Force('link')?.strength(0)
    engine.d3Force('center', null)
    engine.d3Force('pyramid', () => {
      for (const node of data.nodes) {
        const spot = spots.get(node.id)
        if (!spot || node.x === undefined || node.y === undefined) continue
        node.vx = (node.vx ?? 0) + (spot.x - node.x) * PYRAMID_PULL
        node.vy = (node.vy ?? 0) + (spot.y - node.y) * PYRAMID_PULL
      }
    })
  }, [fgRef, data, spots])
}

/** How far a pyramid line spanning several rows bends (react-force-graph's
 *  curvature: a fraction of the line's length). */
export const PYRAMID_CURVE = 0.25

/**
 * How much a pyramid line bends (v8.37.0): straight between neighbouring
 * rows, curved when it spans more, so it can't run straight through an item
 * on a row between (the rows raise what they can, `pyramidRows`, but an item
 * needed both low and high has to stay low).
 *
 * @param link The line.
 * @param spots Each item's spot.
 * @returns The curvature, 0 for straight.
 */
export function pyramidCurve(link: CanvasLink, spots: ReadonlyMap<string, Spot>): number {
  const from = spots.get(endId(link.source))
  const to = spots.get(endId(link.target))
  return from && to && Math.abs(to.y - from.y) > ROW_GAP * 1.5 ? PYRAMID_CURVE : 0
}

/**
 * Whether a line runs into an item the course skips (v8.37.0), so the
 * pyramid fades it with the item.
 *
 * @param link The line.
 * @param skipped The skipped items.
 * @returns True when its far end is skipped.
 */
export function intoSkipped(link: CanvasLink, skipped: ReadonlySet<string>): boolean {
  return skipped.has(endId(link.target))
}
