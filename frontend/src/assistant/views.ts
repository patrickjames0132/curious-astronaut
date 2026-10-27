/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What a view lends the one assistant (v9.0.0, the OnePager's "One
 * assistant", stage 3). There is one assistant panel (`teacher/Teacher`),
 * docked beside whatever view is open; the Knowledge Graph and the Reader
 * each give it an `AssistantView` — their words, how they ask, and what
 * their answers can light — through a hook (`knowledge/assistant/
 * useCourseView`, `reader/useReaderView`). The Citation Graph's and the
 * General chat's asking live in the panel itself (`teacher/useConversation`),
 * as they always have. Until stage 3 each of the two had a panel of its own
 * (`DockedAssistant`, v8.25.0 and v8.38.0).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { TurnTool } from '../api'
import type { AppDispatch, RootState } from '../store'
import type { ThreadRecord } from '../store/explorations'
import type { AssistantQuestion } from './askAssistant'

/** What a view's assistant says. */
export interface AssistantCopy {
  /** The panel's title, e.g. "Knowledge Graph Assistant". */
  title: string
  /** Shown in an empty chat: what to ask, and what the highlight menu does. */
  hint: string
  /** The line over the bar saying what is asked about. */
  context: string
  /** The ⓘ tip beside that line. */
  tip: string
  /** The bar's placeholder with nothing attached. */
  placeholder: string
  /** A class for the panel while this view's assistant is docked, which is
   *  also its tour anchor. */
  className: string
}

/**
 * What an answer can light in the view beside it (v8.45.0): the Reader's
 * passages. Only the Reader's view has them; the course's answers stay
 * unclickable.
 */
export interface AnswerPassages {
  /** The answer whose passages are lit, by its index in the chat. */
  active: number | null
  /** Whether an answer is this view's to light: its question was asked
   *  beside this paper's tool (v9.0.0). The others stay unclickable here. */
  owns: (index: number) => boolean
  /** An answer clicked: light what it's about and go there (again: unlight). */
  onActivate: (index: number) => void
  /** One of an answer's quotes clicked: light it and go there. */
  onQuote: (quote: string) => void
  /** The lecture beat lit (v8.50.0, the guided read), by answer and beat. */
  activeBeat?: { answer: number; beat: number } | null
  /** A lecture beat clicked: light its passage and go there (again: unlight). */
  onBeat?: (answer: number, index: number) => void
}

/** What a view lends the assistant. */
export interface AssistantView {
  /** The tool it is, which is the tag its questions wear. */
  tool: Extract<TurnTool, 'knowledge' | 'reader'>
  /** The paper thread it answers over. */
  thread: ThreadRecord
  copy: AssistantCopy
  /** Whether there is anything to ask over yet (a course; a readable paper);
   *  the bar won't send until there is. */
  available: boolean
  /** How it asks (an `askAssistant` with the view's `prepare`). */
  ask: (
    request: AssistantQuestion,
  ) => (dispatch: AppDispatch, getState: () => RootState) => Promise<void>
  /** What its answers light, when they light anything. */
  passages?: AnswerPassages
}
