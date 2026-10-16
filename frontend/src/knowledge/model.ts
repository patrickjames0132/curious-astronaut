/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge network's data and the pure rules over it. The course is a
 * **graph** of ideas: the paper, and one node per concept, with an edge from
 * an item to each concept it needs. A concept two items share is one node
 * with two edges pointing at it. Papers are never nodes, and since v8.17.0
 * lessons don't cite them either (see `lessonText`). Since v8.23.0 a
 * **synthesis** can sit beside the course: several concepts synthesized
 * toward the item they build toward, with a lesson on how they combine. It
 * is never an edge (`members` and `toward` draw its links instead), but it
 * is a lesson in the plan: `courseOrder` teaches it after what it combines
 * and just before what it builds toward. No React, no store — the explorations
 * slice calls these from its reducers, and the tests call them directly.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { KnowledgeChild, KnowledgeKind, KnowledgePaper, KnowledgeStep, PaperRef } from '../api'

/** A node's kind: the paper, a concept, or a synthesis (v8.23.0). */
export type KnowledgeNodeKind = KnowledgeKind | 'synthesis'

/** One thing to learn: the paper itself (`kind: 'paper'`, the root), a
 *  concept, or a synthesis of several concepts. */
export interface KnowledgeNode {
  /** Its identity, from `nameKey`: one concept is one node, however it is
   *  reached. A synthesis's carries `SYNTHESIS_PREFIX`, so it never meets a concept's. */
  id: string
  title: string
  kind: KnowledgeNodeKind
  /** A synthesis's concepts, by id. */
  members?: string[]
  /** The item a synthesis's concepts build toward, by id. */
  toward?: string
  /** What a synthesis gives the item it builds toward. */
  why?: string
  /** The paper's details — on the root only. */
  paper?: KnowledgePaper
  /** True once it has been broken down (it may have no prerequisites). */
  expanded?: boolean
  /**
   * What its breakdown gave (v8.23.0), kept so a deleted prerequisite can be
   * brought back without asking the tutor again (`missingChildren`). A course
   * from before v8.23.0 lacks it until its first deletion fills it in from
   * the edges still there.
   */
  breakdown?: KnowledgeChild[]
  /** True once its lesson has been opened — the graph greys it out. */
  visited?: boolean
  /** The finished lesson's Markdown, once written. */
  lesson?: string
  /**
   * The items its lesson's closing "How it fits in" section was written for
   * (v8.23.0), sorted ids: when the items needing it change, that section
   * alone is rewritten (`fitIsStale`).
   */
  fitFor?: string[]
  /**
   * Its lesson is to be written afresh, past the server's cache (v8.23.0): a
   * "Break it down again" clears the item's own lesson and its new
   * breakdown's, and this asks for new ones rather than the cached copies.
   */
  freshLesson?: boolean
  /**
   * Legacy: the papers a lesson written before v8.17.0 cited with `[n]`
   * markers. Kept only so `lessonText` can take those markers out; nothing
   * writes it any more.
   */
  refs?: Record<string, PaperRef>
}

/**
 * A finished lesson as it is shown. Lessons stopped citing in v8.17.0, but a
 * course saved before then keeps lessons with `[3]` / `[3, 7]` markers. Only a
 * marker whose every number the lesson's own `refs` resolved is removed, so a
 * bracketed range like `[0, 1]` in the prose is left alone.
 *
 * @param node The item.
 * @returns Its lesson's Markdown without citation markers, or undefined.
 */
export function lessonText(node: KnowledgeNode): string | undefined {
  const cited = node.refs
  if (!node.lesson || !cited || !Object.keys(cited).length) return node.lesson
  return node.lesson.replace(/ ?\[(\d+(?:[\s,]+\d+)*)\]/g, (marker, numbers: string) =>
    numbers.split(/[\s,]+/).every((number) => number in cited) ? '' : marker,
  )
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
  /**
   * Concepts deleted from the course, by id (v8.23.0), so one that comes back
   * (a restore, or any breakdown naming it) returns as it was: its lesson,
   * its own breakdown, and its check-off.
   */
  archive?: Record<string, ArchivedNode>
}

