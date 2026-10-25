/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The docked assistants' stream engine: one question to the researcher,
 * graph-free, over what a tool shows (the Knowledge Graph's course, v8.25.0;
 * the paper open in the Reader, v8.38.0), its events dispatched into that
 * thread's side chat for the tool (`store/chats`).
 *
 * Generalized from the Knowledge Graph's `askCourse` when the Reader got an
 * assistant of its own (v8.38.0): the two differ only in what they send and
 * where, so each tool supplies a `prepare` and everything else is here.
 *
 * A thunk rather than a hook, because two places ask: the panel's composer,
 * and a highlighted passage's **Explain** (or the Reader's **Simplify**) in
 * the tool, which may fire while the assistant is still closed. Both see the
 * answer in the same chat.
 *
 * As in `teacher/useConversation`, the chat a stream writes to is fixed when
 * it starts, so the reader can leave the tool, or the thread, while an answer
 * finishes; nothing is aborted by moving on. Asking again in the same chat
 * supersedes the last question, and Stop or Clear ends it.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { nanoid } from '@reduxjs/toolkit'
import type { AskSourcesHandlers, HistoryTurn, PdfPlace, Provider, ThreadContext } from '../api'
import type { AppDispatch, RootState } from '../store'
import { chatKey, type SIDE_CHAT_FIELDS } from '../store/chats'
import type { ThreadRecord } from '../store/explorations'
import {
  answerFailed,
  chatCleared,
  conversationEnsured,
  figureAdded,
  paperRefsSet,
  provenanceSet,
  sourceRefsSet,
  streamEnded,
  streamStarted,
  tokenAppended,
  traceAdded,
  tracesSettled,
  turnCompleted,
  turnContextSet,
  turnStarted,
} from '../store/transcript'
import { borrowedChats, conversationHistory, siblingContext } from '../teacher/history'

/** A tool with a docked assistant of its own. */
export type AssistantTool = keyof typeof SIDE_CHAT_FIELDS

/** What every docked assistant sends, whatever its tool adds. */
export interface AssistantBody {
  question: string
  provider: Provider
  source_ids?: string[]
  history: HistoryTurn[]
  thread_context: ThreadContext[]
  quick?: boolean
  model?: string
  /** Where a highlighted passage is in the paper's PDF (the Reader's, v8.45.0). */
  places?: PdfPlace[]
}

/**
 * How a tool asks: given the thread, the call that streams one answer, or
 * null when the tool has nothing to ask over yet (no course; no readable
 * paper), in which case nothing is asked.
 */
export type PrepareAsk = (
  thread: ThreadRecord,
) => ((body: AssistantBody, handlers: AskSourcesHandlers) => Promise<void>) | null

/** What one question to a docked assistant needs. */
export interface AssistantQuestion {
  threadId: string
  /** The message, as the user turn shows it. */
  question: string
  /** The thread's provider, for the papers its searches find. */
  provider: Provider
  /** Library scope; the whole library when undefined. */
  sourceIds?: string[]
  /** History to send, for a retry; the chat's own completed turns by default. */
  history?: HistoryTurn[]
  /** A quick response (v8.30.0): answer with no tools, now. */
  quick?: boolean
  /** Original start time when Quick response continues the same wait. */
  startedAt?: number
  /** Where the passage it asks about is in the paper's PDF (v8.45.0): kept
   *  on the user turn and sent along. */
  places?: PdfPlace[]
}

/** The question in flight in each side chat, by its key. */
const controllers = new Map<string, AbortController>()

/**
 * Stop the answer streaming in a thread's side chat, keeping what it has
 * written.
 *
 * @param threadId The thread.
 * @param tool The tool whose chat it is.
 */
export function stopAssistant(threadId: string, tool: AssistantTool): void {
  const key = chatKey(threadId, tool)
  controllers.get(key)?.abort()
  controllers.delete(key)
}

/**
 * Stop any answer and clear a thread's side chat.
 *
 * @param threadId The thread.
 * @param tool The tool whose chat it is.
 * @returns The thunk.
 */
export function clearAssistantChat(threadId: string, tool: AssistantTool) {
  return (dispatch: AppDispatch): void => {
    stopAssistant(threadId, tool)
    dispatch(chatCleared(chatKey(threadId, tool)))
  }
}

