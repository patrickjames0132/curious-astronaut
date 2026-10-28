/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Which criticism the Criticisms card should open at (v8.54.0): set by the
 * Reader's criticism card ("Read in Criticisms") just before switching, and
 * taken once by the Criticisms card when it has its criticisms on the page.
 * A module-level hand-off, by paper id, since it lasts one switch.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** The criticism each paper's card should open at, by paper id. */
const PENDING = new Map<string, number>()

/**
 * Open a paper's Criticisms card at one of its criticisms, next time.
 *
 * @param paperId The paper's id.
 * @param number The criticism's number, from 1.
 */
export function focusCriticism(paperId: string, number: number) {
  PENDING.set(paperId, number)
}

/**
 * The criticism a paper's card should open at, once.
 *
 * @param paperId The paper's id.
 * @returns Its number, or null; either way it's forgotten.
 */
export function takeFocus(paperId: string): number | null {
  const number = PENDING.get(paperId) ?? null
  PENDING.delete(paperId)
  return number
}
