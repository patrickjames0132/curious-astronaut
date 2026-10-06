/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Keep a closing element on screen long enough to play its exit animation.
 *
 * React removes an element the moment its `open` flag goes false, so a
 * popover can animate in but never out. This hook splits "open" from
 * "present": when `open` drops, the element stays mounted with `closing` set,
 * its stylesheet plays an exit keyframe off that class, and the element's
 * own `animationend` unmounts it. Opening again mid-exit just clears
 * `closing`, so the entrance replays from wherever the exit had got to.
 *
 * The exit can fail to fire, and a closed popover must never linger as an
 * invisible ghost: where no exit can play — **reduced motion**, or no
 * animation engine at all (jsdom) — it unmounts at once, and a **fallback
 * timeout** unmounts anyway if the event is missed for any other reason. `animationend` bubbles, so only the element's own counts — a child's
 * fade finishing first must not cut the parent's exit short.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useState } from 'react'
import type { AnimationEvent } from 'react'

/** Longer than any exit in the app, so the fallback only ever catches misses. */
const FALLBACK_MS = 600

/** What the caller renders from: whether to mount, and whether it's leaving. */
export interface Presence {
  /** Mount the element (open, or still playing its exit). */
  present: boolean
  /** The exit is playing — add the stylesheet's closing class. */
  closing: boolean
  /** Wire to the element's `onAnimationEnd`. */
  onAnimationEnd: (event: AnimationEvent) => void
}

/**
 * Whether an exit animation can actually play here. Not when the reader asked
 * for reduced motion (the stylesheets set `animation: none`), and not where
 * there's no animation engine at all — jsdom, which has no Web Animations
 * API and never fires `animationend`. Either way there is nothing to wait
 * for, so the element unmounts at once, exactly as before this hook.
 *
 * @returns True when exits should be skipped.
 */
function exitsCannotPlay(): boolean {
  if (typeof window === 'undefined') return true
  if (typeof Element.prototype.getAnimations !== 'function') return true
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Track an element's presence across its exit animation.
 *
 * @param open Whether the element should be showing.
 * @returns The presence to render from.
 */
export function usePresence(open: boolean): Presence {
  const [present, setPresent] = useState(open)
  const [closing, setClosing] = useState(false)

  // Adjusting state during render is React's sanctioned way to react to a
  // prop change without a flash: an `open` that turns true mounts on this
  // very render, rather than one frame late from an effect.
  if (open && (!present || closing)) {
    setPresent(true)
    setClosing(false)
  }
  if (!open && present && !closing) {
    if (exitsCannotPlay()) setPresent(false)
    else setClosing(true)
  }

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => {
      setPresent(false)
      setClosing(false)
    }, FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [closing])

  const onAnimationEnd = (event: AnimationEvent) => {
    if (!closing || event.target !== event.currentTarget) return
    setPresent(false)
    setClosing(false)
  }

  return { present, closing, onAnimationEnd }
}
