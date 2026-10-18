/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Convert the durable transcript into completed model history.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import type { ChatMsg, HistoryTurn, ThreadContext } from '../api'
import { courseOutline } from '../knowledge/assistant/context'
import { isCurrentMap } from '../knowledge/model'
import type { RootState } from '../store'
import {
  chatSummary,
  chatTurns,
  explorationChats,
  mentionsChat,
  type ChatEntry,
} from '../store/chats'

/** Render one completed turn, including lecture prose.
 * @param message The saved or live transcript turn.
 * @returns Model history, or null for incomplete or empty turns.
 */
export function toHistoryTurn(message: ChatMsg): HistoryTurn | null {
  if (message.failed || message.unfinished) return null
  const content = (
    message.beats?.length
      ? message.beats.map((beat) => `${beat.heading}\n${beat.text}`).join('\n\n')
      : message.text
  )
    .replace(/[ \t]*<<FIG \d+>>\n?/g, '')
    .trim()
  return content ? { role: message.role, content } : null
}

/** Keep completed exchanges together so an abandoned question cannot leak in.
 * @param chat The thread transcript before the new request.
 * @returns Completed conversational history.
 */
export function conversationHistory(chat: ChatMsg[]): HistoryTurn[] {
  const history: HistoryTurn[] = []
  let question: HistoryTurn | null = null
  for (const message of chat) {
    const turn = toHistoryTurn(message)
    if (message.role === 'user') {
      question = turn
      continue
    }
    if (turn) {
      if (question) history.push(question)
      history.push(turn)
    }
    question = null
  }
  return history
}

/**
 * The other chats in the active exploration a message can reference: every
 * chat but the one asking (`store/chats`), so the Knowledge Graph's
 * assistant can read the Citation Graph's chat in its own thread, and the
 * other way round (v8.25.0).
 *
 * @param state Current store.
 * @param currentKey The asking chat's key.
 * @returns The chats, in thread order.
 */
export function otherChats(state: RootState, currentKey: string): ChatEntry[] {
  const record = state.explorations.byId[state.explorations.activeId]
  if (!record) return []
  return explorationChats(record, state.transcript).filter((chat) => chat.key !== currentKey)
}

/** Build a sibling index and attach only explicitly mentioned discussions.
 * One entry per chat since v8.25.0, not per thread: a paper thread's
 * Citation Graph and Knowledge Graph each have their own, and a mentioned
 * Knowledge Graph chat brings its course's outline.
 * @param state Current store, read before starting the turn.
 * @param question User message with optional @thread references.
 * @param currentKey The asking chat's key; the active thread's own by default.
 * @returns Labelled sibling context for the request.
 */
export function siblingContext(
  state: RootState,
  question: string,
  currentKey: string = state.explorations.byId[state.explorations.activeId]?.activeThreadId ?? '',
): ThreadContext[] {
  return otherChats(state, currentKey)
    .map((chat) => {
      const mentioned = mentionsChat(question, chat)
      const course =
        mentioned && chat.tool === 'knowledge' && isCurrentMap(chat.thread.knowledge)
          ? courseOutline(chat.thread.knowledge)
          : undefined
      return {
        title: chat.label,
        summary: chatSummary(chat.thread, chat.tool).summary ?? 'No summary available yet.',
        mentioned,
        history: mentioned
          ? conversationHistory(chatTurns(state.transcript, chat.thread, chat.tool)).map(
              (turn) => ({ ...turn, content: turn.content.slice(0, 12000) }),
            )
          : undefined,
        ...(course && { course }),
      }
    })
    .sort((left, right) => Number(right.mentioned) - Number(left.mentioned))
    .slice(0, 40)
}

/**
 * The chats a message mentions, for its `Context from` line.
 *
 * @param state Current store.
 * @param question The message.
 * @param currentKey The asking chat's key.
 * @returns Each one's key (what the link opens) and label.
 */
export function borrowedChats(
  state: RootState,
  question: string,
  currentKey: string,
): { id: string; title: string }[] {
  return otherChats(state, currentKey)
    .filter((chat) => mentionsChat(question, chat))
    .map((chat) => ({ id: chat.key, title: chat.label }))
}
