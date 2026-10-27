/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Exploration ownership and atomic thread navigation.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { createAction, createSlice, nanoid } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { AnswerFigure, KnowledgeChild, PaperDetails, Provider, SessionData } from '../api'
import {
  isCurrentMap,
  withChildren,
  withSynthesis,
  withBreakdownAgain,
  withRestored,
  withPrerequisite,
  withoutItems,
  withForgotten,
  type KnowledgeMap,
} from '../knowledge/model'
import type { WorkspaceState } from './workspace'

/**
 * Which surface a paper thread shows: its card home, or one of the tools the
 * cards open. General has no seed, so it has no cards and no tool.
 */
export type ThreadTool = 'cards' | 'graph' | 'knowledge' | 'reader' | 'reviews'

/** How the Reader shows a paper: its HTML render's text, or its PDF. */
export type ReaderView = 'text' | 'pdf'

/** A place in the Reader (v8.44.0): the section or page at the top of the
 *  pane (its `data-section-id`) and how far into it, as a fraction of its
 *  height, so the place holds when images load or pages rescale. */
export interface ReaderPlace {
  view: ReaderView
  at: string
  fraction: number
}

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
  /** How the Reader shows the paper (v8.40.0): its text, or its PDF. Absent
   *  means the text, when there is one; a paper with no HTML render shows
   *  its PDF regardless. */
  readerView?: ReaderView
  /** Where the reader was in the Reader (v8.44.0), so it reopens there. */
  readerPlace?: ReaderPlace
  /**
   * A tool to come back to (v8.44.0): set when the Reader opens a concept's
   * lesson in the Knowledge Graph, so the Knowledge Graph offers the way back
   * to the paper. It lasts only while the thread stays on `from`.
   */
  returnTo?: { tool: ThreadTool; from: ThreadTool }
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
  /**
   * The dock's chat (v9.0.0): the chat last in, which every view's docked
   * assistant talks in. Absent or stale, the first chat (`store/chats`'s
   * `dockChatId`).
   */
  chatId?: string
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
    chatId: threadId,
    revision: 0,
    threads: [
      // Named from its first question, like every chat since v8.31.0. An
      // exploration saved before keeps its `General`.
      {
        id: threadId,
        title: NEW_CHAT_TITLE,
        identity: null,
        data: { chat: [], layout: 'timeline' },
      },
    ],
  }
}

/** What a new General chat is called until its first question names it
 *  (v8.31.0; `shell/useExplorations` titles it). */
export const NEW_CHAT_TITLE = 'New chat'

/**
 * Whether a General chat still wears the placeholder title, numbered or not,
 * so its first question should name it.
 *
 * @param thread The thread.
 * @returns True for a General chat titled `New chat` or `New chat (n)`.
 */
export function awaitsTitle(thread: Pick<ThreadRecord, 'title' | 'identity'>): boolean {
  return !thread.identity && /^New chat( \(\d+\))?$/.test(thread.title)
}

/**
 * A title no other thread in the exploration wears (v8.31.0). Chats are named
 * by title wherever they are referenced — the `@` list, a sent
 * `@thread[Title]`, the sibling index — so two General chats called alike
 * would be one chat to all of them. A clash gets the next free ` (n)`.
 *
 * @param threads The exploration's threads.
 * @param title The title wanted.
 * @param exceptId The thread being named, whose own title doesn't clash.
 * @returns The title, or it numbered.
 */
