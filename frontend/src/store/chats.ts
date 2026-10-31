/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Chats own the conversation; views lend it context (v9.0.0, the OnePager's
 * "One assistant", stage 2a). An exploration is a set of papers and several
 * chats: a **chat** is a thread with no paper (`identity: null`), its
 * transcript keyed by its own id, and a **paper thread** is a view (its
 * cards, Citation Graph, course, Reader, reviews) with no conversation of its
 * own. Every view's docked assistant talks in the **dock's chat**: the chat
 * you were last in (`ExplorationRecord.chatId`).
 *
 * Each question is **tagged** with where it was asked (`TurnTag`): General,
 * or a paper and its tool, so a chat that crosses papers still reads on its
 * own. Until v9.0.0 each paper thread held a chat per tool instead (v8.25.0:
 * the Citation Graph's, the Knowledge Graph's, the Reader's), which is what
 * this module used to address.
 *
 * Pure functions over the slices' shapes; type imports only, so any slice
 * can use them without closing an import cycle.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { ChatMsg, TagPaper, TurnTag, TurnTool } from '../api'
import type { ExplorationRecord, ThreadRecord } from './explorations'
import type { TranscriptState } from './transcript'

/** Each tool a question can be asked from, as its card on the paper's home
 *  says it, for a tag's label. */
export const TURN_TOOL_NAMES: Record<TurnTool, string> = {
  graph: 'Citation Graph',
  knowledge: 'Knowledge Graph',
  reader: 'Reader',
}

/** Between a paper's title and its tool's name in a tag's label. */
const LABEL_SEPARATOR = ' › '

/**
 * Whether a thread is a chat (it holds a conversation) rather than a paper.
 *
 * @param thread The thread.
 * @returns True for a thread with no paper.
 */
export function isChat(thread: Pick<ThreadRecord, 'identity'>): boolean {
  return !thread.identity
}

/**
 * The chat an exploration's docks talk in: the chat you were last in, else
 * its first. An exploration always keeps one chat (v8.31.0).
 *
 * @param record The exploration.
 * @returns The chat's id, its transcript key.
 */
export function dockChatId(record: Pick<ExplorationRecord, 'threads' | 'chatId'>): string {
  const chats = record.threads.filter(isChat)
  return chats.find((thread) => thread.id === record.chatId)?.id ?? chats[0]?.id ?? ''
}

/**
 * The conversation on screen: the active chat, or with a paper open, the
 * dock's chat beside it.
 *
 * @param record The exploration.
 * @returns The chat's id.
 */
export function chatOnScreen(
  record: Pick<ExplorationRecord, 'threads' | 'chatId' | 'activeThreadId'>,
): string {
  const active = record.threads.find((thread) => thread.id === record.activeThreadId)
  return active && isChat(active) ? active.id : dockChatId(record)
}

/**
 * The turns a chat holds: what this sitting has written, else what was saved.
 *
 * @param transcript The transcript slice.
 * @param thread The chat.
 * @returns Its turns.
 */
export function chatTurns(
  transcript: Pick<TranscriptState, 'byKey'>,
  thread: ThreadRecord,
): ChatMsg[] {
  return transcript.byKey[thread.id]?.chat ?? thread.data.chat
}

/**
 * Whether a chat offers Delete (v9.3.0): always while another chat remains,
 * and the last one only once it holds a conversation. Deleting the last chat
 * starts it over as an empty one, so an empty last chat has nothing to
 * delete (Patrick).
 *
 * @param transcript The transcript slice.
 * @param record The exploration.
 * @param thread The chat.
 * @returns True when its Delete should show.
 */
export function chatDeletable(
  transcript: Pick<TranscriptState, 'byKey'>,
  record: Pick<ExplorationRecord, 'threads'>,
  thread: ThreadRecord,
): boolean {
  return record.threads.filter(isChat).length > 1 || chatTurns(transcript, thread).length > 0
}

/** A chat another chat can reference. */
export interface ChatEntry {
  key: string
  thread: ThreadRecord
  label: string
}

/**
 * Every chat in an exploration, in thread order. Titles are unique in an
 * exploration (`uniqueTitle`), so a chat's title is its label.
 *
 * @param record The exploration.
 * @returns The chats.
 */
export function explorationChats(record: ExplorationRecord): ChatEntry[] {
  return record.threads
    .filter(isChat)
    .map((thread) => ({ key: thread.id, thread, label: thread.title }))
}

/**
 * Whether a message mentions a chat.
 *
 * @param message The message as typed.
 * @param chat The chat.
 * @returns True when the message carries its `@thread[…]` mention.
 */
export function mentionsChat(message: string, chat: ChatEntry): boolean {
  return message.includes(`@thread[${chat.label}]`)
}

/** A tag naming one paper's view, the only kind a transcript shows. */
export type PaperTag = TurnTag & { tool: TurnTool }

/**
 * Where a question reads as asked: its tag, except that a bridge question
 * reads as General (Patrick, 2026-10-30). It was its own place, its tag the
 * papers' titles each linked, but no view holds a bridge question, and the
 * papers it is about are in its answer already, cited `[n]` like any
 * search's. The tag itself is kept: it is what asks the question again
 * across those papers (`askAt`).
 *
 * @param tag The tag; absent means General.
 * @returns The place to show, or undefined for General.
 */
export function shownPlace(tag: TurnTag | undefined): PaperTag | undefined {
  return tag && tag.tool !== 'across' ? { ...tag, tool: tag.tool } : undefined
}

/**
 * A tag's label: `General`, or the paper and the tool it was asked from,
 * e.g. `Attention Is All You Need › Reader`. A bridge question reads as
 * General (`shownPlace`). A paper's title is read off its thread, so a
 * rename follows; a paper deleted since keeps the title the tag was stamped
 * with.
 *
 * @param record The exploration, for the paper's current title.
 * @param tag The tag; absent means General.
 * @returns The label.
 */
export function tagLabel(
  record: Pick<ExplorationRecord, 'threads'> | undefined,
  tag?: TurnTag,
): string {
  const place = shownPlace(tag)
  if (!place) return 'General'
  const title = record?.threads.find((thread) => thread.id === place.threadId)?.title ?? place.title
  return `${title}${LABEL_SEPARATOR}${TURN_TOOL_NAMES[place.tool]}`
}

/**
 * The papers a tag names: a bridge question's, or the one paper.
 *
 * @param tag The tag.
 * @returns Its papers, as stamped.
 */
export function tagPapers(tag: TurnTag): TagPaper[] {
  return tag.tool === 'across' && tag.papers?.length
    ? tag.papers
    : [{ threadId: tag.threadId, title: tag.title }]
}

/**
 * The tag for a question about several papers at once (v9.0.0, stage 4c).
 *
 * @param threads The paper threads, in the order the question named them.
 * @returns The tag, the first paper heading it.
 */
export function acrossTag(threads: Pick<ThreadRecord, 'id' | 'title'>[]): TurnTag {
  const papers = threads.map((thread) => ({ threadId: thread.id, title: thread.title }))
  return { ...papers[0], tool: 'across', papers }
}

/**
 * The tag for a question asked beside a paper's tool.
 *
 * @param thread The paper thread on screen.
 * @param tool The tool it was asked from.
 * @returns The tag.
 */
export function paperTag(thread: Pick<ThreadRecord, 'id' | 'title'>, tool: TurnTool): TurnTag {
  return { threadId: thread.id, title: thread.title, tool }
}
