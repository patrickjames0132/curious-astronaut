/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Lazy migration and lossless exploration serialization.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { nanoid } from '@reduxjs/toolkit'
import type { SavedSession, SaveSessionBody, SessionData, ChatMsg } from '../api'
import { paperTag } from './chats'
import type { ExplorationRecord, ExplorationsState, ThreadRecord } from './explorations'
import type { TranscriptState } from './transcript'
import { buildSaveBody, restoredLectureTurn, withGraphRefs } from './workspace'
import type { WorkspaceState } from './workspace'

/** Read a save into an exploration. A legacy save (one chat, before
 * explorations) keeps every turn in its General chat (v9.0.0, chats own the
 * conversation), each question tagged with the paper its answer was stamped
 * with, or the save's own seed when unstamped, and opens a paper thread for
 * each paper its stamps name.
 * @param saved The unchanged on-disk record.
 * @returns An in-memory exploration; reading never writes it back.
 */
export function migrateExploration(saved: SavedSession): ExplorationRecord {
  if (saved.data.exploration)
    return chatsOwnTheConversation({
      id: saved.id,
      title: saved.name,
      ...saved.data.exploration,
      revision: 0,
    })
  const data = saved.data
  const seed = data.graph_ref?.seed ?? data.seed
  const provider = data.provider ?? 's2'
  const threads: ThreadRecord[] = [
    {
      id: nanoid(),
      title: 'General',
      identity: null,
      data: { chat: [], layout: 'timeline', provider },
    },
  ]
  const general = threads[0]
  const home: ThreadRecord = seed
    ? {
        id: nanoid(),
        title: seed.title,
        identity: `${provider}:${seed.id}`,
        data: { ...data, chat: [] },
      }
    : general
  if (seed) threads.push(home)
  else general.data = { ...data, chat: [] }
  let pending: ChatMsg[] = []
  for (const raw of data.chat ?? []) {
    const message = withGraphRefs(raw)
    if (message.role === 'user') {
      pending.push(message)
      continue
    }
    let paper = home
    if (message.graph) {
      const stamp = message.graph
      const backend = stamp.provider ?? provider
      const identity = `${backend}:${stamp.seedId}`
      paper = threads.find((item) => item.identity === identity) ?? {
        id: nanoid(),
        title: stamp.seedTitle,
        identity,
        data: {
          chat: [],
          layout: data.layout,
          provider: backend,
          graph_ref: { seed: { id: stamp.seedId, title: stamp.seedTitle }, seed_ref: stamp.seedId },
        },
      }
      if (!threads.includes(paper)) threads.push(paper)
    }
    const tag = paper.identity ? paperTag(paper, 'graph') : undefined
    general.data.chat.push(...pending.map((question) => (tag ? { ...question, tag } : question)))
    general.data.chat.push(message)
    pending = []
  }
  general.data.chat.push(...pending)
  const lecture = restoredLectureTurn(data)
  if (lecture) general.data.chat.push(lecture)
  return {
    id: saved.id,
    title: saved.name,
    threads,
    activeThreadId: home.id,
    chatId: general.id,
    revision: 0,
  }
}

/**
 * Read an exploration the v9.0.0 way: chats hold the conversation, papers
 * hold none (`store/chats`). A save from before kept a chat on every paper
 * thread, and two more per tool (`courseChat`, `readerChat`); there is no
 * migration (Patrick, 2026-10-26: v9.0.0 is a major release, and nobody but
 * him had installed it), so those are dropped here rather than read wrong.
 *
 * @param record The exploration as read.
 * @returns It with its papers' chats and summaries gone.
 */
function chatsOwnTheConversation(record: ExplorationRecord): ExplorationRecord {
  const threads = record.threads.map((thread) => {
    if (!thread.identity) return thread
    const {
      summary: _summary,
      summarizedThrough: _through,
      courseChat: _course,
      readerChat: _reader,
      ...paper
    } = thread as ThreadRecord & { courseChat?: unknown; readerChat?: unknown }
    return { ...paper, data: { ...thread.data, chat: [] } }
  })
  return { ...record, threads }
}

/** Save all threads from one immutable state snapshot, never from a later active canvas.
 * @param state Store snapshot taken before awaiting anything.
 * @param record Exploration to serialize.
 * @returns Versioned parent with the existing session payload in each thread.
 */
export function explorationBody(
  state: {
    workspace: WorkspaceState
    transcript: TranscriptState
    explorations: ExplorationsState
  },
  record: ExplorationRecord,
): SaveSessionBody {
  const threads = record.threads.map((thread) => {
    const conversation = state.transcript.byKey[thread.id]
    const active = state.transcript.activeKey === thread.id
    const workspace = active ? state.workspace : thread.workspace
    let data: SessionData = workspace
      ? buildSaveBody(
          { workspace, transcript: { ...state.transcript, activeKey: thread.id } },
          thread.title,
        )
      : { ...thread.data, chat: conversation?.chat ?? thread.data.chat }
    // A failed rebuild must never erase the only saved seed reference.
    if (!data.graph_ref && thread.data.graph_ref)
      data = { ...data, graph_ref: thread.data.graph_ref }
    const pending = conversation?.pendingDiscoveries
    if (pending?.nodes.length)
      data = {
        ...data,
        discovered_nodes: [...(data.discovered_nodes ?? []), ...pending.nodes],
        discovered_edges: [...(data.discovered_edges ?? []), ...pending.edges],
      }
    const { workspace: _workspace, ...metadata } = thread
    return { ...metadata, data }
  })
  return {
    id: record.id,
    name: record.title,
    layout: 'timeline',
    chat: [],
    exploration: {
      version: 1,
      activeThreadId: record.activeThreadId,
      chatId: record.chatId,
      threads,
      summary: threads
        .filter((thread) => thread.summary)
        .map((thread) => `${thread.title}: ${thread.summary}`)
        .join('\n\n'),
    },
  }
}
