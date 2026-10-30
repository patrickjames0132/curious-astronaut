/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The docked assistants' stream engine: one question to the researcher,
 * graph-free, over what a tool shows (the Knowledge Graph's course, v8.25.0;
 * the paper open in the Reader, v8.38.0), its events dispatched into the
 * dock's chat (v9.0.0, `store/chats`), the question tagged with the paper
 * and the tool it was asked beside.
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
 * supersedes the last question, and Stop or Clear ends it. The chat is the
 * dock's, shared by every view, so an answer started beside the Reader is
 * stopped by a question asked beside the course in the same chat.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { nanoid } from '@reduxjs/toolkit'
import type {
  AskHandlers,
  Beat,
  Discovery,
  HistoryTurn,
  LectureHandlers,
  PdfPlace,
  Provider,
  ThreadContext,
  TurnTag,
} from '../api'
import type { AppDispatch, RootState } from '../store'
import { paperTag } from '../store/chats'
import type { ThreadRecord } from '../store/explorations'
import {
  answerFailed,
  chatBeatAdded,
  chatCleared,
  citedSet,
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
  turnRouted,
  turnStarted,
  selectChatKey,
} from '../store/transcript'
import { borrowedChats, conversationHistory, siblingContext } from '../teacher/history'
import { release, stopChat, supersede } from './inFlight'

/** A tool whose docked assistant runs on this engine. */
export type AssistantTool = 'knowledge' | 'reader'

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
  /** Figures boxed in the Reader's text, by their images' sources (v8.48.0). */
  figures?: string[]
}

/**
 * How a tool asks: given the thread, the call that streams one answer, or
 * null when the tool has nothing to ask over yet (no course; no readable
 * paper), in which case nothing is asked.
 */
export type PrepareAsk = (thread: ThreadRecord) => SendAnswer | null

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
  /** Figures boxed in the Reader's text (v8.48.0), by their images'
   *  sources: kept on the user turn and sent along, for the model to see. */
  figures?: string[]
  /** The labels the passage covers (v8.48.0), kept on the user turn so
   *  either of the Reader's views can light it. Not sent. */
  labels?: string[]
  /** Where it was typed, when the router placed it elsewhere (v9.0.0,
   *  stage 4b): kept on the user turn, for its correction. */
  placedFrom?: TurnTag | 'general'
  /** Typed in the bar, with no passage attached: kept on the user turn,
   *  which makes it editable (`ChatMsg.typed`). */
  typed?: boolean
}

/** One answer's stream call, given the request's body and its handlers. */
export type SendAnswer = (body: AssistantBody, handlers: AskHandlers) => Promise<void>

/** What an answer over a graph adds to the bookkeeping (v9.0.0, stage 4b:
 *  the Citation Graph asked from another view). */
export interface GraphAnswer {
  /** Papers found mid-answer, for the graph they belong to. */
  onDiscovery?: (discovery: Discovery) => void
  /** The finished answer's prose, to resolve its `[n]` markers. */
  onAnswered?: (text: string) => void
}

/**
 * Stop the answer streaming in a chat, keeping what it has written.
 *
 * @param key The chat's key.
 */
export function stopAssistant(key: string): void {
  stopChat(key)
}

/**
 * Stop any answer and clear a chat.
 *
 * @param key The chat's key.
 * @returns The thunk.
 */
export function clearAssistantChat(key: string) {
  return (dispatch: AppDispatch): void => {
    stopAssistant(key)
    dispatch(chatCleared(key))
  }
}

/**
 * Ask a tool's docked assistant, streaming the answer into the dock's chat.
 * Does nothing when `prepare` has nothing to ask over.
 *
 * @param tool The tool whose assistant it is.
 * @param request The question and the thread it is about.
 * @param prepare How the tool asks (see {@link PrepareAsk}).
 * @returns The thunk; it settles when the answer has ended, however it ended.
 */
export function askAssistant(tool: AssistantTool, request: AssistantQuestion, prepare: PrepareAsk) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    const thread = Object.values(getState().explorations.byId)
      .flatMap((record) => record.threads)
      .find((item) => item.id === request.threadId)
    const send = thread ? prepare(thread) : null
    if (!thread || !send) return
    await dispatch(streamAnswer(paperTag(thread, tool), request, send))
  }
}

/**
 * Stream one answer into the dock's chat, its question tagged with where it
 * was asked: the docked tools' asking (`askAssistant`), and since v9.0.0
 * (stage 4b) a question the router placed in a view that isn't on screen,
 * or in General (`assistant/askAt`).
 *
 * @param tag Where it was asked; undefined for General.
 * @param request The question.
 * @param send Its stream call.
 * @param graph What an answer over a graph adds, when it is one.
 * @returns The thunk; it settles when the answer has ended, however it ended.
 */
