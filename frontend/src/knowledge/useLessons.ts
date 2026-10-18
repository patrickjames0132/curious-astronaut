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
 * A lesson is written with its inline images (v8.24.0): the tutor searches
 * the reader's library, papers and the web for the pictures it wants while
 * it writes, and places them before its text. Until the text starts, the
 * draft's `step` is one status line that says where the tutor is; then the
 * text streams with its images already in place (Patrick: stream it), and
 * lesson and images land on the course together when it's done. `quick` gives up on the images
 * for a lesson still being written: it stops that run and writes the lesson
 * from the tutor's own knowledge alone, the quick response.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useState } from 'react'
import {
  fitLesson,
  streamLesson,
  streamSynthesisLesson,
  type AnswerFigure,
  type KnowledgeNeed,
  type Provider,
} from '../api'
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
  withoutImageMarks,
  type KnowledgeMap,
} from './model'

/** A lesson being written: its text and images so far, the step it is on,
 *  whether it is a quick response, or why it failed. */
export interface LessonDraft {
  text: string
  /** The images placed so far (v8.24.0): placed before the text is written,
   *  so they are in hand by the time it streams. */
  images: AnswerFigure[]
  /** What the tutor is doing now, as the panel's one status line (v8.24.0). */
  step: string
  /** Every step so far, oldest first: the line unfolds into them, the tutor's
   *  train of thought (v8.24.0). */
  steps: string[]
  /** Written without images, so there is no quicker way to offer. */
  quick?: boolean
  error?: string
}

/** The status line while the lesson's own text is being written. */
const WRITING_STEP = 'Writing the lesson…'

/**
 * Lessons being written, app-wide, as `threadId:nodeId`. Module-level rather
 * than per hook, because the hook unmounts whenever the reader leaves the
 * tool while a stream it started carries on — a remount must not start the
 * same lesson a second time.
 */
const IN_FLIGHT = new Set<string>()

/** How to stop a lesson being written, by the same key, for a quick response. */
const STOPS = new Map<string, AbortController>()

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
 * @param provider The graph's provider, which resolves the paper's PDF for
 *   its figures.
 * @returns The drafts in flight by node id, `write` to start one, `quick`
 *   to give up on a lesson's images and have it now (v8.24.0), `writing` —
 *   true for a lesson still being written from an earlier mount — and
 *   `refit` / `refitting`, to rewrite a stale "How it fits in" section.
 */
export function useLessons(threadId: string, provider: Provider) {
  const dispatch = useAppDispatch()
  const [drafts, setDrafts] = useState<Record<string, LessonDraft>>({})

  // The tutor finds its images first, then writes (v8.24.0): the draft's step
  // is the panel's one status line until the text starts, and the text then
  // streams with its images in place.
  const start = useCallback(
    (map: KnowledgeMap, nodeId: string, quick: boolean) => {
      const node = map.nodes[nodeId]
      const flightKey = `${threadId}:${nodeId}`
      if (!node || node.lesson || IN_FLIGHT.has(flightKey)) return
      IN_FLIGHT.add(flightKey)
      const stop = new AbortController()
      STOPS.set(flightKey, stop)
      let text = ''
      const images: AnswerFigure[] = []
      const update = (draft: LessonDraft | null) =>
        setDrafts((previous) => {
          const next = { ...previous }
          if (draft) next[nodeId] = draft
          else delete next[nodeId]
          return next
        })
      const steps: string[] = []
      update({ text, images, step: WRITING_STEP, steps, quick })
      // The items the closing section is written for, as of now.
      const fitFor = fitNeeds(map, nodeId)
      const release = () => {
        IN_FLIGHT.delete(flightKey)
        if (STOPS.get(flightKey) === stop) STOPS.delete(flightKey)
      }
      const fail = (message: string) => {
        // Stopped for a quick response: that one carries on, this one is moot.
        if (stop.signal.aborted) return
        release()
        update({ text, images, step: '', steps, quick, error: message })
      }
      const handlers = {
        onToken: (chunk: string) => {
          text += chunk
          update({ text, images: [...images], step: WRITING_STEP, steps, quick })
        },
        onStep: (step: string) => {
          if (steps[steps.length - 1] !== step) steps.push(step)
          update({ text, images: [...images], step, steps: [...steps], quick })
        },
        onImage: (image: AnswerFigure) => {
          images.push(image)
        },
        onDone: () => {
          if (stop.signal.aborted) return
          release()
          if (text) dispatch(knowledgeLessonWritten({ threadId, nodeId, text, fitFor, images }))
          update(null)
        },
        onError: fail,
        signal: stop.signal,
      }
      const paperNode = map.nodes[map.rootId]?.paper
      const pictures = {
        ...(quick && { quick: true }),
        ...(paperNode && {
          paper: { id: paperNode.id, arxiv_id: paperNode.arxiv_id, title: paperNode.title },
        }),
        provider,
      }
      const paperId = paperNode?.id
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
                ...(node.freshLesson && { fresh: true }),
                ...pictures,
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
                ...pictures,
              },
              handlers,
            )
      void streaming.catch((error: unknown) =>
        fail(error instanceof Error ? error.message : 'The lesson failed'),
      )
    },
    [dispatch, threadId, provider],
  )

  const write = useCallback(
    (map: KnowledgeMap, nodeId: string) => start(map, nodeId, false),
    [start],
  )

  // A quick response (v8.24.0): stop the lesson being written with images
  // and write it from the tutor's own knowledge, now.
  const quick = useCallback(
    (map: KnowledgeMap, nodeId: string) => {
      const flightKey = `${threadId}:${nodeId}`
      STOPS.get(flightKey)?.abort()
      STOPS.delete(flightKey)
      IN_FLIGHT.delete(flightKey)
      start(map, nodeId, true)
    },
    [start, threadId],
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
        lesson: withoutImageMarks(body),
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

  return { drafts, write, quick, writing, refit, refitting }
}
