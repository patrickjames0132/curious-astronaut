/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Knowledge Graph's assistant (v8.25.0): a docked chat beside a thread's
 * course. It answers from the course (its concepts, what each needs, the
 * reader's check-offs and every lesson written, the open one whole) through
 * the researcher, which reaches the library and the web — not the literature
 * since v8.28.0, finding papers being the General chat's job.
 *
 * Since v8.38.0 the panel is the shared `assistant/DockedAssistant`, which the
 * Reader's uses too; this file gives it the course's words and `askCourse`,
 * and turns a lesson's quote into the shared shape. Since v9.0.0 it talks in
 * the dock's chat (`store/chats`), each question tagged with the paper and
 * its course.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useMemo } from 'react'
import DockedAssistant from '../../assistant/DockedAssistant'
import type { ThreadRecord } from '../../store/explorations'
import { askCourse, lessonSource, type LessonQuote } from './askCourse'

/**
 * Render the Knowledge Graph's assistant.
 *
 * @param props Component props.
 * @param props.thread The paper thread whose course it answers over.
 * @param props.collapsed Hidden, but kept mounted.
 * @param props.onClose Collapse the panel (its ✕).
 * @param props.quote A passage a lesson's Chat attached to the bar, with a
 *   `seq` that changes each time one is attached.
 * @param props.onQuoteClear Let go of the attached passage (its ✕, or sent).
 * @returns The docked panel.
 */
export default function CourseAssistant({
  thread,
  collapsed,
  onClose,
  quote = null,
  onQuoteClear,
}: {
  thread: ThreadRecord
  collapsed: boolean
  onClose: () => void
  quote?: (LessonQuote & { seq: number }) | null
  onQuoteClear?: () => void
}) {
  const passage = useMemo(
    () => (quote ? { text: quote.text, from: lessonSource(quote.lesson), seq: quote.seq } : null),
    [quote],
  )
  return (
    <DockedAssistant
      thread={thread}
      available={!!thread.knowledge}
      ask={askCourse}
      collapsed={collapsed}
      onClose={onClose}
      quote={passage}
      onQuoteClear={onQuoteClear}
      copy={{
        title: 'Knowledge Graph Assistant',
        hint:
          'Ask about the course: what a concept means, how two of them connect, or what to ' +
          'study next. Highlight a passage in a lesson and choose Explain to ask about it ' +
          'here, or Chat to attach it and ask anything.',
        context: `Asking about the course on ${thread.title}`,
        tip:
          'It talks in the chat you were last in (switch it under the title); type @ to bring in ' +
          'another chat from this exploration. Highlight a passage in a lesson and choose ' +
          'Explain to ask about it here, or Chat to attach it and ask anything.',
        placeholder: 'Ask about this course, or @ another chat…',
        className: 'course-assistant',
        widthKey: 'ca.courseAssistantWidth',
      }}
    />
  )
}
