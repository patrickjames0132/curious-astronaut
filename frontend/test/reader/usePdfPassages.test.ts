/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * When part of a passage asked in the text view has no place in the PDF
 * (v8.48.0), so the Reader says so and offers the text.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { expect, it } from 'vitest'
import { partMissing, type PdfLight } from '../../src/reader/usePdfPassages'

const PLACE = [{ page: 1, rects: [[1, 2, 3, 4]] }]

/**
 * A light for a passage.
 *
 * @param passage Its words.
 * @param labels Its labels.
 * @param places Its places in the PDF.
 * @returns The light.
 */
function light(passage: string, labels: string[] = [], places = [] as typeof PLACE): PdfLight {
  return { passage, places, labels, quotes: [] }
}

it('trusts a passage asked in the PDF itself', () => {
  expect(partMissing(light('words', ['(6)'], PLACE), false, [[]])).toBe(false)
})

it('misses a label not found, or a formula with no number to find it by', () => {
  expect(partMissing(light('Figure 9. A plot.', ['Figure 9']), true, [[]])).toBe(true)
  expect(partMissing(light('Words and $$x^2$$'), true, [])).toBe(true)
  expect(partMissing(light('Words and $$x^2$$', ['(6)']), true, [PLACE])).toBe(false)
})

it('misses words found nowhere, unless a label lit the passage', () => {
  expect(partMissing(light('words nowhere'), false, [])).toBe(true)
  expect(partMissing(light('words nowhere', ['Figure 1']), false, [PLACE])).toBe(false)
  expect(partMissing(light('words here'), true, [])).toBe(false)
})
