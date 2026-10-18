/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * How a conversation is addressed once a thread can hold more than one
 * (v8.25.0). A paper thread's tools each keep their own assistant: the
 * Citation Graph's, as ever, and the Knowledge Graph's. So the unit a
 * transcript key, a summary, a sibling-index entry and an `@thread[…]`
 * mention name is a **chat**: a thread and a tool.
 *
 * **The Citation Graph's chat keeps the thread's own id as its key**, and
 * General's (which has no tools) does too. Everything written before chats
 * were per tool already addresses that chat, so no save, transcript key or
 * `Context from` link needs migrating; only the Knowledge Graph's chat is
 * new, under `<threadId>:knowledge`. Likewise a mention keeps its old text,
 * `@thread[Title]`, for General, and a paper thread's chats are labelled by
 * tool, `@thread[PPO › Knowledge Graph]`, with a bare `@thread[PPO]` (a
 * message sent before) still read as its Citation Graph chat.
 *
 * Pure functions over the slices' shapes; type imports only, so any slice
 * can use them without closing an import cycle.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { ChatMsg } from '../api'
import type { ExplorationRecord, ThreadRecord } from './explorations'
import type { TranscriptState } from './transcript'

/** The tools that have an assistant. The card home has none. */
export type ChatTool = 'graph' | 'knowledge'

/** Each tool's name, as its card on the thread's home says it. */
export const CHAT_TOOL_NAMES: Record<ChatTool, string> = {
  graph: 'Citation Graph',
  knowledge: 'Knowledge Graph',
}

/** Between a thread's id and its tool in a Knowledge Graph chat's key.
 *  Thread ids are nanoids (and `initial`), which never hold one. */
const KEY_SEPARATOR = ':'

/** Between a thread's title and its tool's name in a chat's label. */
const LABEL_SEPARATOR = ' › '

/**
 * A chat's transcript key.
 *
 * @param threadId The thread.
 * @param tool The tool whose assistant it is.
 * @returns The thread's id for its Citation Graph (and General), else
 *          `<threadId>:<tool>`.
 */
export function chatKey(threadId: string, tool: ChatTool): string {
  return tool === 'graph' ? threadId : `${threadId}${KEY_SEPARATOR}${tool}`
}

/**
 * The thread and tool a transcript key addresses.
 *
 * @param key A chat key, or a bare thread id (a key written before v8.25.0).
 * @returns Its thread and tool.
 */
export function chatOf(key: string): { threadId: string; tool: ChatTool } {
  const at = key.lastIndexOf(KEY_SEPARATOR)
  const tool = at === -1 ? '' : key.slice(at + 1)
  return tool === 'knowledge'
    ? { threadId: key.slice(0, at), tool }
    : { threadId: key, tool: 'graph' }
}

/**
 * A chat's label: what the `@` dropdown lists, what a mention carries
 * between its brackets, and what the sibling index calls it.
 *
 * @param thread The thread.
 * @param tool The tool.
 * @returns `General` for General, else e.g. `PPO › Knowledge Graph`.
 */
export function chatLabel(
  thread: Pick<ThreadRecord, 'title' | 'identity'>,
  tool: ChatTool,
): string {
  return thread.identity
    ? `${thread.title}${LABEL_SEPARATOR}${CHAT_TOOL_NAMES[tool]}`
    : thread.title
}

/**
 * The turns a chat holds: what this sitting has written, else what was saved.
 *
 * @param transcript The transcript slice.
 * @param thread The thread.
 * @param tool The tool.
 * @returns Its turns.
 */
export function chatTurns(
  transcript: Pick<TranscriptState, 'byKey'>,
  thread: ThreadRecord,
  tool: ChatTool,
): ChatMsg[] {
  const live = transcript.byKey[chatKey(thread.id, tool)]?.chat
  if (live) return live
  return tool === 'graph' ? thread.data.chat : (thread.courseChat?.chat ?? [])
}

/**
 * A chat's rolling summary, for the sibling index.
 *
 * @param thread The thread.
 * @param tool The tool.
 * @returns The summary and how many turns it covers.
 */
export function chatSummary(
  thread: ThreadRecord,
  tool: ChatTool,
): { summary?: string; summarizedThrough?: number } {
  return tool === 'graph'
    ? { summary: thread.summary, summarizedThrough: thread.summarizedThrough }
    : {
        summary: thread.courseChat?.summary,
        summarizedThrough: thread.courseChat?.summarizedThrough,
      }
}

/** A chat another chat can reference. */
export interface ChatEntry {
  key: string
  thread: ThreadRecord
  tool: ChatTool
  label: string
}

/**
 * Every chat in an exploration, in thread order: each thread's Citation
 * Graph chat (General's chat for General), and a paper thread's Knowledge
 * Graph chat once it has a course or any turns.
 *
 * @param record The exploration.
 * @param transcript The transcript slice, for turns not saved yet.
 * @returns The chats.
 */
export function explorationChats(
  record: ExplorationRecord,
  transcript: Pick<TranscriptState, 'byKey'>,
): ChatEntry[] {
  return record.threads.flatMap((thread) => {
    const tools: ChatTool[] = ['graph']
    if (thread.identity && (thread.knowledge || chatTurns(transcript, thread, 'knowledge').length))
      tools.push('knowledge')
    return tools.map((tool) => ({
      key: chatKey(thread.id, tool),
      thread,
      tool,
      label: chatLabel(thread, tool),
    }))
  })
}

/**
 * Whether a message mentions a chat. A bare `@thread[Title]` written before
 * chats were per tool names that thread's Citation Graph chat.
 *
 * @param message The message as typed.
 * @param chat The chat.
 * @returns True when the message carries its mention.
 */
export function mentionsChat(message: string, chat: ChatEntry): boolean {
  if (message.includes(`@thread[${chat.label}]`)) return true
  return chat.tool === 'graph' && message.includes(`@thread[${chat.thread.title}]`)
}
