// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader's own scrolls (v8.49.0): a glide goes the rest of the way when
 * its target moved while it glided, and lets go when the reader scrolls.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { glide } from '../../src/reader/glide'

beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] }))
afterEach(() => vi.useRealTimers())

/**
 * A pane that scrolls at once to wherever it's told, within its content.
 *
 * @returns The pane, and the scroll targets it was given.
 */
function pane(): { element: HTMLElement; asked: number[] } {
  const element = document.createElement('div')
  const asked: number[] = []
  Object.defineProperty(element, 'scrollHeight', { value: 10000 })
  Object.defineProperty(element, 'clientHeight', { value: 800 })
  element.scrollTo = ((options: ScrollToOptions) => {
    asked.push(options.top ?? 0)
    element.scrollTop = options.top ?? 0
  }) as typeof element.scrollTo
  return { element, asked }
}

it('goes the rest of the way when the target moved while it glided', () => {
  const { element, asked } = pane()
  // A figure loads above the target once the glide has begun: 1,000px later.
  let target = 2000
  glide(element, () => target)
  target = 3000
  vi.advanceTimersByTime(1000)
  expect(asked).toEqual([2000, 3000])
  expect(element.scrollTop).toBe(3000)
})

it('stays put when it landed, and lets go when the reader scrolls', () => {
  const { element, asked } = pane()
  glide(element, () => 1500)
  vi.advanceTimersByTime(1000)
  expect(asked).toEqual([1500])

  let target = 500
  glide(element, () => target)
  element.dispatchEvent(new Event('wheel'))
  target = 4000
  vi.advanceTimersByTime(1000)
  expect(asked).toEqual([1500, 500])
})

it('gives up on a target that keeps moving, and on one that is gone', () => {
  const { element, asked } = pane()
  let target = 0
  glide(element, () => (target += 100))
  vi.advanceTimersByTime(2000)
  expect(asked).toHaveLength(4) // the glide and three corrections
  glide(element, () => null)
  expect(asked).toHaveLength(4)
})
