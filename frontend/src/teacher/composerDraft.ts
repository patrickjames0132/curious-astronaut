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
 * Only the draft lives here, never the result: whatever the reader does with
 * the `@` (deleting it included) is an ordinary chat in the Chats group.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** The event a mounted composer listens for. */
export const DRAFT_EVENT = 'ca:composer-draft'

let pending: string | null = null

/**
 * Hand the General chat's composer a draft.
 *
 * @param text What to put in the bar.
 */
export function requestDraft(text: string): void {
  pending = text
  window.dispatchEvent(new Event(DRAFT_EVENT))
}

/**
 * Take the waiting draft, if any; it is gone afterwards.
 *
 * @returns The draft, or null.
 */
export function takeDraft(): string | null {
  const text = pending
  pending = null
  return text
}
