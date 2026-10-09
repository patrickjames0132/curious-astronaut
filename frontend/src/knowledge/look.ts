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

import { useCallback, useMemo, useRef } from 'react'
import { REL_COLOR } from '../graph/theme'
import type { KnowledgeMap, KnowledgeNode } from './model'

/** Fill per role: the paper in gold (as on the citation graph), concepts in violet. */
export const KNOWLEDGE_COLOR = {
  root: REL_COLOR.seed,
  concept: '#b197fc',
  /** Visited and known items fade to this. */
  done: '#8b93a7',
  /** The ✓ on a known item — the citation graph's citation green. */
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
}

/** A "needs" edge as the engine holds it (ids until the engine resolves them). */
export interface CanvasLink {
  source: string | CanvasNode
  target: string | CanvasNode
}

/**
 * A node's state for painting.
 *
 * @param map The course.
 * @param node The item.
 * @returns Its colour and whether it is greyed out.
 */
export function nodeLook(
  map: KnowledgeMap,
  node: KnowledgeNode,
): { color: string; faded: boolean } {
  const known = map.known.includes(node.id)
  const faded = known || !!node.visited
  const base = node.id === map.rootId ? KNOWLEDGE_COLOR.root : KNOWLEDGE_COLOR.concept
  return { color: faded ? KNOWLEDGE_COLOR.done : base, faded }
}

/** Which nodes are named on the canvas: the neighbourhood in focus, or all of them. */
export type LabelMode = 'nearby' | 'all'

/**
 * Whether a node's label is drawn. "Nearby" (the default, to keep a growing
 * course readable) names the paper, the item in focus — the open lesson, or
 * the paper when none is open — everything joined to it, and the node under
 * the pointer.
 *
 * @param map The course.
 * @param nodeId The node.
 * @param mode Nearby or all.
 * @param hoverId The node under the pointer, if any.
 * @returns True to draw its label.
 */
export function labelled(
  map: KnowledgeMap,
  nodeId: string,
  mode: LabelMode,
  hoverId: string | null,
): boolean {
  if (mode === 'all' || nodeId === map.rootId || nodeId === hoverId) return true
  const focus = map.openId ?? map.rootId
  if (nodeId === focus) return true
  return map.edges.some(
    (edge) =>
      (edge.from === focus && edge.to === nodeId) || (edge.to === focus && edge.from === nodeId),
  )
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
 * down — the same gesture the citation graph uses to re-seed on a node.
 *
 * @param onOpen Open an item's lesson.
 * @param onExpand Break an item down.
 * @returns The engine's `onNodeClick` handler.
 */
export function useNodeClicks(
  onOpen: (nodeId: string) => void,
  onExpand: (nodeId: string) => void,
): (node: CanvasNode) => void {
  const last = useRef({ id: '', time: 0 })
  return useCallback(
    (node: CanvasNode) => {
      const now = performance.now()
      if (last.current.id === node.id && now - last.current.time < DOUBLE_CLICK_MS) {
        last.current = { id: '', time: 0 }
        onExpand(node.id)
        return
      }
      last.current = { id: node.id, time: now }
      onOpen(node.id)
    },
    [onOpen, onExpand],
  )
}
