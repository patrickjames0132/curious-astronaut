/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A question to ask on arrival (v9.0.0, the OnePager's "One assistant",
 * stage 4b). The assistant never moves the view unasked, with one
 * exception: a question the router places on another paper's Citation Graph
 * or Reader that asks to be **taught** (a lecture, a guided read). A lecture
 * lights its graph or its paper as it goes, so it has to be given where it
 * is about (Patrick, 2026-10-27: "lecture me on the references for the DQN
 * paper" was answered off-screen instead). The panel goes there, which
 * remounts it, so the question waits here and the panel that arrives asks
 * it, through the ordinary path, once the view is ready: its graph built,
 * its paper loaded.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { TurnTag } from '../api'

/** How long a question waits for its view, ms: a graph can take a while to
 *  build, but a question asked long ago must not go out unexpectedly. */
const PENDING_LIFE = 90_000

/** The question waiting for its view, if any. */
let pending: { chatKey: string; tag: TurnTag; question: string; at: number } | null = null

/**
 * Leave a question to be asked when its view is on screen.
 *
 * @param chatKey The chat it is asked in.
 * @param tag The view it is for.
 * @param question The question.
 */
export function askOnArrival(chatKey: string, tag: TurnTag, question: string): void {
  pending = { chatKey, tag, question, at: Date.now() }
}

/**
 * Take the waiting question if this is its chat and its view, once.
 *
 * @param chatKey The chat on screen.
 * @param tag The view on screen, when it is a paper's.
 * @returns The question, or null when none waits for here.
 */
export function takeArrival(chatKey: string, tag: TurnTag | undefined): string | null {
  if (!pending || !tag) return null
  if (Date.now() - pending.at > PENDING_LIFE) {
    pending = null
    return null
  }
  const here =
    pending.chatKey === chatKey &&
    pending.tag.threadId === tag.threadId &&
    pending.tag.tool === tag.tool
  if (!here) return null
  const { question } = pending
  pending = null
  return question
}
