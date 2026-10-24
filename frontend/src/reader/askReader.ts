/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader assistant's asking (v8.38.0): what it sends on top of the docked
 * assistants' shared engine (`assistant/askAssistant`), and how the Reader's
 * highlight menu words a passage.
 *
 * It sends only the paper's arXiv id and the section in view; the server lays
 * the paper out from the document it already cached for the Reader
 * (`routes/agents.py`, `_reading_context`). The section in view is the
 * Reader's to know, and changes on every scroll, so the Reader writes it here
 * (`setReadingSection`) rather than into the store, where each scroll would
 * re-render whatever reads it; it's only needed at the moment of asking.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { streamAskReader } from '../api'
import {
  askAssistant,
  clearAssistantChat,
  passageMessage,
  stopAssistant,
  type AssistantQuestion,
} from '../assistant/askAssistant'
import type { ThreadRecord } from '../store/explorations'

/** The section in view in each thread's Reader, by thread id. */
const readingSections = new Map<string, string>()

/**
 * Note the section in view, for the next question.
 *
 * @param threadId The thread.
 * @param sectionId The section's id, or null to forget it.
 */
export function setReadingSection(threadId: string, sectionId: string | null): void {
  if (sectionId) readingSections.set(threadId, sectionId)
  else readingSections.delete(threadId)
}

/**
 * The ref the Reader asks for a paper's document by: its arXiv id when
 * known. Shared with the route the assistant asks, so both read one paper.
 *
 * @param thread The paper thread.
 * @returns Its arXiv id, else its seed ref, else null.
 */
export function documentRef(thread: ThreadRecord): string | null {
  return (
    thread.paper?.arxiv_id ??
    thread.data.graph_ref?.seed.arxiv_id ??
    thread.data.graph_ref?.seed_ref ??
    null
  )
}

/**
 * Ask the Reader's assistant, streaming the answer into the thread's Reader
 * chat. Does nothing for a thread with no paper to read.
 *
 * @param request The question and the thread it is about.
 * @returns The thunk; it settles when the answer has ended, however it ended.
 */
export function askReader(request: AssistantQuestion) {
  return askAssistant('reader', request, (thread) => {
    const paper = documentRef(thread)
    if (!paper) return null
    const section = readingSections.get(thread.id) ?? null
    return (body, handlers) => streamAskReader({ ...body, paper, section }, handlers)
  })
}

/**
 * Stop the answer streaming in a thread's Reader chat, keeping what it has
 * written.
 *
 * @param threadId The thread.
 */
export function stopReaderAsk(threadId: string): void {
  stopAssistant(threadId, 'reader')
}

/**
 * Stop any answer and clear a thread's Reader chat.
 *
 * @param threadId The thread.
 * @returns The thunk.
 */
export function clearReaderChat(threadId: string) {
  return clearAssistantChat(threadId, 'reader')
}

/** What each of the Reader's highlight-menu actions asks for. */
const VERBS = {
  explain: 'Explain',
  simplify: 'Simplify, in plain words,',
} as const

/**
 * The message a Reader highlight's **Explain** or **Simplify** sends: the
 * request, the passage, and the section it is from, so the transcript reads
 * on its own later.
 *
 * @param action Which action.
 * @param passage The highlighted text (math as `$…$`).
 * @param from Where it is from, as a phrase ("section 3.2, Attention").
 * @returns The message (plain text: a user turn renders no Markdown).
 */
export function readerMessage(action: keyof typeof VERBS, passage: string, from: string): string {
  return passageMessage(VERBS[action], passage, from)
}