/** A deleted concept, as it was when it went. */
export interface ArchivedNode extends KnowledgeNode {
  /** It was checked off as known. */
  wasKnown?: boolean
}

/** The heading the tutor ends a lesson with (v8.23.0; the backend's
 *  `FIT_HEADING`): what follows is shown in its own card. */
export const FIT_HEADING = '### How it fits in'

/** Where a lesson's closing section starts: the heading on its own line,
 *  matched loosely (any heading level, any case) since a model may drift. */
const FIT_MARK = /^#{2,4}\s*how it fits in\s*:?\s*$/gim

/**
 * Split a lesson at its closing "How it fits in" section (v8.23.0).
 *
 * @param text The lesson's Markdown.
 * @returns The lesson before it, and the section's body (null when the
 *   lesson has none: one written before v8.23.0, or the paper's own).
 */
export function splitLesson(text: string): { body: string; fit: string | null } {
  let start = -1
  let end = -1
  for (const match of text.matchAll(FIT_MARK)) {
    start = match.index
    end = match.index + match[0].length
  }
  if (start < 0) return { body: text, fit: null }
  return { body: text.slice(0, start).trimEnd(), fit: text.slice(end).trim() }
}

/**
 * A lesson put back together around a new closing section.
 *
 * @param body The lesson before the section.
 * @param fit The section's body.
 * @returns The whole lesson.
 */
export function joinLesson(body: string, fit: string): string {
  return `${body.trimEnd()}\n\n${FIT_HEADING}\n\n${fit.trim()}`
}

/**
 * The items an item's "How it fits in" section is about now: what needs it,
 * or a synthesis's target. Sorted ids, to compare with `fitFor`.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns Those ids.
 */
export function fitNeeds(map: KnowledgeMap, nodeId: string): string[] {
  const node = map.nodes[nodeId]
  if (!node) return []
  if (node.kind === 'synthesis') return node.toward ? [node.toward] : []
  return [...new Set(neededBy(map, nodeId).map((edge) => edge.from))].sort()
}

/**
 * Whether an item's lesson has a "How it fits in" section written for other
 * items than need it now (v8.23.0): a new parent appeared, or one went. Only
 * a lesson that knows what it was written for can say; one with nothing
 * needing it now is left as it is.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns True when the section should be rewritten.
 */
export function fitIsStale(map: KnowledgeMap, nodeId: string): boolean {
  const node = map.nodes[nodeId]
  if (!node?.lesson || !node.fitFor || splitLesson(node.lesson).fit === null) return false
  const now = fitNeeds(map, nodeId)
  return now.length > 0 && now.join('|') !== node.fitFor.join('|')
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
  return routeTo(map, nodeId).map((edge) => stepOf(map.nodes[edge.from]))
}

/**
 * An item as the tutor is told about it. A route only ever runs through the
 * paper and concepts (a synthesis is never an edge), so a synthesis can't arrive
 * here; it would be told as a concept.
 *
 * @param node The item.
 * @returns Its title and kind.
 */
export function stepOf(node: KnowledgeNode): KnowledgeStep {
  return { title: node.title, kind: node.kind === 'synthesis' ? 'concept' : node.kind }
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
  // Not the syntheses: the tutor reuses these names for concepts.
  return Object.values(map.nodes)
    .filter((node) => node.kind !== 'synthesis')
    .map((node) => node.title)
}

/** Prefixed to a synthesis's id, so it never collides with a concept's. */
export const SYNTHESIS_PREFIX = 'synthesis:'

/**
 * Whether an item can go into a synthesis: a concept, or another synthesis (so
 * syntheses can build on each other, as the pyramid's layers do), but never
 * the paper, which everything builds toward.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns True when it can be synthesized.
 */