/**
 * Ask a tool's docked assistant, streaming the answer into the thread's side
 * chat for that tool. Does nothing when `prepare` has nothing to ask over.
 *
 * @param tool The tool whose assistant it is.
 * @param request The question and the thread it is about.
 * @param prepare How the tool asks (see {@link PrepareAsk}).
 * @returns The thunk; it settles when the answer has ended, however it ended.
 */
export function askAssistant(tool: AssistantTool, request: AssistantQuestion, prepare: PrepareAsk) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    const { threadId, question, provider, sourceIds } = request
    const thread = Object.values(getState().explorations.byId)
      .flatMap((record) => record.threads)
      .find((item) => item.id === threadId)
    const send = thread ? prepare(thread) : null
    if (!send) return
    const key = chatKey(threadId, tool)
    // Supersede whatever this chat was answering: a new message means the
    // reader has moved on from the last one.
    controllers.get(key)?.abort()
    const ctrl = new AbortController()
    controllers.set(key, ctrl)
    dispatch(conversationEnsured(key))
    const streamId = `${tool}:${nanoid()}`
    dispatch(streamStarted(streamId, key))
    const history =
      request.history ?? conversationHistory(getState().transcript.byKey[key]?.chat ?? [])
    dispatch(
      turnStarted(
        question,
        key,
        request.quick ? request.startedAt : undefined,
        request.quick,
        request.places,
      ),
    )
    dispatch(turnContextSet(borrowedChats(getState(), question, key), key))
    let failed = false
    let failure = 'This answer stopped before it finished.'
    let produced = false
    try {
      await send(
        {
          question,
          provider,
          source_ids: sourceIds,
          history,
          thread_context: siblingContext(getState(), question, key),
          ...(request.quick && { quick: true }),
          ...(request.places?.length && { places: request.places }),
          model: getState().transcript.byKey[key]?.model,
        },
        {
          signal: ctrl.signal,
          onToken: (token) => {
            produced = true
            dispatch(tokenAppended(token, key))
          },
          onTrace: (trace) => dispatch(traceAdded(trace, key)),
          onFigure: (figure) => dispatch(figureAdded(figure, key)),
          onSourceRefs: (refs) => dispatch(sourceRefsSet(refs, key)),
          onProvenance: (provenance) => dispatch(provenanceSet(provenance, key)),
          onPaperRefs: (refs) => dispatch(paperRefsSet(refs, key)),
          onError: (message) => {
            failed = true
            failure = message
          },
        },
      )
      if (!failed && !ctrl.signal.aborted) dispatch(turnCompleted(key))
    } catch (error) {
      if (!ctrl.signal.aborted) failure = error instanceof Error ? error.message : String(error)
    } finally {
      const superseded = controllers.get(key) !== ctrl
      if (!superseded) controllers.delete(key)
      dispatch(streamEnded(streamId, key))
      if (!superseded) dispatch(tracesSettled(key))
      // A turn that produced nothing says so itself, so the note survives a
      // reload; a superseded one was replaced on purpose.
      if (!produced && !superseded) dispatch(answerFailed(failure, key))
    }
  }
}

/**
 * A highlighted passage attached to an assistant's bar by **Chat**
 * (v8.26.0), waiting there for the reader's own question.
 */
export interface PassageQuote {
  /** The highlighted text. */
  text: string
  /** Where it is from, as a phrase: "the lesson on Q-learning", "section 3.2,
   *  Attention". */
  from: string
  /** Where it sits in the paper's PDF, when highlighted in the Reader's PDF
   *  view (v8.45.0). */
  places?: PdfPlace[]
}

/**
 * The message a question sends with a passage attached: the passage and
 * where it's from first, then the reader's question, so the transcript reads
 * on its own later.
 *
 * @param question What the reader typed.
 * @param quote The attached passage.
 * @returns The message (plain text: a user turn renders no Markdown).
 */
export function quotedMessage(question: string, quote: PassageQuote): string {
  return `About this passage from ${quote.from}:\n\n“${quote.text.trim()}”\n\n${question.trim()}`
}

/**
 * The message a highlight-menu action sends (Explain, Simplify): the verb,
 * then the passage and where it's from, so the transcript reads on its own.
 *
 * @param verb What to do with it, as the message opens ("Explain").
 * @param passage The highlighted text.
 * @param from Where it is from, as a phrase (see {@link PassageQuote}).
 * @returns The message (plain text: a user turn renders no Markdown).
 */
export function passageMessage(verb: string, passage: string, from: string): string {
  return `${verb} this passage from ${from}:\n\n“${passage.trim()}”`
}
