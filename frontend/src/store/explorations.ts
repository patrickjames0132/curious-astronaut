/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Exploration ownership and atomic thread navigation.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { createAction, createSlice, nanoid } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { KnowledgeChild, PaperDetails, SessionData } from '../api'
import { isCurrentMap, withChildren, type KnowledgeMap } from '../knowledge/model'
import type { WorkspaceState } from './workspace'

/**
 * Which surface a paper thread shows: its card home, or one of the tools the
 * cards open. General has no seed, so it has no cards and no tool.
 */
export type ThreadTool = 'cards' | 'graph' | 'knowledge'

export interface ThreadRecord {
  id: string
  title: string
  identity: string | null
  data: SessionData
  workspace?: WorkspaceState
  summary?: string
  summarizedThrough?: number
  origin?: string
  /**
   * The tool last used in this paper thread, so a reload reopens it (a rail
   * click lands on the cards instead: `openThread`, v8.16.0). Absent
   * on threads saved before the card home (v8.13.0): those were always on
   * their graph, so `threadTool` reads absence as `'graph'`.
   */
  tool?: ThreadTool
  /** The seed's hydrated details, for the card home's header. Fetched once. */
  paper?: PaperDetails
  /** The knowledge network's course (v8.14.0), once its card has been opened. */
  knowledge?: KnowledgeMap
}

/**
 * Find a thread anywhere, by id — knowledge updates land on the thread that
 * asked, even after the reader has moved to another one.
 *
 * @param state Exploration state.
 * @param threadId The thread.
 * @returns The thread and its exploration, or undefined.
 */
function findThread(
  state: ExplorationsState,
  threadId: string,
): { record: ExplorationRecord; thread: ThreadRecord } | undefined {
  for (const record of Object.values(state.byId)) {
    const thread = record.threads.find((item) => item.id === threadId)
    if (thread) return { record, thread }
  }
  return undefined
}

/**
 * Apply a change to a thread's course and mark the exploration for autosave.
 *
 * @param state Exploration state.
 * @param threadId The thread.
 * @param change Returns the new tree from the old one.
 */
function updateKnowledge(
  state: ExplorationsState,
  threadId: string,
  change: (map: KnowledgeMap) => KnowledgeMap,
): void {
  const found = findThread(state, threadId)
  if (!isCurrentMap(found?.thread.knowledge)) return
  found.thread.knowledge = change(found.thread.knowledge)
  found.record.revision++
}
export interface ExplorationRecord {
  id: string
  title: string
  threads: ThreadRecord[]
  activeThreadId: string
  revision: number
}
export interface ExplorationsState {
  activeId: string
  byId: Record<string, ExplorationRecord>
}

/** Start an exploration with its permanent General thread.
 * @param id Optional stable saved-row id.
 * @returns Empty exploration.
 */
export function newExploration(id = nanoid()): ExplorationRecord {
  const threadId = nanoid()
  return {
    id,
    title: 'Untitled exploration',
    activeThreadId: threadId,
    revision: 0,
    threads: [
      { id: threadId, title: 'General', identity: null, data: { chat: [], layout: 'timeline' } },
    ],
  }
}

/** The surface a thread shows, or null for General (which has no cards).
 * @param thread The thread, if any.
 * @returns Its current tool.
 */
export function threadTool(thread: ThreadRecord | undefined): ThreadTool | null {
  if (!thread?.identity) return null
  return thread.tool ?? 'graph'
}

