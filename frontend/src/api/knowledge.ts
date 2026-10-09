/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge network's two calls (Phase 5b): expand one course item into
 * its prerequisites, and stream one item's lesson. Both are cached
 * server-side for good, so re-opening a course costs nothing.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { PaperRef } from './agents'
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
 * Stream one course item's lesson.
 *
 * @param body The lesson's subject, why the course needs it, the path above
 *             it, the paper's abstract (for the paper's own lesson), and the
 *             paper whose reference list the lesson may cite.
 * @param body.item The subject.
 * @param body.why What the item above it needs it for.
 * @param body.path The course path above it, root first.
 * @param body.abstract The paper's abstract, when the item is the paper.
 * @param body.paper_id The course's paper, whose references may be cited.
 * @param body.provider The backend that paper's id belongs to.
 * @param handlers Token, citation, done and error callbacks, plus an abort signal.
 * @param handlers.onToken Called with each chunk of the lesson's Markdown.
 * @param handlers.onRefs Called with the papers its `[n]` markers cite.
 * @param handlers.onDone Called once the lesson is complete.
 * @param handlers.onError Called with the server's message on failure.
 * @param handlers.signal Abort the stream.
 */
export async function streamLesson(
  body: {
    item: KnowledgeStep
    why: string
    path: KnowledgeStep[]
    abstract: string
    paper_id?: string
    provider: Provider
  },
  handlers: {
    onToken: (text: string) => void
    onRefs?: (refs: Record<string, PaperRef>) => void
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
    else if (event === 'paper_refs')
      handlers.onRefs?.((data as { refs: Record<string, PaperRef> }).refs)
    else if (event === 'done') handlers.onDone()
    else if (event === 'error') handlers.onError((data as { message: string }).message)
  })
}