export function synthesizable(map: KnowledgeMap, nodeId: string): boolean {
  const kind = map.nodes[nodeId]?.kind
  return kind === 'concept' || kind === 'synthesis'
}

/**
 * The concepts underneath an item: a concept itself, or a synthesis's members
 * followed down through any syntheses among them.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns The concept ids, each once.
 */
export function conceptsOf(map: KnowledgeMap, nodeId: string): string[] {
  const found = new Set<string>()
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = map.nodes[id]
    if (!node) return
    if (node.kind !== 'synthesis') found.add(id)
    else for (const member of node.members ?? []) visit(member)
  }
  visit(nodeId)
  return [...found]
}

/**
 * Whether a synthesis holds an item, directly or through the syntheses it holds.
 *
 * @param map The course.
 * @param synthesisId The synthesis.
 * @param nodeId The item.
 * @returns True when `nodeId` is somewhere inside `synthesisId`.
 */
export function holds(map: KnowledgeMap, synthesisId: string, nodeId: string): boolean {
  const stack = [...(map.nodes[synthesisId]?.members ?? [])]
  const seen = new Set<string>()
  while (stack.length) {
    const current = stack.pop()!
    if (current === nodeId) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(map.nodes[current]?.members ?? []))
  }
  return false
}

/**
 * Where a synthesis's concepts build toward (v8.23.0): the deepest item that
 * needs every one of them, directly or not, so concepts that meet under
 * Q-learning build toward Q-learning rather than the paper. A synthesis among
 * the members counts as the concepts underneath it (`conceptsOf`). The
 * paper needs everything, so there is always one. Of several equally deep,
 * the one closest to the paper.
 *
 * @param map The course.
 * @param memberIds The concepts and syntheses.
 * @returns The item's id.
 */
export function synthesisTarget(map: KnowledgeMap, memberIds: string[]): string {
  const concepts = [...new Set(memberIds.flatMap((id) => conceptsOf(map, id)))]
  const candidates = Object.values(map.nodes)
    .filter((node) => node.kind !== 'synthesis' && !concepts.includes(node.id))
    .map((node) => node.id)
    .filter((id) => concepts.every((concept) => reaches(map, id, concept)))
  const deepest = candidates.filter(
    (id) => !candidates.some((other) => other !== id && reaches(map, id, other)),
  )
  deepest.sort((left, right) => routeTo(map, left).length - routeTo(map, right).length)
  return deepest[0] ?? map.rootId
}

/**
 * The synthesis already made of exactly these concepts, if there is one.
 *
 * @param map The course.
 * @param memberIds The concepts.
 * @returns Its id, or null.
 */
export function findSynthesis(map: KnowledgeMap, memberIds: string[]): string | null {
  const wanted = [...memberIds].sort().join('|')
  const found = Object.values(map.nodes).find(
    (node) => node.kind === 'synthesis' && [...(node.members ?? [])].sort().join('|') === wanted,
  )
  return found?.id ?? null
}

/**
 * Add a synthesis (v8.23.0). One with the same name is reused, keeping its
 * lesson; a synthesis of fewer than two concepts or syntheses is not made. A
 * member that already holds this synthesis is dropped, so no synthesis ever
 * contains itself (only a reused name could try).
 *
 * @param map The course.
 * @param synthesis Its name, what it gives its target, its concepts, and the target.
 * @param synthesis.name The synthesis's name.
 * @param synthesis.why What it gives the item it builds toward.
 * @param synthesis.members The concepts, by id.
 * @param synthesis.toward The item they build toward, by id.
 * @returns The new map (the input is not mutated).
 */
