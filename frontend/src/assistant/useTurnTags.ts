/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The tags a chat's questions wear (v9.0.0): where each was asked, `General`
 * or a paper and its tool, as a link back there (`store/chats`), on the one
 * assistant's turns (`teacher/Teacher`), full screen or docked. A bridge
 * question, about several papers at once, wears General (`shownPlace`): the
 * papers it is about are cited in its answer.
 *
 * **Shown once a chat crosses views.** A chat whose questions were all asked
 * with no view open is General throughout, and a `General` on every bubble
 * would say nothing; the first question asked beside a paper is what makes
 * the tags worth reading, and from then on every question wears one.
 *
 * **A tag clicked keeps its place** (Patrick). Going there opens another
 * view, which remounts the panel (it is keyed on the workspace epoch), and a
 * fresh panel follows the bottom of its chat; so the click leaves the
 * question it was on as an anchor (`takeTurnAnchor`), which the panel
 * scrolls back into view instead.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback } from 'react'
import type { ChatMsg } from '../api'
import { useAppDispatch, useAppSelector } from '../store'
import { shownPlace, tagLabel } from '../store/chats'
import { openTag } from '../store/workspace'

/** The question whose tag was just clicked, for the panel to keep in view. */
let anchor: { chatKey: string; index: number; at: number } | null = null
/** How long an anchor waits for the panel, ms: a tag that goes nowhere new
 *  remounts nothing, and a stale anchor must not move the chat later. */
const ANCHOR_LIFE = 3000

/**
 * Leave a turn to keep in view when the panel next shows its chat: a tag, or
 * an answer's link to another view (v9.0.0), clicked just before going there.
 *
 * @param chatKey The chat.
 * @param index The turn's index in it.
 */
export function anchorTurn(chatKey: string, index: number): void {
  anchor = { chatKey, index, at: Date.now() }
}

/**
 * Take the question a tag click left to keep in view, once.
 *
 * @param chatKey The chat on screen; an anchor in another is left alone.
 * @returns Its index in the chat, or null when there is none.
 */
export function takeTurnAnchor(chatKey: string): number | null {
  if (!anchor || anchor.chatKey !== chatKey) return null
  const { index, at } = anchor
  anchor = null
  return Date.now() - at < ANCHOR_LIFE ? index : null
}

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
 * @param onLeave Told before a tag is followed away (the full-screen chat
 *   keeps itself in view, `keepChatInView`).
 * @returns For a turn and its index, its tag's label and where a click goes;
 *   nothing for an answer, or while the chat hasn't crossed views.
 */
export function useTurnTags(
  chatKey: string,
  chat: ChatMsg[],
  onLeave?: () => void,
): (message: ChatMsg, index: number) => TurnTagProps {
  const dispatch = useAppDispatch()
  const record = useAppSelector((state) => state.explorations.byId[state.explorations.activeId])
  // A chat of General and bridge questions alone reads as General throughout.
  const crosses = chat.some((message) => !!shownPlace(message.tag))
  return useCallback(
    (message: ChatMsg, index: number) => {
      if (message.role !== 'user' || !crosses) return {}
      const tag = shownPlace(message.tag)
      const go = (target: typeof tag) => () => {
        onLeave?.()
        anchorTurn(chatKey, index)
        void dispatch(openTag({ tag: target, chatId: chatKey }))
      }
      // A paper deleted since keeps its label but goes nowhere.
      const live = (threadId: string) => !!record?.threads.some((thread) => thread.id === threadId)
      return {
        tagLabel: tagLabel(record, tag),
        onTagOpen: tag && !live(tag.threadId) ? undefined : go(tag),
      }
    },
    [chatKey, crosses, dispatch, record, onLeave],
  )
}
