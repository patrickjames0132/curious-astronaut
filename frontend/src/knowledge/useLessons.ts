/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Lesson streaming for the knowledge network. A lesson is written the first
 * time its item is opened, streamed onto the page, and kept on the thread
 * once finished. A stream is **never aborted** by moving on: the reader can
 * open the next lesson while this one finishes, and it lands on its own
 * thread's course (by id) even if they have left the tool — a paid-for
 * lesson is not thrown away.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useState } from 'react'
import { streamLesson } from '../api'
import { useAppDispatch } from '../store'
import { knowledgeLessonWritten } from '../store/explorations'
import { routeWhy, tutorPath, type KnowledgeMap } from './model'

/** A lesson being written: the text so far, or why it failed. */
export interface LessonDraft {
  text: string
  error?: string
}

/**
 * Lessons being written, app-wide, as `threadId:nodeId`. Module-level rather
 * than per hook, because the hook unmounts whenever the reader leaves the
 * tool while a stream it started carries on — a remount must not start the
 * same lesson a second time.
 */
const IN_FLIGHT = new Set<string>()

/**
 * Stream lessons for one thread's course.
 *
 * @param threadId The thread the course belongs to.
 * @returns The drafts in flight by node id, `write` to start one, and
 *   `writing` — true for a lesson still streaming from an earlier mount.
 */
export function useLessons(threadId: string) {
  const dispatch = useAppDispatch()
  const [drafts, setDrafts] = useState<Record<string, LessonDraft>>({})

  const write = useCallback(
    (map: KnowledgeMap, nodeId: string) => {
      const node = map.nodes[nodeId]
      const flightKey = `${threadId}:${nodeId}`
      if (!node || node.lesson || IN_FLIGHT.has(flightKey)) return
      IN_FLIGHT.add(flightKey)
      let text = ''
      const update = (draft: LessonDraft | null) =>
        setDrafts((previous) => {
          const next = { ...previous }
          if (draft) next[nodeId] = draft
          else delete next[nodeId]
          return next
        })
      update({ text })
      void streamLesson(
        {
          item: { title: node.title, kind: node.kind },
          why: routeWhy(map, nodeId),
          path: tutorPath(map, nodeId),
          abstract: node.paper?.abstract ?? '',
          paper_id: map.nodes[map.rootId]?.paper?.id,
        },
        {
          onToken: (chunk) => {
            text += chunk
            update({ text })
          },
          onDone: () => {
            IN_FLIGHT.delete(flightKey)
            if (text) dispatch(knowledgeLessonWritten({ threadId, nodeId, text }))
            update(null)
          },
          onError: (message) => {
            IN_FLIGHT.delete(flightKey)
            update({ text, error: message })
          },
        },
      ).catch((error: unknown) => {
        IN_FLIGHT.delete(flightKey)
        update({ text, error: error instanceof Error ? error.message : 'The lesson failed' })
      })
    },
    [dispatch, threadId],
  )

  const writing = useCallback(
    (nodeId: string) => IN_FLIGHT.has(`${threadId}:${nodeId}`),
    [threadId],
  )

  return { drafts, write, writing }
}