export function withSynthesis(
  map: KnowledgeMap,
  synthesis: { name: string; why: string; members: string[]; toward: string },
): KnowledgeMap {
  const id = SYNTHESIS_PREFIX + nameKey(synthesis.name)
  const eligible = synthesis.members.filter(
    (member) => synthesizable(map, member) && member !== id && !holds(map, member, id),
  )
  // Already inside another member, or something another already builds on:
  // redundant (see `redundancy`).
  const members = eligible.filter(
    (member) =>
      !eligible.some(
        (other) => other !== member && (holds(map, other, member) || buildsOn(map, other, member)),
      ),
  )
  if (members.length < 2 || id === SYNTHESIS_PREFIX || !map.nodes[synthesis.toward]) return map
  const kept = map.nodes[id]
  return {
    ...map,
    nodes: {
      ...map.nodes,
      [id]: {
        ...kept,
        id,
        title: synthesis.name,
        kind: 'synthesis',
        members,
        toward: synthesis.toward,
        why: synthesis.why,
      },
    },
  }
}

/**
 * Whether one pick already builds on another through the course's own
 * "needs" edges: some concept underneath `outer` needs (transitively) some
 * other concept underneath `inner`. A concept both share doesn't count, so
 * overlapping syntheses can still be synthesized.
 *
 * @param map The course.
 * @param outer The pick that may build on the other.
 * @param inner The pick it may build on.
 * @returns True when `outer` already builds on `inner`.
 */
function buildsOn(map: KnowledgeMap, outer: string, inner: string): boolean {
  const below = conceptsOf(map, inner)
  return conceptsOf(map, outer).some((concept) =>
    below.some((other) => other !== concept && reaches(map, concept, other)),
  )
}

/**
 * Why a group can't be synthesized (Patrick, v8.23.0): one pick already holds
 * another, directly or deeper down (`includes`), or already builds on it
 * through the course's "needs" edges (`needs`: stochastic gradient descent
 * with the sample averages it needs). Either way the group says nothing new
 * and gives the tutor a muddled brief.
 *
 * @param map The course.
 * @param memberIds The picks.
 * @returns The pick that holds or builds on, the other, and which; or null.
 */
export function redundancy(
  map: KnowledgeMap,
  memberIds: string[],
): { outer: string; inner: string; how: 'includes' | 'needs' } | null {
  for (const outer of memberIds)
    for (const inner of memberIds) {
      if (outer === inner) continue
      if (holds(map, outer, inner)) return { outer, inner, how: 'includes' }
      if (buildsOn(map, outer, inner)) return { outer, inner, how: 'needs' }
    }
  return null
}

/**
 * Delete items from the course (v8.23.0), never the paper, and everything
 * that goes with them:
 *
 * - **What only they needed.** A concept no longer reachable from the paper
 *   by "needs" edges goes too; a prerequisite another item still needs
 *   stays, since the course is a graph rather than a tree.
 * - **Syntheses.** One loses a deleted member, and goes once it has fewer
 *   than two (a synthesis of one thing says nothing) or once the item it
 *   builds toward is gone, and so on up.
 *
 * Every broken-down item keeps its `breakdown` (filled in from its edges
 * first, for a course from before v8.23.0), so `withRestored` can bring a
 * deleted prerequisite back. Deleted items leave the known list, and the
 * panel closes if one was open.
 *
 * @param map The course.
 * @param nodeIds The items to delete.
 * @returns The new map (the input is not mutated).
 */
export function withoutItems(map: KnowledgeMap, nodeIds: string[]): KnowledgeMap {
  const doomed = new Set(nodeIds.filter((id) => map.nodes[id] && id !== map.rootId))
  if (!doomed.size) return map
  return pruned(remembered(map), doomed)
}

/**
 * Fill in `breakdown` on every broken-down item that lacks it, from the edges
 * it has now (a course from before v8.23.0).
 *
 * @param map The course.
 * @returns The map, each broken-down item knowing its breakdown.
 */
function remembered(map: KnowledgeMap): KnowledgeMap {
  const nodes = { ...map.nodes }
  for (const node of Object.values(map.nodes))
    if (node.expanded && !node.breakdown)
      nodes[node.id] = {
        ...node,
        breakdown: needs(map, node.id).map((edge) => ({
          name: map.nodes[edge.to]?.title ?? edge.to,
          why: edge.why,
        })),
      }
  return { ...map, nodes }
}

