/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge network's calls (Phase 5b): expand one course item into
 * its prerequisites, and stream one item's lesson. Both are cached
 * server-side for good, so re-opening a course costs nothing.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { Provider } from './graph'
import { readSSE } from './sse'

/** What a course item is: the paper the course is about, or a concept it needs. */
export type KnowledgeKind = 'paper' | 'concept'

/** One step of the path the tutor is told about. */
export interface KnowledgeStep {
  title: string
  kind: KnowledgeKind
}

/** The paper a course is about. */
export interface KnowledgePaper {
  id: string
  title: string
  year?: number | null
  abstract?: string | null
  arxiv_id?: string | null
  url?: string | null
  authors?: string | null
}

/** A prerequisite concept as the tutor returns it. */
export interface KnowledgeChild {
  name: string
  why: string
}

/**
 * Break one course item into its prerequisites.
 *
 * @param body The item (with its provider id when it's the paper), the path
 *             above it (root first), names already in the course, and the
 *             provider the paper's references come from.
 * @param body.item The item being broken down.
 * @param body.path The course path above it, root first.
 * @param body.existing Names already in the course, so the tutor reuses them.
 * @param body.provider The backend the item's references come from.
 * @param body.fresh Skip the server's cached breakdown and replace it ("Break
 *                   it down again", v8.23.0).
 * @param signal Abort the request.
 * @returns The prerequisites, most essential first.
 * @throws With the server's message when the tutor fails.
 */
export async function expandKnowledge(
  body: {
    item: KnowledgeStep & { paper_id?: string }
    path: KnowledgeStep[]
    existing: string[]
    provider: Provider
    fresh?: boolean
  },
  signal?: AbortSignal,
): Promise<KnowledgeChild[]> {
  const res = await fetch('/api/knowledge/expand', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not expand (${res.status})`)
  return (data as { children: KnowledgeChild[] }).children
}

/** An item that needs a lesson's subject, and why (v8.23.0). */
export interface KnowledgeNeed extends KnowledgeStep {
  why: string
}

/**
 * Stream one course item's lesson.
 *
 * @param body The lesson's subject, why the course needs it, the path above
 *             it, the paper's abstract (for the paper's own lesson), and the
 *             course's paper (it keys the server's cache).
 * @param body.item The subject.
 * @param body.why What the item above it needs it for.
 * @param body.path The course path above it, root first.
 * @param body.needed_by Every item that needs it, with why (v8.23.0), for the
 *                       lesson's closing "How it fits in" section.
 * @param body.abstract The paper's abstract, when the item is the paper.
 * @param body.paper_id The course's paper.
 * @param body.fresh Skip the server's cached lesson and replace it (after a
 *                   "Break it down again", v8.23.0).
 * @param handlers Token, done and error callbacks, plus an abort signal.
 * @param handlers.onToken Called with each chunk of the lesson's Markdown.
 * @param handlers.onDone Called once the lesson is complete.
 * @param handlers.onError Called with the server's message on failure.
 * @param handlers.signal Abort the stream.
 */
export async function streamLesson(
  body: {
    item: KnowledgeStep
    why: string
    path: KnowledgeStep[]
    needed_by?: KnowledgeNeed[]
    abstract: string
    paper_id?: string
    fresh?: boolean
  },
  handlers: {
    onToken: (text: string) => void
    onDone: () => void
    onError: (message: string) => void
    signal?: AbortSignal
  },
): Promise<void> {
  const res = await fetch('/api/knowledge/lesson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })
  await readSSE(res, (event, data) => {
    if (event === 'token') handlers.onToken((data as { text: string }).text)
    else if (event === 'done') handlers.onDone()
    else if (event === 'error') handlers.onError((data as { message: string }).message)
  })
}

/** What a synthesis is about: its concepts, the item they build toward, and the
 *  course path above that item. */
export interface SynthesisRequest {
  members: KnowledgeStep[]
  toward: KnowledgeStep
  path: KnowledgeStep[]
  paper_id?: string
}

/** A synthesis's name, and what the combination gives the item it builds toward. */
export interface SynthesisName {
  name: string
  why: string
}

/**
 * Name a synthesis: what several concepts become together (v8.23.0).
 *
 * @param body Its concepts, target and path.
 * @returns The synthesis's name and what it gives its target.
 * @throws With the server's message when the tutor fails.
 */
export async function synthesizeKnowledge(body: SynthesisRequest): Promise<SynthesisName> {
  const res = await fetch('/api/knowledge/synthesis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not synthesize these (${res.status})`)
  return data as SynthesisName
}

/**
 * Stream a synthesis's lesson (v8.23.0): how its concepts come together.
 *
 * @param body Its name, concepts, target and path.
 * @param handlers Token, done and error callbacks.
 * @param handlers.onToken Called with each chunk of the lesson's Markdown.
 * @param handlers.onDone Called once the lesson is complete.
 * @param handlers.onError Called with the server's message on failure.
 */
export async function streamSynthesisLesson(
  body: SynthesisRequest & { name: string },
  handlers: {
    onToken: (text: string) => void
    onDone: () => void
    onError: (message: string) => void
  },
): Promise<void> {
  const res = await fetch('/api/knowledge/synthesis/lesson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await readSSE(res, (event, data) => {
    if (event === 'token') handlers.onToken((data as { text: string }).text)
    else if (event === 'done') handlers.onDone()
    else if (event === 'error') handlers.onError((data as { message: string }).message)
  })
}

/**
 * Rewrite only a lesson's closing "How it fits in" section (v8.23.0), for
 * the items that need its subject now.
 *
 * @param body The subject, its lesson without that section, the items that
 *             need it, and the course's paper (it keys the server's cache).
 * @param body.item The lesson's subject.
 * @param body.lesson The lesson before its closing section.
 * @param body.needed_by The items that need the subject now, with why.
 * @param body.paper_id The course's paper.
 * @returns The section's body, without its heading.
 * @throws With the server's message when the tutor fails.
 */
export async function fitLesson(body: {
  item: KnowledgeStep
  lesson: string
  needed_by: KnowledgeNeed[]
  paper_id?: string
}): Promise<string> {
  const res = await fetch('/api/knowledge/fit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not update how this fits in (${res.status})`)
  return (data as { text: string }).text
}
