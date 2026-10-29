/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Knowledge Graph assistant's stream engine (v8.25.0): one question to
 * the researcher over a thread's course, its events dispatched into the
 * dock's chat (`store/chats`; until v9.0.0, the thread's own Knowledge Graph
 * chat), tagged with the paper and its course. Since v8.38.0 a thin layer
 * over the docked assistants' shared engine (`assistant/askAssistant`), which
 * the Reader's uses too: this file says what the course sends, and words a
 * lesson's passages.
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

import { streamAskCourse } from '../../api'
import {
  askAssistant,
  passageMessage,
  quotedMessage as quotedPassage,
  type AssistantQuestion,
} from '../../assistant/askAssistant'
import { isCurrentMap } from '../model'
import { courseContext } from './context'

/** What one question to the course's assistant needs. */
export type CourseQuestion = AssistantQuestion

/**
 * Ask the course's assistant, streaming the answer into the dock's chat.
 * Does nothing when the thread has no course.
 *
 * @param request The question and the thread it is about.
 * @returns The thunk; it settles when the answer has ended, however it ended.
 */
export function askCourse(request: CourseQuestion) {
  return askAssistant('knowledge', request, (thread) => {
    const map = thread.knowledge
    if (!isCurrentMap(map)) return null
    return (body, handlers) => streamAskCourse({ ...body, course: courseContext(map) }, handlers)
  })
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
 * Where a lesson's passage is from, as the messages and the quote card say it.
 *
 * @param lesson The lesson's title.
 * @returns The phrase.
 */
export function lessonSource(lesson: string): string {
  return `the lesson on ${lesson}`
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
  return quotedPassage(question, { text: quote.text, from: lessonSource(quote.lesson) })
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
  return passageMessage('Explain', passage, lessonSource(lesson))
}
