/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge network's data and the pure rules over it. The course is a
 * **graph** of ideas: the paper, and one node per concept, with an edge from
 * an item to each concept it needs. A concept two items share is one node
 * with two edges pointing at it. Papers appear only as citations inside
 * lessons (`KnowledgeNode.refs`), never as nodes. No React, no store — the explorations
 * slice calls these from its reducers, and the tests call them directly.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { KnowledgeChild, KnowledgeKind, KnowledgePaper, KnowledgeStep, PaperRef } from '../api'

/** One thing to learn: the paper itself (`kind: 'paper'`, the root) or a concept. */
export interface KnowledgeNode {
  /** Its identity, from `nameKey`: one concept is one node, however it is reached. */
  id: string
  title: string
  kind: KnowledgeKind
  /** The paper's details — on the root only. */
  paper?: KnowledgePaper
  /** True once it has been broken down (it may have no prerequisites). */
  expanded?: boolean
  /** True once its lesson has been opened — the graph greys it out. */
  visited?: boolean
  /** The finished lesson's Markdown, once written. */
  lesson?: string
  /** The real papers the lesson's `[n]` markers cite, from the paper's reference list. */
  refs?: Record<string, PaperRef>
}

/** "`from` needs `to`", and what for. */
export interface KnowledgeEdge {
  from: string
  to: string
  why: string
}

/** A thread's knowledge network, saved with the thread. */
export interface KnowledgeMap {
  /** The shape's version: a course saved in another shape is started over. */
  version: 3
  rootId: string
  nodes: Record<string, KnowledgeNode>
  edges: KnowledgeEdge[]
  /** Node ids the reader has checked off as already known. */
  known: string[]
  /** The item whose lesson is open. */
  openId: string | null
}

/**
 * A name's identity: case-, space- and punctuation-blind, so "Bellman
 * equations" and "bellman-equations" are the same node.
 *
 * @param name A title or concept name.
 * @returns Its key.
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Start a course with the paper as its only node.
 *
 * @param paper The thread's paper.
 * @returns A one-node map, nothing known, nothing open.
 */
export function createMap(paper: KnowledgePaper): KnowledgeMap {
  const id = nameKey(paper.title) || 'paper'
  return {
    version: 3,
    rootId: id,
    nodes: { [id]: { id, title: paper.title, kind: 'paper', paper } },
    edges: [],
    known: [],
    openId: null,
  }
}

/**
 * Whether a saved course is in the current shape.
 *
 * @param saved Whatever the thread holds.
 * @returns True for a usable map.
 */
export function isCurrentMap(saved: unknown): saved is KnowledgeMap {
  return !!saved && (saved as { version?: number }).version === 3
}

/**
 * What an item needs, in the order the tutor listed it.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns Its prerequisites' edges.
 */
export function needs(map: KnowledgeMap, nodeId: string): KnowledgeEdge[] {
  return map.edges.filter((edge) => edge.from === nodeId)
}

/**
 * What needs an item — the reasons it is in the course.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns The edges pointing at it.
 */
export function neededBy(map: KnowledgeMap, nodeId: string): KnowledgeEdge[] {
  return map.edges.filter((edge) => edge.to === nodeId)
}

/**
 * The shortest route from the paper down to an item: the context the tutor
 * teaches it in. An item reached several ways is taught for the most direct.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns The edges from the root to it, in order (empty for the root).
 */
export function routeTo(map: KnowledgeMap, nodeId: string): KnowledgeEdge[] {
  const via = new Map<string, KnowledgeEdge>()
  const queue = [map.rootId]
  const seen = new Set(queue)
  while (queue.length) {
    const current = queue.shift()!
    if (current === nodeId) break
    for (const edge of needs(map, current)) {
      if (seen.has(edge.to)) continue
      seen.add(edge.to)
      via.set(edge.to, edge)
      queue.push(edge.to)
    }
  }
  const route: KnowledgeEdge[] = []
  let step = via.get(nodeId)
  while (step) {
    route.unshift(step)
    step = via.get(step.from)
  }
  return route
}

/**
 * The path the tutor is told about: the items above this one on its route.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns Title + kind per step, root first.
 */
