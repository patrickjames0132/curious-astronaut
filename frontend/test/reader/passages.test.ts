// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The passages an answer is about (v8.45.0): read out of the answer and its
 * question, found in rendered text however its spacing, case, punctuation or
 * ligatures differ, found by their ends when the middle slips, and lit as
 * boxes a line at a time.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, expect, it, vi } from 'vitest'
import {
  answerQuotes,
  boxesOf,
  comparable,
  findPassage,
  findQuote,
  indexText,
  joinLines,
  passageParts,
  questionPassage,
} from '../../src/reader/passages'

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

/** A rendered paragraph, from HTML. */
function rendered(html: string): HTMLElement {
  const element = document.createElement('div')
  element.innerHTML = html
  document.body.append(element)
  return element
}

it('reads an answer’s quotes and a question’s passage', () => {
  expect(answerQuotes('As it says, ⟦the dot products grow large⟧ and ⟦we scale them⟧.')).toEqual([
    'the dot products grow large',
    'we scale them',
  ])
  expect(answerQuotes('No quotes here.')).toEqual([])
  expect(
    questionPassage(
      'Explain this passage from section 3.2, Attention:\n\n“We scale the dot products.”',
    ),
  ).toBe('We scale the dot products.')
  expect(
    questionPassage('About this passage from page 4:\n\n“Two lines\nof it”\n\nWhy is that?'),
  ).toBe('Two lines\nof it')
  expect(questionPassage('What is softmax?')).toBeNull()
})

it('compares letters and digits only, ligatures spelled out', () => {
  expect(comparable('The “ﬁrst” step—in 3 parts.')).toBe('thefirststepin3parts')
})

it('finds a quote across elements, spacing and case, but not in KaTeX’s hidden copy', () => {
  const root = rendered(
    'We call it <em>Scaled  Dot-Product</em> Attention.<span class="katex-mathml">Attention</span> The end.',
  )
  // One range per text node, each just the words matched in it.
  const ranges = findQuote(indexText(root), 'we call it scaled dot-product attention')
  expect(ranges.map(String)).toEqual(['We call it', 'Scaled  Dot-Product', 'Attention'])
})

it('finds a quote by its ends when its middle slips', () => {
  const root = rendered(
    '<p>The encoder maps an input sequence of symbol representations to a sequence of continuous representations z.</p>',
  )
  // A PDF's hyphenated break ("repre- sentations") in the middle.
  const ranges = findQuote(
    indexText(root),
    'The encoder maps an input sequence of symbol repre- sentations to a sequence of continuous representations',
  )
  expect(ranges.map(String)).toEqual([
    'The encoder maps an input sequence of symbol representations to a sequence of continuous representations',
  ])
  expect(
    findQuote(indexText(root), 'Nothing like this is in the paper at all, not even close'),
  ).toEqual([])
})

it('joins glyph boxes a line at a time: an equation lights as one box', () => {
  const joined = joinLines([
    // An equation's glyphs: a tall fraction among short symbols, close together.
    { left: 100, top: 210, right: 120, bottom: 226 },
    { left: 124, top: 200, right: 140, bottom: 236 },
    { left: 144, top: 212, right: 200, bottom: 226 },
    // The next line of prose, below it.
    { left: 100, top: 250, right: 300, bottom: 266 },
    // Nothing to see.
    { left: 0, top: 0, right: 0, bottom: 0 },
  ])
  expect(joined).toEqual([
    { left: 100, top: 200, right: 200, bottom: 236 },
    { left: 100, top: 250, right: 300, bottom: 266 },
  ])
})

it('measures ranges as boxes in the element they light, where it can', () => {
  const root = rendered('<p>Lit words here.</p>')
  const ranges = findQuote(indexText(root), 'Lit words')
  // jsdom measures no range: nothing to light, nothing thrown.
  expect(boxesOf(ranges, root)).toEqual([])
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 500, 500))
  Range.prototype.getClientRects = function () {
    return [new DOMRect(40, 60, 70, 16)] as unknown as DOMRectList
  }
  expect(boxesOf(ranges, root)).toEqual([{ left: 30, top: 40, width: 70, height: 16 }])
  // @ts-expect-error -- jsdom's Range has none; this test gave it one.
  delete Range.prototype.getClientRects
})

it('splits a passage into its prose and its formulas’ LaTeX', () => {
  // As `selection/formulas.ts` writes them: part of one, and one whole.
  expect(passageParts('∇ϕ log πϕ (part of $$\\hat\\nabla J = \\nabla \\log \\pi$$)')).toEqual({
    prose: ['∇ϕ log πϕ'],
    formulas: ['\\hat\\nabla J = \\nabla \\log \\pi'],
  })
  expect(passageParts('We approximate it with $J(\\phi)$ and sample.')).toEqual({
    prose: ['We approximate it with', 'and sample.'],
    formulas: ['J(\\phi)'],
  })
  expect(passageParts('Plain words.')).toEqual({ prose: ['Plain words.'], formulas: [] })
})

it('finds a formula by the LaTeX KaTeX keeps beside it, and lights it whole', () => {
  // Patrick highlighted part of an equation; its glyphs never match the page,
  // so only the sentence above it lit.
  const root = rendered(
    '<p>We can approximate the gradient with</p>' +
      '<span class="katex"><span class="katex-mathml"><math><annotation encoding="application/x-tex">' +
      '\\hat\\nabla_\\phi J_\\pi(\\phi) = \\nabla_\\phi \\log \\pi_\\phi</annotation></math></span>' +
      '<span class="katex-html">∇̂ϕJπ(ϕ)=∇ϕlogπϕ</span></span>',
  )
  const passage =
    'part (part of $$\\hat\\nabla_\\phi J_\\pi(\\phi)  =  \\nabla_\\phi \\log \\pi_\\phi$$)'
  const ranges = findPassage(root, indexText(root), passage)
  expect(ranges.map((range) => range.toString())).toEqual(['∇̂ϕJπ(ϕ)=∇ϕlogπϕ'])
})

it('lights only the words matched, never what lies between them in the DOM', () => {
  // A PDF's text layer is in the order the PDF was written: an equation's
  // bracket and minus spans sat between a sentence's words, and one range
  // from start to end lit them as ragged bars (Patrick).
  const root = rendered(
    '<span>minimize the squared</span><span>[</span><span>(</span><span>−</span><span> residual error</span>',
  )
  const ranges = findQuote(indexText(root), 'the squared residual error')
  expect(ranges.map(String)).toEqual(['the squared', 'residual error'])
})
