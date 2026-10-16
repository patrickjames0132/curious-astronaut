/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Lesson streaming for the knowledge network. A lesson is written the first
 * time its item is opened, streamed onto the page, and kept on the thread
 * once finished. A stream is **never aborted** by moving on: the reader can
 * open the next lesson while this one finishes, and it lands on its own
 * thread's course (by id) even if they have left the tool — a paid-for
 * lesson is not thrown away. A synthesis's lesson (v8.23.0) streams from its
 * own route, told its concepts and the item they build toward.
 *
 * Every lesson ends with a "How it fits in" section on how it serves each
 * item that needs it (v8.23.0), and remembers which items those were
 * (`fitFor`). When they change later, `refit` rewrites that section alone.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useState } from 'react'
import { fitLesson, streamLesson, streamSynthesisLesson, type KnowledgeNeed } from '../api'
import { useAppDispatch } from '../store'
import { knowledgeLessonWritten } from '../store/explorations'
import {
  fitIsStale,
  fitNeeds,
  joinLesson,
  neededBy,
  routeWhy,
  splitLesson,
  stepOf,
  tutorPath,
  type KnowledgeMap,
} from './model'

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
 * The items that need an item, with why, as the tutor is told them.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns Those items.
 */
function needsOf(map: KnowledgeMap, nodeId: string): KnowledgeNeed[] {
  return neededBy(map, nodeId)
    .filter((edge) => map.nodes[edge.from])
    .map((edge) => ({ ...stepOf(map.nodes[edge.from]), why: edge.why }))
}

/**
 * Stream lessons for one thread's course.
 *
 * @param threadId The thread the course belongs to.
 * @returns The drafts in flight by node id, `write` to start one,
 *   `writing` — true for a lesson still streaming from an earlier mount —
 *   and `refit` / `refitting`, to rewrite a stale "How it fits in" section.
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
      // The items the closing section is written for, as of now.
      const fitFor = fitNeeds(map, nodeId)
      const handlers = {
        onToken: (chunk: string) => {
          text += chunk
          update({ text })
        },
        onDone: () => {
          IN_FLIGHT.delete(flightKey)
          if (text) dispatch(knowledgeLessonWritten({ threadId, nodeId, text, fitFor }))
          update(null)
        },
        onError: (message: string) => {
          IN_FLIGHT.delete(flightKey)
          update({ text, error: message })
        },
      }
      const paperId = map.nodes[map.rootId]?.paper?.id
      const toward = node.toward ? map.nodes[node.toward] : undefined
      const streaming =
        node.kind === 'synthesis' && toward
          ? streamSynthesisLesson(
              {
                name: node.title,
                members: (node.members ?? [])
                  .map((id) => map.nodes[id])
                  .filter(Boolean)
                  .map(stepOf),
                toward: stepOf(toward),
                path: tutorPath(map, toward.id),
                paper_id: paperId,
              },
              handlers,
            )
          : streamLesson(
              {
                item: stepOf(node),
                why: routeWhy(map, nodeId),
                path: tutorPath(map, nodeId),
                needed_by: needsOf(map, nodeId),
                abstract: node.paper?.abstract ?? '',
                paper_id: paperId,
                ...(node.freshLesson && { fresh: true }),
              },
              handlers,
            )
      void streaming.catch((error: unknown) => {
        IN_FLIGHT.delete(flightKey)
        update({ text, error: error instanceof Error ? error.message : 'The lesson failed' })
      })
    },
    [dispatch, threadId],
  )

  // Items whose closing section is being rewritten, by node id.
  const [refitting, setRefitting] = useState<ReadonlySet<string>>(new Set())
  const refit = useCallback(
    (map: KnowledgeMap, nodeId: string) => {
      const node = map.nodes[nodeId]
      const flightKey = `${threadId}:${nodeId}:fit`
      if (!node?.lesson || !fitIsStale(map, nodeId) || IN_FLIGHT.has(flightKey)) return
      IN_FLIGHT.add(flightKey)
      const { body } = splitLesson(node.lesson)
      const fitFor = fitNeeds(map, nodeId)
      const setFlight = (on: boolean) =>
        setRefitting((previous) => {
          const next = new Set(previous)
          if (on) next.add(nodeId)
          else next.delete(nodeId)
          return next
        })
      setFlight(true)
      fitLesson({
        item: stepOf(node),
        lesson: body,
        needed_by: needsOf(map, nodeId),
        paper_id: map.nodes[map.rootId]?.paper?.id,
      })
        .then((fit) =>
          dispatch(
            knowledgeLessonWritten({ threadId, nodeId, text: joinLesson(body, fit), fitFor }),
          ),
        )
        // A failed rewrite keeps the old section; the next open tries again.
        .catch(() => undefined)
        .finally(() => {
          IN_FLIGHT.delete(flightKey)
          setFlight(false)
        })
    },
    [dispatch, threadId],
  )

  const writing = useCallback(
    (nodeId: string) => IN_FLIGHT.has(`${threadId}:${nodeId}`),
    [threadId],
  )

  return { drafts, write, writing, refit, refitting }
}
