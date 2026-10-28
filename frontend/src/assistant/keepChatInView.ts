/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Keep the chat in view when it takes the reader to a paper (v9.0.0, the
 * OnePager's "One assistant"). Full screen, the chat is the page; a tag, an
 * answer's link, a placed lecture or a paper opened from it moves to a
 * paper's view, where the assistant docks, and it is closed by default
 * (Patrick, 2026-10-09). Followed from the chat, it opens, so the
 * conversation that led there stays on screen (Patrick, 2026-10-27). The
 * rail's own navigation leaves it as it was.
 *
 * A window event rather than store state, as `teacher/composerDraft` hands
 * the composer a draft: the dock's open state is the shell's, and this is a
 * one-off request, not something to keep.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** The event the shell listens for to open the dock. */
export const KEEP_CHAT_EVENT = 'ca:keep-chat-in-view'

/** Ask the shell to open the dock, so the chat stays in view. */
export function keepChatInView(): void {
  window.dispatchEvent(new Event(KEEP_CHAT_EVENT))
}
