/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Knowledge Graph assistant's stream engine (v8.25.0): one question to
 * the researcher over a thread's course, its events dispatched into that
 * thread's Knowledge Graph chat (`store/chats`).
 *
 * A thunk rather than a hook, because two places ask: the panel's composer,
 * and a lesson's **Explain** on a highlighted passage, which lives in the
 * course's side panel and may fire while the assistant is still closed. Both
 * go through `askCourse`, and both see the answer in the same chat.
 *
 * As in `teacher/useConversation`, the chat a stream writes to is fixed when
 * it starts, so the reader can leave the course, or the thread, while an
 * answer finishes; nothing is aborted by moving on. Asking again in the same
 * chat supersedes the last question, and Stop or Clear ends it.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { nanoid } from '@reduxjs/toolkit'
import { streamAskCourse, type HistoryTurn, type Provider } from '../../api'
import type { AppDispatch, RootState } from '../../store'
import { chatKey } from '../../store/chats'
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
} from '../../store/transcript'
import { borrowedChats, conversationHistory, siblingContext } from '../../teacher/history'
import { isCurrentMap } from '../model'
import { courseContext } from './context'

/** The question in flight in each Knowledge Graph chat, by its key. */
const controllers = new Map<string, AbortController>()

/**
 * Stop the answer streaming in a thread's Knowledge Graph chat, keeping what
 * it has written.
 *
 * @param threadId The thread.
 */
export function stopCourseAsk(threadId: string): void {
  const key = chatKey(threadId, 'knowledge')
  controllers.get(key)?.abort()
  controllers.delete(key)
}

/**
 * Stop any answer and clear a thread's Knowledge Graph chat.
 *
 * @param threadId The thread.
 * @returns The thunk.
 */
export function clearCourseChat(threadId: string) {
  return (dispatch: AppDispatch): void => {
    stopCourseAsk(threadId)
    dispatch(chatCleared(chatKey(threadId, 'knowledge')))
  }
}

/** What one question to the course's assistant needs. */
export interface CourseQuestion {
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
}

/**
 * Ask the course's assistant, streaming the answer into the thread's
 * Knowledge Graph chat. Does nothing when the thread has no course.
 *
 * @param request The question and the thread it is about.
 * @returns The thunk; it settles when the answer has ended, however it ended.
 */
export function askCourse(request: CourseQuestion) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    const { threadId, question, provider, sourceIds } = request
    const thread = Object.values(getState().explorations.byId)
      .flatMap((record) => record.threads)
      .find((item) => item.id === threadId)
    const map = thread?.knowledge
    if (!isCurrentMap(map)) return
    const key = chatKey(threadId, 'knowledge')
    // Supersede whatever this chat was answering: a new message means the
    // reader has moved on from the last one.
    controllers.get(key)?.abort()
    const ctrl = new AbortController()
    controllers.set(key, ctrl)
    dispatch(conversationEnsured(key))
    const streamId = `course:${nanoid()}`
    dispatch(streamStarted(streamId, key))
    const history =
      request.history ?? conversationHistory(getState().transcript.byKey[key]?.chat ?? [])
    dispatch(turnStarted(question, key, request.quick ? request.startedAt : undefined))
    dispatch(turnContextSet(borrowedChats(getState(), question, key), key))
    let failed = false
    let failure = 'This answer stopped before it finished.'
    let produced = false
    try {
      await streamAskCourse(
        {
          question,
          course: courseContext(map),
          provider,
          source_ids: sourceIds,
          history,
          thread_context: siblingContext(getState(), question, key),
          ...(request.quick && { quick: true }),
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
 * A passage a lesson's **Chat** attaches to the assistant's bar (v8.26.0),
 * waiting there for the reader's own question.
 */
export interface LessonQuote {
  /** The highlighted text. */
  text: string
  /** The title of the lesson it is in. */
  lesson: string
}

/**
 * The message a question sends with a passage attached (v8.26.0): the
 * passage and its lesson first, as Explain's message has them, then the
 * reader's question, so the transcript reads on its own later.
 *
 * @param question What the reader typed.
 * @param quote The attached passage.
 * @returns The message (plain text: a user turn renders no Markdown).
 */
export function quotedMessage(question: string, quote: LessonQuote): string {
  return `About this passage from the lesson on ${quote.lesson}:\n\n“${quote.text.trim()}”\n\n${question.trim()}`
}

/**
 * The message a lesson's **Explain** sends: the passage, and the lesson it
 * is from, so the transcript reads on its own later.
 *
 * @param passage The highlighted text.
 * @param lesson The title of the lesson it is in.
 * @returns The message (plain text: a user turn renders no Markdown).
 */
export function explainMessage(passage: string, lesson: string): string {
  return `Explain this passage from the lesson on ${lesson}:\n\n“${passage.trim()}”`
}
