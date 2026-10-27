/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What the Knowledge Graph lends the one assistant (v8.25.0 as a panel of
 * its own; since v9.0.0, stage 3, a view of the one panel, `teacher/Teacher`,
 * through `assistant/views`). It answers from the course (its concepts, what
 * each needs, the reader's check-offs and every lesson written, the open one
 * whole) through the researcher, which reaches the library and the web — not
 * the literature since v8.28.0, finding papers being the General chat's job.
 * Its questions are tagged with the paper and its course, in the dock's chat.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useMemo } from 'react'
import type { AssistantView } from '../../assistant/views'
import type { ThreadRecord } from '../../store/explorations'
import { askCourse } from './askCourse'

/**
 * The course's view, while the Knowledge Graph is the view on screen.
 *
 * @param thread The paper thread whose course is open, or undefined when the
 *   Knowledge Graph isn't on screen.
 * @returns The view, or null.
 */
export function useCourseView(thread: ThreadRecord | undefined): AssistantView | null {
  return useMemo<AssistantView | null>(
    () =>
      thread
        ? {
            tool: 'knowledge',
            thread,
            available: !!thread.knowledge,
            ask: askCourse,
            copy: {
              title: 'Knowledge Graph Assistant',
              hint:
                'Ask about the course: what a concept means, how two of them connect, or what to ' +
                'study next. Highlight a passage in a lesson and choose Explain to ask about it ' +
                'here, or Chat to attach it and ask anything.',
              context: `Asking about the course on ${thread.title}`,
              tip:
                'It talks in the chat you were last in (switch it under the title); type @ to ' +
                'bring in another chat from this exploration. Highlight a passage in a lesson and ' +
                'choose Explain to ask about it here, or Chat to attach it and ask anything.',
              placeholder: 'Ask about this course, or @ another chat…',
              className: 'course-assistant',
            },
          }
        : null,
    [thread],
  )
}
