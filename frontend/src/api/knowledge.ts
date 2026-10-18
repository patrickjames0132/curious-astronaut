/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge network's calls (Phase 5b): expand one course item into
 * its prerequisites, and stream one item's lesson, since v8.24.0 written with
 * inline images unless a quick response is asked for. Both are cached
 * server-side for good, so re-opening a course costs nothing. Since v8.25.0,
 * also name the concept behind a passage highlighted in a lesson
 * (`expandPhrase`); the course's assistant streams through `agents`.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { AnswerFigure } from './agents'
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

/**
 * Name the concept behind a passage highlighted in a lesson (v8.25.0, the
 * lesson's "Expand"), to hang under the lesson's item.
 *
 * @param body The passage, the lesson's item, the path above it, the names
 *             already in the course, and the course's paper (for the cache).
 * @param body.phrase The highlighted text.
 * @param body.item The lesson's item, which will need the concept.
 * @param body.path The course path above the item, root first.
 * @param body.existing Names already in the course, so the tutor reuses them.
 * @param body.paper_id The course's paper.
 * @returns The concept and why the item needs it, or null when the passage
 *          names the item itself or something above it.
 * @throws With the server's message when the tutor fails.
 */
export async function expandPhrase(body: {
  phrase: string
  item: KnowledgeStep
  path: KnowledgeStep[]
  existing: string[]
  paper_id?: string
}): Promise<KnowledgeChild | null> {
  const res = await fetch('/api/knowledge/phrase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not expand this (${res.status})`)
  return (data as { child: KnowledgeChild | null }).child
}

/** An item that needs a lesson's subject, and why (v8.23.0). */
export interface KnowledgeNeed extends KnowledgeStep {
  why: string
}

/** Where a lesson written with images finds the course paper's figures (v8.24.0). */
export interface LessonPictures {
  /** True for a quick response: the lesson alone, no image search. */
  quick?: boolean
  paper?: { id: string; arxiv_id?: string | null; title: string }
  provider?: Provider
}

/** A lesson stream's callbacks. */
export interface LessonHandlers {
  onToken: (text: string) => void
  /** What the tutor is doing now, one status line (v8.24.0, with images). */
  onStep?: (text: string) => void
  /** An image the tutor placed, paired with its `<<FIG n>>` marker by slot (v8.24.0). */
  onImage?: (image: AnswerFigure) => void
  onDone: () => void
  onError: (message: string) => void
  signal?: AbortSignal
}

/**
 * Read a lesson's SSE frames into its handlers.
 *
 * @param res The streaming response.
 * @param handlers The callbacks.
 */
async function readLesson(res: Response, handlers: LessonHandlers): Promise<void> {
  await readSSE(res, (event, data) => {
    if (event === 'token') handlers.onToken((data as { text: string }).text)
    else if (event === 'step') handlers.onStep?.((data as { text: string }).text)
    else if (event === 'image') handlers.onImage?.(data as AnswerFigure)
    else if (event === 'done') handlers.onDone()
    else if (event === 'error') handlers.onError((data as { message: string }).message)
  })
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
 * @param body.quick A quick response: no image search (v8.24.0).
 * @param body.paper The course paper, whose figures are image candidates.
 * @param body.provider Who resolves the paper's PDF.
 * @param handlers Token, step, image, done and error callbacks, plus an abort signal.
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
  } & LessonPictures,
  handlers: LessonHandlers,
): Promise<void> {
  const res = await fetch('/api/knowledge/lesson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })
  await readLesson(res, handlers)
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
 * @param body Its name, concepts, target and path, and as for a lesson
 *             whether it is quick, where the paper's figures are, and
 *             `fresh` to skip and replace the cached copy (v8.24.0).
 * @param handlers Token, step, image, done and error callbacks, plus an abort signal.
 */
export async function streamSynthesisLesson(
  body: SynthesisRequest & { name: string; fresh?: boolean } & LessonPictures,
  handlers: LessonHandlers,
): Promise<void> {
  const res = await fetch('/api/knowledge/synthesis/lesson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: handlers.signal,
  })
  await readLesson(res, handlers)
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
