/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What the tools are still working on after the reader has left them, for
 * the card home's spinners (Patrick, 2026-11-06). A tool's work outlives its
 * surface (a Knowledge Graph lesson keeps streaming, Criticisms keeps
 * gathering) but its component state doesn't, so the work registers here by
 * key, `<tool>:<subject>:…`, and the cards ask whether anything under their
 * prefix is in flight. Counted, so two overlapping requests under one key
 * (a "Try again" while the first is still out) keep it busy until both end.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useSyncExternalStore } from 'react'

/** Work in flight, by key, with how many requests hold it. */
const BUSY = new Map<string, number>()
/** Who to tell when it changes. */
const LISTENERS = new Set<() => void>()

/** Tell every subscriber something started or ended. */
function changed() {
  for (const listener of LISTENERS) listener()
}

/**
 * Mark work under a key as started.
 *
 * @param key The work, `<tool>:<subject>:…`.
 * @returns Its release: call it once when the work ends (later calls do nothing).
 */
export function markBusy(key: string): () => void {
  BUSY.set(key, (BUSY.get(key) ?? 0) + 1)
  changed()
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (BUSY.get(key) ?? 1) - 1
    if (count > 0) BUSY.set(key, count)
    else BUSY.delete(key)
    changed()
  }
}

/**
 * Hold a key busy while a promise is out.
 *
 * @param key The work.
 * @param work The request.
 * @returns The same request.
 */
export function trackBusy<Result>(key: string, work: Promise<Result>): Promise<Result> {
  const release = markBusy(key)
  work.then(release, release)
  return work
}

/**
 * Whether anything under a prefix is in flight.
 *
 * @param prefix A key's start, e.g. `knowledge:<thread id>:`.
 * @returns True while any such key is held.
 */
export function isBusy(prefix: string): boolean {
  for (const key of BUSY.keys()) if (key.startsWith(prefix)) return true
  return false
}

/**
 * Subscribe to the registry.
 *
 * @param listener Called on every change.
 * @returns The unsubscribe.
 */
function subscribe(listener: () => void) {
  LISTENERS.add(listener)
  return () => {
    LISTENERS.delete(listener)
  }
}

/**
 * Whether anything under a prefix is in flight, re-rendering as that changes.
 *
 * @param prefix A key's start, or null for "nothing to ask about".
 * @returns True while any such key is held.
 */
export function useBusy(prefix: string | null): boolean {
  const snapshot = useCallback(() => (prefix ? isBusy(prefix) : false), [prefix])
  return useSyncExternalStore(subscribe, snapshot)
}

/** Forget everything in flight (the tests' isolation). */
export function forgetBusy() {
  BUSY.clear()
  changed()
}
