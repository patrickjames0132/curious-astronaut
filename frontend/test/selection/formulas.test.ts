// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: What a selection over typeset math says (v8.38.0) — a whole formula as its LaTeX,
 * part of one as its glyphs with the whole formula for context, never KaTeX's doubled text.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import katex from 'katex'
import { afterEach, expect, it } from 'vitest'
import { selectionText } from '../../src/selection/formulas'

afterEach(() => {
  document.body.innerHTML = ''
})

/** A paragraph with a typeset formula between two runs of text.
 * @returns The paragraph.
 */
function paragraph(): HTMLParagraphElement {
  const element = document.createElement('p')
  element.innerHTML = `We scale by ${katex.renderToString('\\sqrt{d_k}+b')} to keep it stable.`
  document.body.append(element)
  return element
}

/** The visible glyphs of the paragraph's formula, as text nodes in order.
 * @param element The paragraph.
 * @returns The text nodes.
 */
function glyphs(element: HTMLElement): Text[] {
  const walker = document.createTreeWalker(
    element.querySelector('.katex-html')!,
    NodeFilter.SHOW_TEXT,
  )
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  return nodes
}

/** A range between two points.
 * @param startNode Where it starts.
 * @param startOffset Its offset there.
 * @param endNode Where it ends.
 * @param endOffset Its offset there.
 * @returns The range.
 */
function between(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

it('reads a range across a formula as the words around its LaTeX', () => {
  const range = document.createRange()
  range.selectNodeContents(paragraph())
  expect(selectionText(range)).toBe('We scale by $\\sqrt{d_k}+b$ to keep it stable.')
})

it('reads a formula selected glyph to glyph as its LaTeX', () => {
  const nodes = glyphs(paragraph())
  const last = nodes.at(-1)!
  expect(selectionText(between(nodes[0], 0, last, last.length))).toBe('$\\sqrt{d_k}+b$')
})

it('reads part of a formula as its glyphs, with the whole formula for context', () => {
  const nodes = glyphs(paragraph())
  const plus = nodes.find((node) => node.textContent === '+')!
  const last = nodes.at(-1)!
  expect(selectionText(between(plus, 0, last, last.length))).toBe('+b (part of $\\sqrt{d_k}+b$)')
})

it('reads a range ending partway into a formula the same way', () => {
  const element = paragraph()
  const nodes = glyphs(element)
  const plus = nodes.find((node) => node.textContent === '+')!
  expect(selectionText(between(element.firstChild!, 3, plus, 0))).toMatch(
    /^scale by .+ \(part of \$\\sqrt\{d_k\}\+b\$\)$/,
  )
})

it('keeps a displayed formula displayed, however the range around it starts', () => {
  const element = document.createElement('div')
  element.innerHTML = `<p>Then</p>${katex.renderToString('E=mc^2', { displayMode: true })}<p>holds.</p>`
  document.body.append(element)
  const formula = element.querySelector('.katex')!
  // Starting at the formula itself: the copy has no `.katex-display` around it.
  const range = document.createRange()
  range.setStartBefore(formula)
  range.setEnd(element.lastChild!.firstChild!, 6)
  expect(selectionText(range)).toBe('$$E=mc^2$$ holds.')
})
