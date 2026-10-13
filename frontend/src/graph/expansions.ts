/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Which of a paper's Expand hops have run, and what undoing one takes away
 * (v8.18.0). Pure functions over the workspace's discovery lists, so the
 * answer survives a reload: those lists are saved with the thread, and an
 * expansion is nothing more than the edges and papers it added to them.
 *
 * A hop is recognised by its edges, which follow the build's direction rule
 * (citing → cited): expanding a paper's references adds `reference` edges
 * FROM it, expanding its citations adds `citation` edges TO it. Neither shape
 * can come from the other hop, and seed edges live in the graph itself, not
 * in the discovery lists, so they never count.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { ExpandHop, GraphEdge, GraphNode } from '../api'

/**
 * Whether an edge is one a hop from this paper adds.
 *
 * @param edge The edge.
 * @param nodeId The expanded paper.
 * @param hop The hop.
 * @returns True for that hop's edge.
 */
export function isHopEdge(edge: GraphEdge, nodeId: string, hop: ExpandHop): boolean {
  return hop === 'references'
    ? edge.type === 'reference' && edge.source === nodeId
    : edge.type === 'citation' && edge.target === nodeId
}

/**
 * How many papers one hop brought onto the graph, or null when it hasn't run.
 * A hop that only linked papers already there has run and brought none.
 *
 * @param nodeId The expanded paper.
 * @param hop The hop.
 * @param discoveredNodes The workspace's discovered papers.
 * @param discoveredEdges The workspace's discovered edges.
 * @returns The count, or null.
 */
export function hopAdded(
  nodeId: string,
  hop: ExpandHop,
  discoveredNodes: GraphNode[],
  discoveredEdges: GraphEdge[],
): number | null {
  const edges = discoveredEdges.filter((edge) => isHopEdge(edge, nodeId, hop))
  if (edges.length === 0) return null
  const discovered = new Set(discoveredNodes.map((node) => node.id))
  const others = new Set(edges.map((edge) => (edge.source === nodeId ? edge.target : edge.source)))
  return [...others].filter((id) => discovered.has(id)).length
}

/**
 * The discovery lists with one hop undone: its edges go, and with them every
 * discovered paper the graph can no longer reach. Reach runs over edges from
 * the graph's own papers, so a paper the hop added goes unless something else
 * still links it (another expansion did), and an expansion OF one of its
 * papers goes too, though those papers still link each other: nothing holds
 * them to the graph any more. A discovered paper that never had an edge (the
 * legacy ungrounded kind) is no one's to take away and stays.
 *
 * @param nodeId The expanded paper.
 * @param hop The hop to undo.
 * @param graph The graph's own papers and edges.
 * @param graph.nodes The graph's papers.
 * @param graph.edges The graph's edges.
 * @param discoveredNodes The workspace's discovered papers.
 * @param discoveredEdges The workspace's discovered edges.
 * @returns The lists that remain.
 */
export function withoutHop(
  nodeId: string,
  hop: ExpandHop,
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  discoveredNodes: GraphNode[],
  discoveredEdges: GraphEdge[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const remaining = discoveredEdges.filter((edge) => !isHopEdge(edge, nodeId, hop))
  const neighbours = new Map<string, string[]>()
  for (const edge of [...graph.edges, ...remaining]) {
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target])
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source])
  }
  const reached = new Set(graph.nodes.map((node) => node.id))
  const queue = [...reached]
  while (queue.length) {
    for (const next of neighbours.get(queue.pop()!) ?? []) {
      if (reached.has(next)) continue
      reached.add(next)
      queue.push(next)
    }
  }
  const everLinked = new Set(discoveredEdges.flatMap((edge) => [edge.source, edge.target]))
  const nodes = discoveredNodes.filter((node) => reached.has(node.id) || !everLinked.has(node.id))
  const kept = new Set([...graph.nodes, ...nodes].map((node) => node.id))
  const edges = remaining.filter((edge) => kept.has(edge.source) && kept.has(edge.target))
  return { nodes, edges }
}