/**
 * Remove `doomed`, then whatever no longer hangs off the paper, then the
 * syntheses that leaves without enough members or a target (see
 * `withoutItems`).
 *
 * @param map The course.
 * @param doomed The items to remove.
 * @returns The new map.
 */
function pruned(map: KnowledgeMap, doomed: Set<string>): KnowledgeMap {
  const removed = new Set(doomed)
  // What the paper still reaches, without the doomed.
  const reached = new Set([map.rootId])
  const stack = [map.rootId]
  while (stack.length) {
    const current = stack.pop()!
    for (const edge of needs(map, current))
      if (!removed.has(edge.to) && !reached.has(edge.to)) {
        reached.add(edge.to)
        stack.push(edge.to)
      }
  }
  for (const node of Object.values(map.nodes))
    if (node.kind !== 'synthesis' && !reached.has(node.id)) removed.add(node.id)
  // Syntheses, until none changes.
  const nodes = { ...map.nodes }
  let changed = true
  while (changed) {
    changed = false
    for (const node of Object.values(nodes)) {
      if (node.kind !== 'synthesis' || removed.has(node.id)) continue
      const members = (node.members ?? []).filter((member) => !removed.has(member))
      if (members.length < 2 || !node.toward || removed.has(node.toward)) {
        removed.add(node.id)
        changed = true
      } else if (members.length !== node.members?.length) nodes[node.id] = { ...node, members }
    }
  }
  // Concepts are archived, so one that comes back returns as it was.
  const archive = { ...map.archive }
  for (const id of removed) {
    const node = map.nodes[id]
    if (node && node.kind !== 'synthesis')
      archive[id] = { ...node, ...(map.known.includes(id) && { wasKnown: true }) }
    delete nodes[id]
  }
  return {
    ...map,
    nodes,
    archive,
    edges: map.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to)),
    known: map.known.filter((id) => !removed.has(id)),
    openId: map.openId && removed.has(map.openId) ? null : map.openId,
  }
}

/**
 * The prerequisites an item's breakdown gave that the course no longer links
 * to it, because they were deleted (v8.23.0). One that couldn't be linked in
 * the first place (it would close a loop) doesn't count.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns Those prerequisites, in the breakdown's order.
 */
export function missingChildren(map: KnowledgeMap, nodeId: string): KnowledgeChild[] {
  const node = map.nodes[nodeId]
  if (!node?.breakdown) return []
  return node.breakdown.filter((child) => {
    const id = nameKey(child.name)
    if (!id || id === nodeId) return false
    if (map.edges.some((edge) => edge.from === nodeId && edge.to === id)) return false
    return !(map.nodes[id] && reaches(map, id, nodeId))
  })
}

/**
 * Bring back an item's deleted prerequisites from its remembered breakdown
 * (v8.23.0), with no call to the tutor. Each returns as it was, from the
 * archive (its lesson, check-off and own breakdown, whose deleted part it
 * can bring back in turn).
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns The new map (the input is not mutated).
 */
export function withRestored(map: KnowledgeMap, nodeId: string): KnowledgeMap {
  const missing = missingChildren(map, nodeId)
  return missing.length ? attached(map, nodeId, missing) : map
}

/**
 * Replace an item's breakdown with a fresh one (v8.23.0, "Break it down
 * again"), a clean slate for its whole branch (Patrick):
 *
 * - **The lineage goes.** Everything below the item leaves the course, as
 *   `withoutItems` takes what only a deleted item needed: a concept
 *   something outside the branch still needs stays, with what hangs under
 *   it. Keeping the subtree of a concept the new breakdown repeated (the
 *   first cut) left a grey, rewritten parent over violet children whose
 *   lessons were written for the old one.
 * - **The new breakdown starts fresh**, even when the tutor names the same
 *   concepts: new nodes, not revived from the archive (which would bring the
 *   old lessons back), marked `freshLesson` so their lessons are written past
 *   the server's cache. Breaking one down again uses the cached breakdown, so
 *   a level the reader liked comes back free. Check-offs survive.
 * - **The item's own lesson** is cleared and rewritten the same way.
 *
 * What goes is archived, as for a delete.
 *
 * @param map The course.
 * @param nodeId The item.
 * @param children The tutor's new prerequisites for it.
 * @returns The new map (the input is not mutated).
 */