export function streamAnswer(
  tag: TurnTag | undefined,
  request: AssistantQuestion,
  send: SendAnswer,
  graph: GraphAnswer = {},
) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    const { question, provider, sourceIds } = request
    const tool = tag?.tool ?? 'general'
    const key = selectChatKey(getState())
    // Supersede whatever this chat was answering, from whichever view: a new
    // message means the reader has moved on from the last one.
    const ctrl = supersede(key)
    dispatch(conversationEnsured(key))
    const streamId = `${tool}:${nanoid()}`
    dispatch(streamStarted(streamId, key))
    const history =
      request.history ?? conversationHistory(getState().transcript.byKey[key]?.chat ?? [])
    dispatch(
      turnStarted(question, key, request.quick ? request.startedAt : undefined, request.quick, {
        places: request.places,
        figures: request.figures,
        labels: request.labels,
        tag,
        placedFrom: request.placedFrom,
        typed: request.typed,
      }),
    )
    dispatch(turnContextSet(borrowedChats(getState(), question, key), key))
    let failed = false
    let failure = 'This answer stopped before it finished.'
    let produced = false
    let prose = ''
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
          ...(request.figures?.length && { figures: request.figures }),
          model: getState().transcript.byKey[key]?.model,
        },
        {
          signal: ctrl.signal,
          onToken: (token) => {
            produced = true
            prose += token
            dispatch(tokenAppended(token, key))
          },
          onTrace: (trace) => dispatch(traceAdded(trace, key)),
          onDiscovery: graph.onDiscovery,
          onCited: (ids) => dispatch(citedSet(ids, key)),
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
      graph.onAnswered?.(prose)
      if (!failed && !ctrl.signal.aborted) dispatch(turnCompleted(key))
    } catch (error) {
      if (!ctrl.signal.aborted) failure = error instanceof Error ? error.message : String(error)
    } finally {
      const superseded = release(key, ctrl)
      dispatch(streamEnded(streamId, key))
      if (!superseded) dispatch(tracesSettled(key))
      // A turn that produced nothing says so itself, so the note survives a
      // reload; a superseded one was replaced on purpose.
      if (!produced && !superseded) dispatch(answerFailed(failure, key))
    }
  }
}

/**
 * How a tool streams a lecture into its chat (v8.50.0, the Reader's guided
 * read): given the thread, the call that streams the beats, or null when
 * there is nothing to lecture on.
 */
export type PrepareLecture = (
  thread: ThreadRecord,
) => ((handlers: LectureHandlers) => Promise<void>) | null

/**
 * Stream a lecture into the dock's chat as one answer turn of beats, as the
 * Citation Graph's lecture is a turn of its chat (v8.50.0). The same
 * bookkeeping as {@link askAssistant}: a new message supersedes it, Stop and
 * Clear end it, and a lecture that produced nothing says so on its turn.
 *
 * @param tool The tool whose assistant it is.
 * @param request The thread, and the user turn's words ("Guide me through…").
 * @param request.threadId The thread.
 * @param request.question What the user turn shows.
 * @param prepare How the tool streams it.
 * @param onBeat Told each beat as it lands, its index, and the answer's index
 *        in the chat (the Reader lights the first).
 * @returns The thunk; it settles when the lecture has ended.
 */
export function lectureAssistant(
  tool: AssistantTool,
  request: { threadId: string; question: string },
  prepare: PrepareLecture,
  onBeat?: (beat: Beat, index: number, answer: number) => void,
) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    const { threadId, question } = request
    const thread = Object.values(getState().explorations.byId)
      .flatMap((record) => record.threads)
      .find((item) => item.id === threadId)
    const stream = thread ? prepare(thread) : null
    if (!thread || !stream) return
    const key = selectChatKey(getState())
    const ctrl = supersede(key)
    dispatch(conversationEnsured(key))
    const streamId = `${tool}:${nanoid()}`
    dispatch(streamStarted(streamId, key))
    dispatch(turnStarted(question, key, undefined, false, { tag: paperTag(thread, tool) }))
    // Said at the top of its bubble, by the timer, as the Citation Graph's
    // chat says it (Patrick): "Answered as a lecture".
    dispatch(turnRouted('lecture', key))
    const answer = (getState().transcript.byKey[key]?.chat.length ?? 1) - 1
    let failed = false
    let failure = 'This lecture stopped before it finished.'
    let beats = 0
    try {
      await stream({
        signal: ctrl.signal,
        onBeat: (beat) => {
          dispatch(chatBeatAdded(beat, key))
          onBeat?.(beat, beats, answer)
          beats += 1
        },
        onError: (message) => {
          failed = true
          failure = message
        },
      })
      if (!failed && !ctrl.signal.aborted) dispatch(turnCompleted(key))
    } catch (error) {
      if (!ctrl.signal.aborted) failure = error instanceof Error ? error.message : String(error)
    } finally {
      const superseded = release(key, ctrl)
      dispatch(streamEnded(streamId, key))
      if (!superseded) dispatch(tracesSettled(key))
      if (!beats && !superseded) dispatch(answerFailed(failure, key))
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
  /** Figures boxed in the Reader's text (v8.48.0), by their images' sources. */
  figures?: string[]
  /** The labels it covers (v8.48.0): "Figure 1", "(6)". */
  labels?: string[]
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
