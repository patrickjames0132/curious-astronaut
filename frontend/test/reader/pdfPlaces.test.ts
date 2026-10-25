// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Where a PDF highlight began and ended, as points on its pages (v8.45.0).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it } from 'vitest'
import { pointOn, selectionSpan } from '../../src/reader/pdfPlaces'

/** Two pages at scale 2, one under the other, the first 100px from the top. */
const PAGES = [
  { page: 1, box: { left: 50, top: 100, width: 400, height: 500 }, scale: 2 },
  { page: 2, box: { left: 50, top: 620, width: 400, height: 500 }, scale: 2 },
]

afterEach(() => {
  document.body.replaceChildren()
  // @ts-expect-error -- jsdom's Range has none; a test gave it one.
  delete Range.prototype.getClientRects
})

describe('pointOn', () => {
  it('turns a point on screen into points on the page under it', () => {
    expect(pointOn(70, 140, PAGES)).toEqual({ page: 1, left: 10, top: 20 })
    expect(pointOn(250, 720, PAGES)).toEqual({ page: 2, left: 100, top: 50 })
  })

  it('places nothing off the pages', () => {
    expect(pointOn(10, 140, PAGES)).toBeNull()
    expect(pointOn(70, 610, PAGES)).toBeNull()
  })
})

describe('selectionSpan', () => {
  it('takes the left of the first box and the right of the last, across pages', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<div class="reader-pdf-page" data-scale="2"><span>first</span></div>' +
      '<div class="reader-pdf-page" data-scale="2"><span>last</span></div>'
    document.body.append(root)
    const [one, two] = Array.from(root.querySelectorAll<HTMLElement>('.reader-pdf-page'))
    one.getBoundingClientRect = () => new DOMRect(50, 100, 400, 500)
    two.getBoundingClientRect = () => new DOMRect(50, 620, 400, 500)
    Range.prototype.getClientRects = function () {
      return [
        new DOMRect(70, 130, 100, 20),
        new DOMRect(0, 0, 0, 0),
        new DOMRect(90, 700, 60, 20),
      ] as unknown as DOMRectList
    }
    const range = document.createRange()
    range.selectNodeContents(root)
    expect(selectionSpan(range, root)).toEqual({
      start: { page: 1, left: 10, top: 20 },
      end: { page: 2, left: 50, top: 45 },
    })
  })

  it('is nothing where the DOM measures no boxes', () => {
    const root = document.createElement('div')
    const range = document.createRange()
    range.selectNodeContents(root)
    expect(selectionSpan(range, root)).toBeNull()
  })
})