export function withBreakdownAgain(
  map: KnowledgeMap,
  nodeId: string,
  children: KnowledgeChild[],
): KnowledgeMap {
  const node = map.nodes[nodeId]
  if (!node?.expanded) return withChildren(map, nodeId, children)
  // Unlink its breakdown; what only that held up goes with it.
  const base = remembered(map)
  const cleared = pruned(
    { ...base, edges: base.edges.filter((edge) => edge.from !== nodeId) },
    new Set(),
  )
  const before = new Set(Object.keys(cleared.nodes))
  const { lesson: _lesson, fitFor: _fitFor, ...item } = cleared.nodes[nodeId]
  const relinked = attached(
    {
      ...cleared,
      nodes: { ...cleared.nodes, [nodeId]: { ...item, breakdown: children, freshLesson: true } },
    },
    nodeId,
    children,
    true,
  )
  const nodes = { ...relinked.nodes }
  for (const id of Object.keys(nodes))
    if (!before.has(id)) nodes[id] = { ...nodes[id], freshLesson: true }
  return { ...relinked, nodes }
}

/**
 * An item and everything linked to it (v8.23.0, the citation graph's focus):
 * what it needs, what needs it, and the syntheses lines join it to (its
 * members and target, for a synthesis; the syntheses holding it or building
 * toward it, for anything else).
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns The ids, the item's own included.
 */
export function neighbourhood(map: KnowledgeMap, nodeId: string): Set<string> {
  const found = new Set([nodeId])
  for (const edge of map.edges) {
    if (edge.from === nodeId) found.add(edge.to)
    if (edge.to === nodeId) found.add(edge.from)
  }
  for (const link of synthesisLinks(map)) {
    if (link.from === nodeId) found.add(link.to)
    if (link.to === nodeId) found.add(link.from)
  }
  return found
}

/** A synthesis's line as drawn: to each of its concepts, and from its target. */
export interface SynthesisLink {
  from: string
  to: string
}

/**
 * The lines a course's syntheses draw (v8.23.0): from each synthesis to each of
 * its concepts, and from the item it builds toward to the synthesis, so the
 * arrows read "needs" the way the course's own edges do. Drawn only, never
 * walked: they are not `edges`.
 *
 * @param map The course.
 * @returns One line per synthesis member, plus one per synthesis to its target.
 */
export function synthesisLinks(map: KnowledgeMap): SynthesisLink[] {
  const links: SynthesisLink[] = []
  for (const node of Object.values(map.nodes)) {
    if (node.kind !== 'synthesis') continue
    for (const member of node.members ?? [])
      if (map.nodes[member]) links.push({ from: node.id, to: member })
    if (node.toward && map.nodes[node.toward]) links.push({ from: node.toward, to: node.id })
  }
  return links
}

/**
 * The items whose names contain the find bar's text (v8.20.0): a plain,
 * case-insensitive substring match, as the citation graph's find does over
 * titles. Names only: a lesson's text would match nearly any word.
 *
 * @param map The course.
 * @param query The find bar's contents.
 * @returns The matching ids, or null when the box is empty (no find running).
 */
export function findItems(map: KnowledgeMap, query: string): Set<string> | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  return new Set(
    Object.values(map.nodes)
      .filter((node) => node.title.toLowerCase().includes(needle))
      .map((node) => node.id),
  )
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
  return attached(
    {
      ...map,
      nodes: { ...map.nodes, [parentId]: { ...parent, expanded: true, breakdown: children } },
    },
    parentId,
    children,
  )
}

