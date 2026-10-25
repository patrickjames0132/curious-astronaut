/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Where a highlight in the PDF view began and ended (v8.45.0), as points on
 * its pages in PDF points, which the server reads the passage between from
 * the PDF's own words in reading order (`/pdf-passage`): across a column, or
 * a page, as the reader read it.
 *
 * Only the drag's two ends are trusted. pdf.js's text layer is in the order
 * the PDF was written, so what the browser selects between them can sweep in
 * glyphs set elsewhere on the page, and its rectangles can't tell a column
 * break from that noise. The first build kept the rectangles between the
 * drag's two heights, which across two columns kept only the first and last
 * lines (Patrick: "only highlighting bits and pieces").
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { PdfPoint } from '../api'

/** A page as laid out on screen: its number, box, and scale (px per point). */
export interface LaidOutPage {
  page: number
  box: { left: number; top: number; width: number; height: number }
  scale: number
}

/**
 * A point on screen as a point on the page under it.
 *
 * @param screenX Pixels from the viewport's left.
 * @param screenY Pixels from its top.
 * @param pages The pages, as laid out.
 * @returns The page and the point on it, in points; null off the pages.
 */
export function pointOn(screenX: number, screenY: number, pages: LaidOutPage[]): PdfPoint | null {
  const holder = pages.find(
    ({ box }) =>
      screenX >= box.left &&
      screenX <= box.left + box.width &&
      screenY >= box.top &&
      screenY <= box.top + box.height,
  )
  if (!holder) return null
  const toPoints = (value: number, origin: number) =>
    Math.round(((value - origin) / holder.scale) * 100) / 100
  return {
    page: holder.page,
    left: toPoints(screenX, holder.box.left),
    top: toPoints(screenY, holder.box.top),
  }
}

/**
 * Where a selection in the PDF view began and ended: the left of its first
 * box on screen and the right of its last (a range's boxes come in the
 * order of its text). Not the range's carets: a drag let go at a line's end
 * puts the end at the start of the next line, a word too far.
 *
 * @param range The selection's range.
 * @param root The element holding the pages (`.reader-pdf-page`).
 * @returns Its two ends on their pages, or null when either can't be placed.
 */
export function selectionSpan(
  range: Range,
  root: Element,
): { start: PdfPoint; end: PdfPoint } | null {
  if (typeof range.getClientRects !== 'function') return null
  const boxes = Array.from(range.getClientRects()).filter(
    (box) => box.width > 0.5 && box.height > 0.5,
  )
  const first = boxes[0]
  const last = boxes.at(-1)
  if (!first || !last) return null
  const pages = Array.from(root.querySelectorAll<HTMLElement>('.reader-pdf-page')).map(
    (element, index) => {
      const box = element.getBoundingClientRect()
      return {
        page: index + 1,
        box: { left: box.left, top: box.top, width: box.width, height: box.height },
        scale: Number(element.dataset.scale) || 1,
      }
    },
  )
  const start = pointOn(first.left, (first.top + first.bottom) / 2, pages)
  const end = pointOn(last.right, (last.top + last.bottom) / 2, pages)
  return start && end ? { start, end } : null
}