export const explorationOpened = createAction<ExplorationRecord>('explorations/opened')
export const threadActivated = createAction<{
  explorationId: string
  thread: ThreadRecord
  outgoingId: string
  outgoing: WorkspaceState
  requestId?: string
}>('explorations/threadActivated')
const first = newExploration()
first.threads[0].id = 'initial'
first.activeThreadId = 'initial'
const initialState: ExplorationsState = { activeId: first.id, byId: { [first.id]: first } }
const slice = createSlice({
  name: 'explorations',
  initialState,
  reducers: {
    /** Remove a graph thread; General is permanent.
     * @param state Exploration state.
     * @param action Thread id to remove.
     */
    threadRemoved(state, action: PayloadAction<string>) {
      for (const record of Object.values(state.byId)) {
        const thread = record.threads.find((item) => item.id === action.payload)
        if (!thread?.identity) continue
        record.threads = record.threads.filter((item) => item.id !== thread.id)
        record.revision++
      }
    },
    /** Mark an intentional view edit for autosave.
     * @param state Exploration state.
     */
    threadEdited(state) {
      const record = state.byId[state.activeId]
      if (record) record.revision++
    },
    /** Rename without triggering model-generated title churn.
     * @param state Exploration state.
     * @param action Target and new title.
     */
    explorationRenamed(state, action: PayloadAction<{ id: string; title: string }>) {
      const record = state.byId[action.payload.id]
      if (record) {
        record.title = action.payload.title
        record.revision++
      }
    },
    /** Remove local ownership so a pending save cannot resurrect a deletion.
     * @param state Exploration state.
     * @param action Removed id.
     */
    explorationRemoved(state, action: PayloadAction<string>) {
      delete state.byId[action.payload]
    },
    /** Persist a reader's graph-thread title.
     * @param state Exploration state.
     * @param action Thread and title.
     */
    threadRenamed(state, action: PayloadAction<{ id: string; title: string }>) {
      const record = state.byId[state.activeId]
      const thread = record.threads.find((item) => item.id === action.payload.id)
      if (thread?.identity) {
        thread.title = action.payload.title
        record.revision++
      }
    },
    /** Switch the active thread between its card home and its tools.
     * @param state Exploration state.
     * @param action The tool to show.
     */
    threadToolSet(state, action: PayloadAction<ThreadTool>) {
      const record = state.byId[state.activeId]
      const thread = record?.threads.find((item) => item.id === record.activeThreadId)
      if (thread?.identity && thread.tool !== action.payload) {
        thread.tool = action.payload
        record.revision++
      }
    },
    /** Rest a paper thread on its card home, whether or not it is active.
     * @param state Exploration state.
     * @param action The thread's id.
     */
    threadCardsShown(state, action: PayloadAction<string>) {
      for (const record of Object.values(state.byId)) {
        const thread = record.threads.find((item) => item.id === action.payload)
        if (thread?.identity && thread.tool !== 'cards') {
          thread.tool = 'cards'
          record.revision++
        }
      }
    },
    /** Keep the seed's hydrated details for the card home's header.
     * @param state Exploration state.
     * @param action Thread and its paper.
     */
    threadPaperSet(state, action: PayloadAction<{ id: string; paper: PaperDetails }>) {
      for (const record of Object.values(state.byId)) {
        const thread = record.threads.find((item) => item.id === action.payload.id)
        if (thread) {
          thread.paper = action.payload.paper
          record.revision++
        }
      }
    },
    /** Start a thread's course (its first open of the knowledge network).
     * A course saved in an older shape is replaced.
     * @param state Exploration state.
     * @param action The thread and its one-node map.
     */
    knowledgeStarted(state, action: PayloadAction<{ threadId: string; map: KnowledgeMap }>) {
      const found = findThread(state, action.payload.threadId)
      if (!found || isCurrentMap(found.thread.knowledge)) return
      found.thread.knowledge = action.payload.map
      found.record.revision++
    },
    /** Attach an item's prerequisites, as the tutor listed them.
     * @param state Exploration state.
     * @param action The thread, the expanded item, and its children.
     */
    knowledgeExpanded(
      state,
      action: PayloadAction<{ threadId: string; nodeId: string; children: KnowledgeChild[] }>,
    ) {
      const { threadId, nodeId, children } = action.payload
      updateKnowledge(state, threadId, (map) => withChildren(map, nodeId, children))
    },
    /** Keep a finished lesson and its citations, so reopening it costs nothing.
     * @param state Exploration state.
     * @param action The thread, the item, the lesson's Markdown and its cited papers.
     */
    knowledgeLessonWritten(
      state,
      action: PayloadAction<{
        threadId: string
        nodeId: string
        text: string
      }>,
    ) {
      const { threadId, nodeId, text } = action.payload
      updateKnowledge(state, threadId, (map) =>
        map.nodes[nodeId]
          ? {
              ...map,
              nodes: {
                ...map.nodes,
                [nodeId]: { ...map.nodes[nodeId], lesson: text },
              },
            }
          : map,
      )
    },
    /** Check an item off as known, or un-check it.
     * @param state Exploration state.
     * @param action The thread and the item.
     */
    knowledgeKnownToggled(state, action: PayloadAction<{ threadId: string; nodeId: string }>) {
      const { threadId, nodeId } = action.payload
      updateKnowledge(state, threadId, (map) => ({
        ...map,
        known: map.known.includes(nodeId)
          ? map.known.filter((other) => other !== nodeId)
          : [...map.known, nodeId],
      }))
    },
    /** Mark several items known, or not known, at once (the selection, v8.17.0).
     * @param state Exploration state.
     * @param action The thread, the items, and whether they are known.
     */
    knowledgeKnownSet(
      state,
      action: PayloadAction<{ threadId: string; nodeIds: string[]; known: boolean }>,
    ) {
      const { threadId, nodeIds, known } = action.payload
      updateKnowledge(state, threadId, (map) => {
        const real = nodeIds.filter((nodeId) => map.nodes[nodeId])
        return {
          ...map,
          known: known
            ? [...map.known, ...real.filter((nodeId) => !map.known.includes(nodeId))]
            : map.known.filter((nodeId) => !real.includes(nodeId)),
        }
      })
    },
    /** Open an item's lesson (marking it visited), or close the panel with null.
     * @param state Exploration state.
     * @param action The thread and the item, or null.
     */
    knowledgeOpened(state, action: PayloadAction<{ threadId: string; nodeId: string | null }>) {
      const { threadId, nodeId } = action.payload
      updateKnowledge(state, threadId, (map) => {
        const node = nodeId ? map.nodes[nodeId] : undefined
        if (nodeId && !node) return map
        return {
          ...map,
          openId: nodeId,
          nodes:
            node && !node.visited
              ? { ...map.nodes, [node.id]: { ...node, visited: true } }
              : map.nodes,
        }
      })
    },
    /** Store a summary only for the revision the summarizer actually read.
     * @param state Exploration state.
     * @param action Summary with its owning thread and revision.
     */
    threadSummarized(
      state,
      action: PayloadAction<{
        explorationId: string
        id: string
        summary: string
        through: number
      }>,
    ) {
      const record = state.byId[action.payload.explorationId]
      const thread = record?.threads.find((item) => item.id === action.payload.id)
      if (thread) {
        thread.summary = action.payload.summary
        thread.summarizedThrough = action.payload.through
        record.revision++
      }
    },
  },
  extraReducers: (builder) =>
    builder
      .addCase(explorationOpened, (state, action) => {
        state.byId[action.payload.id] = action.payload
        state.activeId = action.payload.id
      })
      .addCase(threadActivated, (state, action) => {
        const record = state.byId[action.payload.explorationId]
        if (!record) return
        const outgoing = record.threads.find((item) => item.id === action.payload.outgoingId)
        if (outgoing) outgoing.workspace = action.payload.outgoing
        if (!record.threads.some((item) => item.id === action.payload.thread.id))
          record.threads.push(action.payload.thread)
        record.activeThreadId = action.payload.thread.id
        record.revision++
        state.activeId = record.id
      })
      .addMatcher(
        (action) => action.type === 'transcript/chatCleared',
        (state, action) => {
          const key = (action as { meta?: { key?: string } }).meta?.key
          for (const record of Object.values(state.byId)) {
            const thread = record.threads.find(
              (item) => item.id === (key ?? state.byId[state.activeId]?.activeThreadId),
            )
            if (thread) {
              delete thread.summary
              delete thread.summarizedThrough
              record.revision++
            }
          }
        },
      ),
})
export const {
  threadRemoved,
  threadEdited,
  explorationRenamed,
  explorationRemoved,
  threadRenamed,
  threadSummarized,
  threadToolSet,
  threadCardsShown,
  threadPaperSet,
  knowledgeStarted,
  knowledgeExpanded,
  knowledgeLessonWritten,
  knowledgeKnownToggled,
  knowledgeKnownSet,
  knowledgeOpened,
} = slice.actions
export default slice.reducer