/**
 * Link prerequisites under an item (see `withChildren`).
 *
 * @param map The course.
 * @param parentId The item.
 * @param children The prerequisites.
 * @param fresh Put a missing one on new, never revived from the archive (a
 *              redo's clean slate).
 * @returns The new map.
 */
function attached(
  map: KnowledgeMap,
  parentId: string,
  children: KnowledgeChild[],
  fresh = false,
): KnowledgeMap {
  let next: KnowledgeMap = { ...map, edges: [...map.edges] }
  for (const child of children) {
    const id = nameKey(child.name)
    if (!id || id === parentId) continue
    if (next.edges.some((edge) => edge.from === parentId && edge.to === id)) continue
    if (next.nodes[id] && reaches(next, id, parentId)) continue
    if (!next.nodes[id])
      next = fresh ? created(next, id, child.name) : revived(next, id, child.name)
    next.edges.push({ from: parentId, to: id, why: child.why })
  }
  return next
}

/**
 * Put a concept on the course new, whatever the archive holds of it (a redo,
 * v8.23.0): its archived copy is dropped, but a check-off it had survives.
 *
 * @param map The course.
 * @param id The concept's id.
 * @param title Its name.
 * @returns The map with it on.
 */
function created(map: KnowledgeMap, id: string, title: string): KnowledgeMap {
  const { [id]: archived, ...archive } = map.archive ?? {}
  return {
    ...map,
    nodes: { ...map.nodes, [id]: { id, title, kind: 'concept' } },
    archive,
    known: archived?.wasKnown && !map.known.includes(id) ? [...map.known, id] : map.known,
  }
}

/**
 * Put a concept on the course: as it was, from the archive, when it was
 * deleted before (v8.23.0), linked again to whatever of its own breakdown is
 * still on the course; otherwise new.
 *
 * @param map The course (its `edges` may be pushed to).
 * @param id The concept's id.
 * @param title Its name, for a new one.
 * @returns The map with it on.
 */
function revived(map: KnowledgeMap, id: string, title: string): KnowledgeMap {
  const archived = map.archive?.[id]
  if (!archived) return { ...map, nodes: { ...map.nodes, [id]: { id, title, kind: 'concept' } } }
  const { wasKnown, ...node } = archived
  const { [id]: _taken, ...archive } = map.archive ?? {}
  const next: KnowledgeMap = {
    ...map,
    nodes: { ...map.nodes, [id]: node },
    archive,
    known: wasKnown && !map.known.includes(id) ? [...map.known, id] : map.known,
  }
  for (const child of node.breakdown ?? []) {
    const childId = nameKey(child.name)
    if (!next.nodes[childId] || childId === id || reaches(next, childId, id)) continue
    if (next.edges.some((edge) => edge.from === id && edge.to === childId)) continue
    next.edges.push({ from: id, to: childId, why: child.why })
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
 * Syntheses are lessons too (v8.23.0, Patrick: Next lesson should land on
 * them): each comes after everything it combines and just before the item it
 * builds toward, an inner synthesis before one holding it. One building
 * toward a known item is pruned with what that item needs. They were kept
 * out of the plan while they were optional extras.
 *
 * @param map The course.
 * @returns Node ids in order.
 */
export function courseOrder(map: KnowledgeMap): string[] {
  const known = new Set(map.known)
  const order: string[] = []
  const seen = new Set<string>()
  const towardOf = new Map<string, string[]>()
  for (const node of Object.values(map.nodes))
    if (node.kind === 'synthesis' && node.toward)
      towardOf.set(node.toward, [...(towardOf.get(node.toward) ?? []), node.id])
  const visit = (id: string) => {
    if (seen.has(id) || !map.nodes[id]) return
    seen.add(id)
    if (map.nodes[id].kind === 'synthesis') {
      // What it combines first: its concepts, and any synthesis inside it.
      for (const member of map.nodes[id].members ?? []) visit(member)
    } else if (!known.has(id)) {
      for (const edge of needs(map, id)) visit(edge.to)
      for (const synthesisId of towardOf.get(id) ?? []) visit(synthesisId)
    }
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