export function tutorPath(map: KnowledgeMap, nodeId: string): KnowledgeStep[] {
  return routeTo(map, nodeId).map((edge) => {
    const node = map.nodes[edge.from]
    return { title: node.title, kind: node.kind }
  })
}

/**
 * Why the course needs an item, along its route ('' for the paper itself).
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns The reason on the last edge of its route.
 */
export function routeWhy(map: KnowledgeMap, nodeId: string): string {
  return routeTo(map, nodeId).at(-1)?.why ?? ''
}

/**
 * Every title the course already holds, for the tutor to reuse.
 *
 * @param map The course.
 * @returns One title per node.
 */
export function courseNames(map: KnowledgeMap): string[] {
  return Object.values(map.nodes).map((node) => node.title)
}

/**
 * Whether `target` is reachable from `start` by following "needs" edges.
 *
 * @param map The course.
 * @param start Where to walk from.
 * @param target What to look for.
 * @returns True when `start` already (transitively) needs `target`.
 */
function reaches(map: KnowledgeMap, start: string, target: string): boolean {
  const stack = [start]
  const seen = new Set<string>()
  while (stack.length) {
    const current = stack.pop()!
    if (current === target) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of needs(map, current)) stack.push(edge.to)
  }
  return false
}

/**
 * Attach an item's prerequisites. A prerequisite already on the map gets a
 * new edge rather than a second node, which is the point of a graph. An edge
 * that would close a loop (the prerequisite already needs this item) is
 * dropped, so the course always has an order.
 *
 * @param map The course.
 * @param parentId The item that was broken down.
 * @param children The tutor's prerequisites for it.
 * @returns The new map (the input is not mutated).
 */
export function withChildren(
  map: KnowledgeMap,
  parentId: string,
  children: KnowledgeChild[],
): KnowledgeMap {
  const parent = map.nodes[parentId]
  if (!parent || parent.expanded) return map
  let next: KnowledgeMap = {
    ...map,
    nodes: { ...map.nodes, [parentId]: { ...parent, expanded: true } },
    edges: [...map.edges],
  }
  for (const child of children) {
    const id = nameKey(child.name)
    if (!id || id === parentId) continue
    if (next.edges.some((edge) => edge.from === parentId && edge.to === id)) continue
    if (next.nodes[id] && reaches(next, id, parentId)) continue
    if (!next.nodes[id])
      next = {
        ...next,
        nodes: {
          ...next.nodes,
          [id]: { id, title: child.name, kind: 'concept' },
        },
      }
    next.edges.push({ from: parentId, to: id, why: child.why })
  }
  return next
}

/**
 * The course, in teaching order: every item after everything it needs (a
 * post-order walk from the paper), so the deepest unknowns come first and the
 * paper itself is the last lesson. A known item counts as done and what it
 * needs is not walked — knowing it prunes that part of the course. A shared
 * prerequisite appears once.
 *
 * @param map The course.
 * @returns Node ids in order.
 */
export function courseOrder(map: KnowledgeMap): string[] {
  const known = new Set(map.known)
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id) || !map.nodes[id]) return
    seen.add(id)
    if (!known.has(id)) for (const edge of needs(map, id)) visit(edge.to)
    order.push(id)
  }
  visit(map.rootId)
  return order
}

/**
 * How far through the course the reader is.
 *
 * @param map The course.
 * @returns Lessons in the course, and how many are still unchecked.
 */
export function progress(map: KnowledgeMap): { total: number; left: number } {
  const known = new Set(map.known)
  const order = courseOrder(map)
  return { total: order.length, left: order.filter((id) => !known.has(id)).length }
}

/**
 * The lesson after this one: the next unchecked item in course order,
 * wrapping to the first unchecked one.
 *
 * @param map The course.
 * @param currentId The lesson on screen, if any.
 * @returns The next item's id, or null when nothing is left.
 */
export function nextLesson(map: KnowledgeMap, currentId: string | null): string | null {
  const known = new Set(map.known)
  const order = courseOrder(map)
  const left = order.filter((id) => !known.has(id))
  if (!left.length) return null
  const position = currentId ? order.indexOf(currentId) : -1
  return left.find((id) => order.indexOf(id) > position && id !== currentId) ?? left[0]
}
