/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The tags a chat's questions wear (v9.0.0): where each was asked, `General`
 * or a paper and its tool, as a link back there (`store/chats`). Shared by
 * every panel that shows a chat: the Citation Graph's, full screen or
 * docked (`teacher/Teacher`), and the other docks (`DockedAssistant`).
 *
 * **Shown once a chat crosses views.** A chat whose questions were all asked
 * with no view open is General throughout, and a `General` on every bubble
 * would say nothing; the first question asked beside a paper is what makes
 * the tags worth reading, and from then on every question wears one.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback } from 'react'
import type { ChatMsg } from '../api'
import { useAppDispatch, useAppSelector } from '../store'
import { tagLabel } from '../store/chats'
import { openTag } from '../store/workspace'

/** What a question's bubble shows of its tag (`ChatMessage`'s props). */
export interface TurnTagProps {
  tagLabel?: string
  onTagOpen?: () => void
}

/**
 * The tag props for each turn of a chat.
 *
 * @param chatKey The chat's key: where a General tag leads.
 * @param chat The chat's turns.
 * @returns For a turn, its tag's label and where a click goes; nothing for an
 *   answer, or while the chat hasn't crossed views.
 */
export function useTurnTags(chatKey: string, chat: ChatMsg[]): (message: ChatMsg) => TurnTagProps {
  const dispatch = useAppDispatch()
  const record = useAppSelector((state) => state.explorations.byId[state.explorations.activeId])
  const crosses = chat.some((message) => !!message.tag)
  return useCallback(
    (message: ChatMsg) => {
      if (message.role !== 'user' || !crosses) return {}
      const { tag } = message
      // A paper deleted since keeps its label but goes nowhere.
      const gone = !!tag && !record?.threads.some((thread) => thread.id === tag.threadId)
      return {
        tagLabel: tagLabel(record, tag),
        onTagOpen: gone ? undefined : () => void dispatch(openTag({ tag, chatId: chatKey })),
      }
    },
    [chatKey, crosses, dispatch, record],
  )
}
