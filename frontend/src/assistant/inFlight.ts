/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The answer in flight in each chat, shared by both stream engines (v9.0.0):
 * the Citation Graph's (`teacher/useConversation`) and the other docks'
 * (`askAssistant`). Every view talks in the dock's chat now, so an answer
 * started beside the graph and a question asked beside the Reader land in
 * the same transcript, and a stream writes to the chat's last turn. One
 * slot per chat is what lets a new question supersede whatever that chat
 * was answering, whichever view asked it, rather than two streams writing
 * into one turn.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** A chat's slot: the controller of the answer it is streaming, if any. */
export interface InFlight {
  current: AbortController | null
}

/** Each chat's slot, by its key. */
const slots = new Map<string, InFlight>()

/**
 * A chat's slot, made on first use.
 *
 * @param key The chat's key.
 * @returns Its slot.
 */
export function inFlight(key: string): InFlight {
  let slot = slots.get(key)
  if (!slot) {
    slot = { current: null }
    slots.set(key, slot)
  }
  return slot
}

/**
 * Start an answer in a chat, superseding the one it was streaming.
 *
 * @param key The chat's key.
 * @returns The new answer's controller.
 */
export function supersede(key: string): AbortController {
  const slot = inFlight(key)
  slot.current?.abort()
  slot.current = new AbortController()
  return slot.current
}

/**
 * Let an answer go when it ends, unless a newer one has taken its place.
 *
 * @param key The chat's key.
 * @param ctrl The ending answer's controller.
 * @returns True when a newer answer had superseded it.
 */
export function release(key: string, ctrl: AbortController): boolean {
  const slot = inFlight(key)
  const superseded = slot.current !== ctrl
  if (!superseded) slot.current = null
  return superseded
}

/**
 * Stop whatever a chat is answering, keeping what it has written.
 *
 * @param key The chat's key.
 */
export function stopChat(key: string): void {
  const slot = inFlight(key)
  slot.current?.abort()
  slot.current = null
}