export function uniqueTitle(threads: ThreadRecord[], title: string, exceptId?: string): string {
  const taken = new Set(
    threads.filter((thread) => thread.id !== exceptId).map((thread) => thread.title),
  )
  if (!taken.has(title)) return title
  let count = 2
  while (taken.has(`${title} (${count})`)) count++
  return `${title} (${count})`
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
first.chatId = 'initial'
const initialState: ExplorationsState = { activeId: first.id, byId: { [first.id]: first } }
const slice = createSlice({
  name: 'explorations',
  initialState,
  reducers: {
    /** Remove a thread. A General chat goes only while another remains
     * (v8.31.0): an exploration always keeps one.
     * @param state Exploration state.
     * @param action Thread id to remove.
     */
    threadRemoved(state, action: PayloadAction<string>) {
      for (const record of Object.values(state.byId)) {
        const thread = record.threads.find((item) => item.id === action.payload)
        if (!thread) continue
        if (!thread.identity && record.threads.filter((item) => !item.identity).length < 2) continue
        record.threads = record.threads.filter((item) => item.id !== thread.id)
        // The dock falls back to the first chat (`dockChatId`).
        if (record.chatId === thread.id) delete record.chatId
        record.revision++
      }
    },
    /** Start another General chat in the active exploration (v8.31.0), after
     * the General chats already there, so they stay together at the top of
     * the rail. Titled `New chat` until its first question names it.
     * @param state Exploration state.
     * @param action The new thread's id (made by `prepare`).
     */
    generalChatAdded: {
      reducer(state, action: PayloadAction<string>) {
        const record = state.byId[state.activeId]
        if (!record) return
        let after = -1
        record.threads.forEach((thread, index) => {
          if (!thread.identity) after = index
        })
        record.threads.splice(after + 1, 0, {
          id: action.payload,
          title: uniqueTitle(record.threads, NEW_CHAT_TITLE),
          identity: null,
          data: { chat: [], layout: 'timeline' },
        })
        record.revision++
      },
      prepare: () => ({ payload: nanoid() }),
    },
    /** Put another chat in the dock (v9.0.0): the docked panel's chat picker,
     * which switches conversations without leaving the view. Only a chat of
     * the active exploration can be docked.
     * @param state Exploration state.
     * @param action The chat's id.
     */
    dockChatSet(state, action: PayloadAction<string>) {
      const record = state.byId[state.activeId]
      const chat = record?.threads.find((item) => item.id === action.payload)
      if (!chat || chat.identity || record.chatId === chat.id) return
      record.chatId = chat.id
      record.revision++
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
    /** Persist a thread's title: a reader's rename, or (v8.31.0) a new
     * General chat named from its first question, which may land after the
     * reader has moved to another exploration. Kept unique (`uniqueTitle`).
     * @param state Exploration state.
     * @param action Thread and title.
     */
    threadRenamed(state, action: PayloadAction<{ id: string; title: string }>) {
      for (const record of Object.values(state.byId)) {
        const thread = record.threads.find((item) => item.id === action.payload.id)
        if (!thread) continue
        thread.title = uniqueTitle(record.threads, action.payload.title, thread.id)
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
        // A way back lasts only while the thread stays where it was set for.
        if (thread.returnTo && thread.returnTo.from !== action.payload) delete thread.returnTo
        record.revision++
      }
    },
    /** Offer a way back to a tool from the one about to open (v8.44.0).
     * @param state Exploration state.
     * @param action The thread, and the way back (null to drop it).
     */
    threadReturnSet(
      state,
      action: PayloadAction<{
        id: string
        returnTo: { tool: ThreadTool; from: ThreadTool } | null
      }>,
    ) {
      for (const record of Object.values(state.byId)) {
        const thread = record.threads.find((item) => item.id === action.payload.id)
        if (!thread) continue
        if (action.payload.returnTo) thread.returnTo = action.payload.returnTo
        else delete thread.returnTo
      }
    },
    /** Remember where the reader was in the Reader (v8.44.0).
     * @param state Exploration state.
     * @param action The thread and its place.
     */
    threadReaderPlaceSet(state, action: PayloadAction<{ id: string; place: ReaderPlace }>) {
      for (const record of Object.values(state.byId)) {
        const thread = record.threads.find((item) => item.id === action.payload.id)
        if (thread) {
          thread.readerPlace = action.payload.place
          record.revision++
        }
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
          delete thread.returnTo
          record.revision++
        }
      }
    },
    /** The Reader's Text/PDF switch, remembered on the thread (v8.40.0).
     * @param state Exploration state.
     * @param action The thread and its view.
     */
    threadReaderViewSet(state, action: PayloadAction<{ id: string; view: ReaderView }>) {
      for (const record of Object.values(state.byId)) {
        const thread = record.threads.find((item) => item.id === action.payload.id)
        if (thread) {
          thread.readerView = action.payload.view
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
    /** Move a paper thread onto another data source **in place** (v8.28.1):
     * switching the provider used to open a twin thread for the same paper,
     * leaving its chats and course behind. The thread keeps its id, title,
     * chats and course; what is provider-specific moves — its identity, its
     * seed reference, the card header's details, and the course's root paper
     * id (lessons resolve the PDF by it, under the thread's provider).
     * @param state Exploration state.
     * @param action The thread and where it now lives.
     */
    threadRebased(
      state,
      action: PayloadAction<{
        threadId: string
        identity: string
        provider: Provider
        graphRef: NonNullable<SessionData['graph_ref']>
        paper?: PaperDetails
      }>,
    ) {
      const found = findThread(state, action.payload.threadId)
      if (!found?.thread.identity) return
      const { thread, record } = found
      thread.identity = action.payload.identity
      thread.data = {
        ...thread.data,
        provider: action.payload.provider,
        graph_ref: action.payload.graphRef,
      }
      if (action.payload.paper) thread.paper = action.payload.paper
      const knowledge = thread.knowledge
      const root = isCurrentMap(knowledge) ? knowledge.nodes[knowledge.rootId] : undefined
      if (root?.paper) root.paper = { ...root.paper, id: action.payload.graphRef.seed.id }
      record.revision++
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
    /** Attach an item's prerequisites, as the tutor listed them; with
     * `again`, replace its breakdown with this fresh one (v8.23.0).
     * @param state Exploration state.
     * @param action The thread, the expanded item, its children, and whether it is a redo.
     */
    knowledgeExpanded(
      state,
      action: PayloadAction<{
        threadId: string
        nodeId: string
        children: KnowledgeChild[]
        again?: boolean
      }>,
    ) {
      const { threadId, nodeId, children, again } = action.payload
      updateKnowledge(state, threadId, (map) =>
        again ? withBreakdownAgain(map, nodeId, children) : withChildren(map, nodeId, children),
      )
    },
    /** Hang one prerequisite under an item: the concept behind a passage
     * highlighted in its lesson (v8.25.0, the lesson's Expand).
     * @param state Exploration state.
     * @param action The thread, the item, and the concept with why it is needed.
     */
    knowledgePrerequisiteAdded(
      state,
      action: PayloadAction<{ threadId: string; nodeId: string; child: KnowledgeChild }>,
    ) {
      const { threadId, nodeId, child } = action.payload
      updateKnowledge(state, threadId, (map) => withPrerequisite(map, nodeId, child))
    },
    /** Bring back an item's deleted prerequisites from its remembered breakdown (v8.23.0).
     * @param state Exploration state.
     * @param action The thread and the item.
     */
    knowledgeRestored(state, action: PayloadAction<{ threadId: string; nodeId: string }>) {
      const { threadId, nodeId } = action.payload
      updateKnowledge(state, threadId, (map) => withRestored(map, nodeId))
    },
    /** Add a synthesis: several concepts synthesized toward an item (v8.23.0).
     * @param state Exploration state.
     * @param action The thread, and the synthesis's name, reason, concepts and target.
     */
    knowledgeSynthesized(
      state,
      action: PayloadAction<{
        threadId: string
        name: string
        why: string
        members: string[]
        toward: string
      }>,
    ) {
      const { threadId, ...synthesis } = action.payload
      updateKnowledge(state, threadId, (map) => withSynthesis(map, synthesis))
    },
    /** Delete items, never the paper, with what only they needed and the
     * syntheses they leave short (v8.23.0).
     * @param state Exploration state.
     * @param action The thread and the items.
     */
    knowledgeDeleted(state, action: PayloadAction<{ threadId: string; nodeIds: string[] }>) {
      const { threadId, nodeIds } = action.payload
      updateKnowledge(state, threadId, (map) => withoutItems(map, nodeIds))
    },
    /** Delete an item for good (v8.26.0): deleted as above, and forgotten,
     * so no restore brings it back.
     * @param state Exploration state.
     * @param action The thread and the item.
     */
    knowledgeForgotten(state, action: PayloadAction<{ threadId: string; nodeId: string }>) {
      const { threadId, nodeId } = action.payload
      updateKnowledge(state, threadId, (map) => withForgotten(map, nodeId))
    },
    /** Keep a finished lesson, so reopening it costs nothing; also how a
     * lesson's rewritten "How it fits in" section lands (v8.23.0). A new
     * lesson lands with its images (v8.24.0); a rewrite keeps the ones it has.
     * @param state Exploration state.
     * @param action The thread, the item, the lesson's Markdown, the items its
     *   closing section was written for, and its images.
     */
    knowledgeLessonWritten(
      state,
      action: PayloadAction<{
        threadId: string
        nodeId: string
        text: string
        fitFor?: string[]
        images?: AnswerFigure[]
      }>,
    ) {
      const { threadId, nodeId, text, fitFor, images } = action.payload
      updateKnowledge(state, threadId, (map) =>
        map.nodes[nodeId]
          ? {
              ...map,
              nodes: {
                ...map.nodes,
                [nodeId]: {
                  ...map.nodes[nodeId],
                  lesson: text,
                  ...(fitFor && { fitFor }),
                  ...(images && { images }),
                  freshLesson: undefined,
                },
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
    /** Clear a lesson to be written again (v8.24.0, ↻ "Rewrite this lesson"):
     * its text, images and what its closing section was written for go, and
     * it is marked `freshLesson`, so it is written past the server's cache.
     * @param state Exploration state.
     * @param action The thread and the item.
     */
    knowledgeLessonCleared(state, action: PayloadAction<{ threadId: string; nodeId: string }>) {
      const { threadId, nodeId } = action.payload
      updateKnowledge(state, threadId, (map) => {
        const node = map.nodes[nodeId]
        if (!node?.lesson) return map
        const { lesson: _lesson, fitFor: _fitFor, images: _images, ...rest } = node
        return { ...map, nodes: { ...map.nodes, [nodeId]: { ...rest, freshLesson: true } } }
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
    /** Store a chat's summary only for the revision the summarizer actually read.
     * @param state Exploration state.
     * @param action Summary with its chat and revision.
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
      const { explorationId, id, summary, through } = action.payload
      const record = state.byId[explorationId]
      const thread = record?.threads.find((item) => item.id === id)
      if (!thread) return
      thread.summary = summary
      thread.summarizedThrough = through
      record.revision++
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
        // Opening a chat makes it the dock's (v9.0.0); opening a paper keeps
        // the chat you were last in.
        if (!action.payload.thread.identity) record.chatId = action.payload.thread.id
        record.revision++
        state.activeId = record.id
      })
      .addMatcher(
        (action) => action.type === 'transcript/chatCleared',
        (state, action) => {
          // A cleared chat drops its summary. Every clear names its chat.
          const key = (action as { meta?: { key?: string } }).meta?.key
          for (const record of Object.values(state.byId)) {
            const thread = record.threads.find((item) => item.id === key)
            if (!thread) continue
            delete thread.summary
            delete thread.summarizedThrough
            record.revision++
          }
        },
      ),
})
export const {
  threadRemoved,
  generalChatAdded,
  dockChatSet,
  threadEdited,
  explorationRenamed,
  explorationRemoved,
  threadRenamed,
  threadSummarized,
  threadToolSet,
  threadCardsShown,
  threadPaperSet,
  threadReaderViewSet,
  threadReaderPlaceSet,
  threadReturnSet,
  threadRebased,
  knowledgeStarted,
  knowledgeExpanded,
  knowledgeSynthesized,
  knowledgeDeleted,
  knowledgeForgotten,
  knowledgeRestored,
  knowledgePrerequisiteAdded,
  knowledgeLessonWritten,
  knowledgeLessonCleared,
  knowledgeKnownToggled,
  knowledgeKnownSet,
  knowledgeOpened,
} = slice.actions
export default slice.reducer
