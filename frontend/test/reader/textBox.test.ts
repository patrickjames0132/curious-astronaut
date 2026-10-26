// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A box over the text view (v8.48.0): the whole blocks it touches, the
 * outermost only, never the notes laid over the text.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, expect, it } from 'vitest'
import {
  boxedElements,
  labelElements,
  labelOf,
  labelsInPassage,
  labelsInRange,
  labelsOf,
  readBox,
} from '../../src/reader/textBox'

afterEach(() => document.body.replaceChildren())

/**
 * An article whose blocks sit where a test says.
 *
 * @param html Its contents; each block carries `data-box="left top width height"`.
 * @returns The article.
 */
function laidOut(html: string): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = html
  article.getBoundingClientRect = () => new DOMRect(0, 0, 800, 2000)
  for (const element of Array.from(article.querySelectorAll<HTMLElement>('[data-box]'))) {
    const [left, top, width, height] = (element.dataset.box ?? '').split(' ').map(Number)
    element.getBoundingClientRect = () => new DOMRect(left, top, width, height)
  }
  document.body.append(article)
  return article
}

it('takes the blocks a box touches, the outer one of a figure and its caption', () => {
  const article = laidOut(
    '<p data-box="0 0 600 40">Above.</p>' +
      '<figure class="reader-figure" data-box="0 100 600 200">' +
      '<img src="/api/figure_proxy?src=a" /><p data-box="0 260 600 30">Figure 2. A plot.</p>' +
      '</figure>' +
      '<aside class="reader-concepts"><p data-box="0 120 100 20">Builds on</p></aside>' +
      '<p data-box="0 400 600 40">Below.</p>',
  )
  const taken = boxedElements(article, [10, 150, 300, 250])
  expect(taken.map((element) => element.tagName)).toEqual(['FIGURE'])
})

it('reads what it took, its figures, and the box snapped to them', () => {
  const article = laidOut(
    '<p data-box="40 0 600 40">First words.</p>' +
      '<figure class="reader-figure" data-box="20 60 640 200">' +
      '<img src="/api/figure_proxy?src=a" /><img src="/api/figure_proxy?src=b" />' +
      '<figcaption>Figure 2. A plot.</figcaption></figure>',
  )
  expect(readBox(article, [100, 10, 200, 100])).toEqual({
    elements: Array.from(article.querySelectorAll('p, figure')),
    text: 'First words.\n\nFigure 2. A plot.',
    figures: ['/api/figure_proxy?src=a', '/api/figure_proxy?src=b'],
    rect: [20, 0, 660, 260],
  })
  expect(readBox(article, [700, 900, 790, 950])).toBeNull()
})

it('reads the labels both views share off equations and figures', () => {
  const article = laidOut(
    '<div class="reader-equation"><div class="reader-equation-body">x</div>' +
      '<span class="reader-equation-tag">(6)</span></div>' +
      '<figure class="reader-figure"><figcaption><span class="reader-figure-tag">Table 2.</span>' +
      ' Params.</figcaption></figure>' +
      '<div class="reader-equation"><div class="reader-equation-body">y</div></div>',
  )
  const [equation, table, untagged] = Array.from(
    article.querySelectorAll('.reader-equation, .reader-figure'),
  )
  expect(labelOf(equation)).toBe('(6)')
  expect(labelOf(table)).toBe('Table 2')
  expect(labelOf(untagged)).toBeNull()
  expect(labelsOf([article])).toEqual(['(6)', 'Table 2'])
  // A selection over part of the equation reaches its label.
  const range = document.createRange()
  range.selectNodeContents(equation.querySelector('.reader-equation-body')!)
  expect(labelsInRange(range, article)).toEqual(['(6)'])
  expect(labelElements(article, ['Table 2', 'Figure 9'])).toEqual({
    elements: [table],
    missing: 1,
  })
})

it('reads labels off an older question’s own words', () => {
  expect(labelsInPassage('$$T^{\\pi}Q = r$$ (2)')).toEqual(['(2)'])
  expect(labelsInPassage('Words.\n\n$$x$$ (6)\n\nFigure 1. Curves.\n\n$$y$$')).toEqual([
    '(6)',
    'Figure 1',
  ])
  expect(labelsInPassage('As (3) shows, $x$ is small.')).toEqual([])
})

it('finds a whole section by its label: its own element and its subsections', () => {
  const article = laidOut(
    '<section class="reader-section reader-level-1"><h2 class="reader-section-title">' +
      '<span class="reader-section-number">5</span>Experiments</h2></section>' +
      '<section class="reader-section reader-level-2"><h3 class="reader-section-title">' +
      '<span class="reader-section-number">5.1</span>Comparisons</h3></section>' +
      '<section class="reader-section reader-level-1"><h2 class="reader-section-title">' +
      '<span class="reader-section-number">6</span>Conclusion</h2></section>' +
      '<section class="reader-section reader-level-1"><h2 class="reader-section-title">' +
      'Acknowledgments</h2></section>',
  )
  const sections = Array.from(article.querySelectorAll('section'))
  // By number: the section and its subsection, not the next section.
  expect(labelElements(article, ['§5 Experiments'])).toEqual({
    elements: [sections[0], sections[1]],
    missing: 0,
  })
  // By title, when the label has no number.
  expect(labelElements(article, ['§Conclusion']).elements).toEqual([sections[2]])
  expect(labelElements(article, ['§acknowledgments']).elements).toEqual([sections[3]])
  expect(labelElements(article, ['§9 Nope'])).toEqual({ elements: [], missing: 1 })
})
