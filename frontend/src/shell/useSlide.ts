/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Slide a list's rows to their new places when its order changes.
 *
 * The rail lists explorations newest-worked-on first, so a question asked in
 * one lifts it to the top. Re-rendering in the new order makes the row (and
 * every row it passes) jump; this plays the move instead. It is the FLIP
 * trick: each row's offset is remembered after every render, and when the
 * order changes, a row that landed somewhere new is drawn back where it was
 * and animated to rest — the DOM is already final, only the transform moves.
 *
 * Offsets are `offsetTop`, not `getBoundingClientRect`, so a row caught
 * mid-slide by a second reorder measures where it sits, not where its
 * transform has it drawn — and the list's own scroll doesn't matter. Only a
 * change of **order** slides: a thread list opening below a row moves the
 * rows under it too, and that is the rail's to show, not a reorder.
 * Reduced motion, or no animation engine (jsdom), simply skips the slide.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** The slide's length, long enough to follow the row with the eye. */
const SLIDE_MS = 360

/**
 * Whether a slide can play here.
 *
 * @returns False under reduced motion, or with no Web Animations API.
 */
function slidesCanPlay(): boolean {
  if (typeof Element.prototype.animate !== 'function') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Animate the rows of `list` (its `[data-slide]` elements, keyed by that
 * attribute) from their old places to their new ones when `order` changes.
 *
 * @param list The element holding the rows.
 * @param order The rows' keys in display order.
 */
export function useSlide(list: RefObject<HTMLElement | null>, order: string[]): void {
  const offsets = useRef(new Map<string, number>())
  const lastOrder = useRef(order.join('\n'))
  const key = order.join('\n')
  useLayoutEffect(() => {
    const rows = list.current?.querySelectorAll<HTMLElement>('[data-slide]') ?? []
    const reordered = key !== lastOrder.current
    lastOrder.current = key
    const next = new Map<string, number>()
    for (const row of rows) {
      const id = row.dataset.slide!
      const offset = row.offsetTop
      next.set(id, offset)
      const before = offsets.current.get(id)
      if (!reordered || before === undefined || before === offset || !slidesCanPlay()) continue
      row.animate(
        [{ transform: `translateY(${before - offset}px)` }, { transform: 'translateY(0)' }],
        { duration: SLIDE_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      )
    }
    offsets.current = next
  })
}
