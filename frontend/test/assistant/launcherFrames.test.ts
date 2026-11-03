/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The launcher astronaut's frame order (v9.9.0): turn in, bob while hovered,
 * finish the drop and turn back once let go, and never jump a frame on a
 * change of mind.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { expect, it } from 'vitest'
import { REST, framePosition, nextFrame } from '../../src/assistant/launcherFrames'

/**
 * Step from a frame for a while, hovered or not.
 *
 * @param from The frame to start on.
 * @param hovered Whether the pointer is over him.
 * @param steps How many steps to take, at most.
 * @returns Every frame shown after the first, stopping where he comes to rest.
 */
function run(from: number, hovered: boolean, steps: number): number[] {
  const shown: number[] = []
  let frame = from
  for (let step = 0; step < steps; step++) {
    const next = nextFrame(frame, hovered)
    if (next === null) break
    shown.push(next)
    frame = next
  }
  return shown
}

it('turns in, then bobs round and round while hovered', () => {
  const shown = run(REST, true, 80)
  expect(shown.slice(0, 13)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  // The bob's last frame loops to its first, and it never turns back.
  expect(shown[shown.indexOf(58) + 1]).toBe(13)
  expect(Math.max(...shown)).toBe(58)
})

it('unwinds a turn let go of half way', () => {
  expect(run(7, false, 20)).toEqual([6, 5, 4, 3, 2, 1, REST])
})

it('finishes the drop, turns back and stops at rest once let go', () => {
  const shown = run(20, false, 80)
  expect(shown[0]).toBe(21)
  expect(shown.at(-2)).toBe(71)
  expect(shown.at(-1)).toBe(REST)
  expect(nextFrame(REST, false)).toBeNull()
})

it('runs a turn back hovered again in reverse, into the bob', () => {
  expect(run(62, true, 6)).toEqual([61, 60, 59, 58, 13, 14])
})

it('places frames on the 8 × 9 sheet', () => {
  expect(framePosition(0)).toBe('0% 0%')
  expect(framePosition(7)).toBe('100% 0%')
  expect(framePosition(8)).toBe('0% 12.5%')
  expect(framePosition(71)).toBe('100% 100%')
})
