/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Every scroll the Reader makes itself (v8.48.1): to a heading, a
 * reference, a figure or equation number, a lit passage, a place in the PDF.
 *
 * A smooth scroll fixes its destination when it starts. Whatever grows
 * above the target while it glides (a figure loading, a Knowledge Graph
 * note arriving) pushes the target down after the destination was fixed,
 * and the glide lands short: by 1,000px past Attention's figures (Patrick:
 * "the scrolling often stops short"). So a glide measures its target again
 * once it settles, and goes the rest of the way if it moved, a few times at
 * most; and the moment the reader scrolls themselves, it lets go.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** Pixels a landing may be off and still count as there. */
const CLOSE_ENOUGH = 3
/** Times a glide goes again after its target moved. */
const CORRECTIONS = 3
/** Frames the pane must hold still to count as settled. */
const SETTLED_FRAMES = 4
/** Frames to wait for a glide to settle before measuring anyway (~3s). */
const MAX_FRAMES = 180

/** The glide in progress in each pane, so a new one replaces it. */
const gliding = new WeakMap<HTMLElement, () => void>()

/**
 * Scroll a pane to a target, and keep to it as the page settles.
 *
 * @param pane The scrolling pane.
 * @param where The pane's `scrollTop` that puts the target in place,
 *        measured afresh each time it's asked; null when the target is gone.
 * @returns Lets the glide go.
 */
export function glide(pane: HTMLElement, where: () => number | null): () => void {
  gliding.get(pane)?.()
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  let frame = 0
  let corrections = 0
  let stopped = false
  const stop = () => {
    stopped = true
    cancelAnimationFrame(frame)
    for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const)
      pane.removeEventListener(type, stop)
    if (gliding.get(pane) === stop) gliding.delete(pane)
  }
  // The reader taking over: their scroll wins.
  for (const type of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const)
    pane.addEventListener(type, stop, { passive: true })
  gliding.set(pane, stop)

  const go = (smooth: boolean) => {
    const top = where()
    if (top === null) return stop()
    pane.scrollTo({ top, behavior: smooth && !still ? 'smooth' : 'auto' })
    let last = pane.scrollTop
    let held = 0
    let frames = 0
    const settle = () => {
      if (stopped) return
      frames++
      held = pane.scrollTop === last ? held + 1 : 0
      last = pane.scrollTop
      if (held < SETTLED_FRAMES && frames < MAX_FRAMES) {
        frame = requestAnimationFrame(settle)
        return
      }
      const wanted = where()
      const reachable = Math.max(0, pane.scrollHeight - pane.clientHeight)
      const target = wanted === null ? null : Math.min(Math.max(0, wanted), reachable)
      if (
        target !== null &&
        Math.abs(target - pane.scrollTop) > CLOSE_ENOUGH &&
        corrections < CORRECTIONS
      ) {
        corrections++
        go(true)
      } else stop()
    }
    frame = requestAnimationFrame(settle)
  }
  go(true)
  return stop
}
