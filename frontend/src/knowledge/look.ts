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
import { REL_COLOR } from '../graph/theme'
import type { KnowledgeMap, KnowledgeNode } from './model'

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
} as const

/** A node as the force engine holds it: our node plus the engine's position fields. */
export interface CanvasNode {
  id: string
  // oxlint-disable-next-line id-length -- the force engine's own field names
  x?: number
  // oxlint-disable-next-line id-length
  y?: number
  // oxlint-disable-next-line id-length
  z?: number
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
  const explored = !!node.visited || !!node.expanded
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
  return node.id === map.rootId ? 9 : 5.5
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
      const parent = map.edges.find((edge) => edge.to === id)
      const anchor = parent ? kept.get(parent.from) : undefined
      const jitter = () => (Math.random() - 0.5) * 30
      kept.set(
        id,
        anchor?.x !== undefined
          ? {
              id,
              x: anchor.x + jitter(),
              y: (anchor.y ?? 0) + jitter(),
              z: (anchor.z ?? 0) + jitter(),
            }
          : { id },
      )
    }
    for (const id of [...kept.keys()]) if (!map.nodes[id]) kept.delete(id)
    return {
      nodes: [...kept.values()],
      links: map.edges.map((edge) => ({ source: edge.from, target: edge.to })),
    }
  }, [map.nodes, map.edges])
}

/** How long two clicks on one node may be apart and still count as a double-click. */
const DOUBLE_CLICK_MS = 350

/**
 * Click and double-click on a node, which the force engine doesn't tell apart:
 * a click opens the lesson, a quick second click on the same node breaks it
 * down — the same gesture the citation graph uses to re-seed on a node. A
 * shift-click adds the node to, or takes it out of, the selection (v8.17.0),
 * again as on the citation graph, and never opens or breaks anything down.
 *
 * @param onOpen Open an item's lesson.
 * @param onExpand Break an item down.
 * @param onSelect Toggle an item in the selection.
 * @returns The engine's `onNodeClick` handler.
 */
export function useNodeClicks(
  onOpen: (nodeId: string) => void,
  onExpand: (nodeId: string) => void,
  onSelect: (nodeId: string) => void,
): (node: CanvasNode, event?: MouseEvent) => void {
  const last = useRef({ id: '', time: 0 })
  return useCallback(
    (node: CanvasNode, event?: MouseEvent) => {
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
      onOpen(node.id)
    },
    [onOpen, onExpand, onSelect],
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
