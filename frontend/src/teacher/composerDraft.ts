/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A draft handed to the General chat's composer from elsewhere (v8.31.0): the
 * rail's Papers ＋ opens a chat with `@` already typed, so the way to find a
 * paper is where a reader looks for it. The composer remounts on every
 * thread switch, so the draft waits here until it mounts and takes it; one
 * already on screen hears the event instead. Taken once, then gone.
 *
 * **A draft is addressed to its chat** (v8.32.1). The ＋ hands it over before
 * the switch, so the composer still on screen, a General chat's too, hears
 * the event first; unaddressed, that one took the `@` and was remounted away
 * with it, and the first new chat opened empty. Only the composer of the chat
 * named takes it now.
 *
 * Only the draft lives here, never the result: whatever the reader does with
 * the `@` (deleting it included) is an ordinary chat in the Chats group.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** The event a mounted composer listens for. */
export const DRAFT_EVENT = 'ca:composer-draft'

let pending: { text: string; chatKey: string } | null = null

/**
 * Hand the General chat's composer a draft.
 *
 * @param text What to put in the bar.
 * @param chatKey The chat it is for: only that chat's composer takes it.
 */
export function requestDraft(text: string, chatKey: string): void {
  pending = { text, chatKey }
  window.dispatchEvent(new Event(DRAFT_EVENT))
}

/**
 * Whether a draft is waiting for this chat, without taking it: the composer
 * asks on its first render, to arrive without its entrance (`Teacher.tsx`).
 *
 * @param chatKey The chat asking.
 * @returns True when a draft for it is waiting.
 */
export function draftWaiting(chatKey: string): boolean {
  return pending?.chatKey === chatKey
}

/**
 * Take the waiting draft, if it is for this chat; it is gone afterwards.
 *
 * @param chatKey The chat asking.
 * @returns The draft, or null when there is none or it is for another chat.
 */
export function takeDraft(chatKey: string): string | null {
  if (pending?.chatKey !== chatKey) return null
  const { text } = pending
  pending = null
  return text
}
