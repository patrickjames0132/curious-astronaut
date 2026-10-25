/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Knowledge Graph notes in the margin, laid out together (v8.44.0):
 *
 * - **Stacked, never overlapping.** Each note wants to sit level with its
 *   heading; when the one above runs past that (short sections, or several
 *   headings on one PDF page), it is pushed down just below it (Patrick: a
 *   narrow window piled them on top of each other).
 * - **Tied to their headings** by a curve from the middle of the note's bar
 *   to the end of the heading's text (Patrick), so a note pushed down still
 *   shows what it belongs to: barely there at rest, glowing gold while the
 *   note is hovered (reader.css). In the text view the heading is the
 *   section's own, the note lifted so "Builds on" sits level with it, and
 *   the curve runs along the heading's line and down the gap beside the
 *   column, never across the text; in the PDF it is found in pdf.js's text
 *   layer, near the heading's height, by its words, and the curve goes
 *   straight there.
 *
 * A note under its heading instead (the text view's narrow layout) has no
 * curve, and lets go of any shift it had in the margin: kept, a window
 * narrowed past the margin left it lifted over its own heading. The work is done straight on the DOM, a frame
 * after anything moves: the pane resizing, a note growing or shrinking
 * ("+N more", `NOTES_CHANGED`), the text reflowing, or a PDF page's text
 * layer arriving (`PDF_TEXT_DRAWN`).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, type RefObject } from 'react'
import { nameKey } from '../knowledge/model'
import { NOTES_CHANGED, PDF_TEXT_DRAWN } from './links'

/** Space kept between two stacked notes, px. */
const STACK_GAP = 10
/** Space between a heading's text and its curve's start, px. */
const HEADING_GAP = 8

/** Where a heading's text ends on screen: its right edge, at its line's middle. */
interface Point {
  right: number
  middle: number
}

/**
 * Where a text-view heading's text ends: its last line's right edge, at that
 * line's middle.
 *
 * @param heading The heading element.
 * @returns The point, or null when it has no text on screen.
 */
function textHeadingEnd(heading: Element): Point | null {
  const range = document.createRange()
  range.selectNodeContents(heading)
  // Not every DOM measures ranges (jsdom doesn't): no curve, then.
  if (typeof range.getClientRects !== 'function') return null
  const lines = Array.from(range.getClientRects())
  const last = lines.at(-1)
  return last ? { right: last.right, middle: (last.top + last.bottom) / 2 } : null
}

/**
 * Where a PDF heading's text ends, found in the page's text layer: the spans
 * near the heading's height whose words are the heading's, the rightmost on
 * the first such line.
 *
 * @param holder The note's holder on the page (`.reader-pdf-note`).
 * @returns The point, or null when the text layer isn't drawn yet or has no
 *          match.
 */
function pdfHeadingEnd(holder: HTMLElement): Point | null {
  const page = holder.closest('.reader-pdf-page')
  if (!page) return null
  const words = new Set(
    (holder.dataset.title ?? '')
      .split(/\s+/)
      .map((word) => nameKey(word))
      .filter(Boolean),
  )
  const want = holder.offsetTop + page.getBoundingClientRect().top
  let line: number | null = null
  let end: Point | null = null
  for (const span of Array.from(page.querySelectorAll('.textLayer span'))) {
    const box = span.getBoundingClientRect()
    const middle = (box.top + box.bottom) / 2
    if (middle < want - 8 || middle > want + 36) continue
    const spanWords = (span.textContent ?? '').split(/\s+/).map((word) => nameKey(word))
    if (!spanWords.some((word) => word && words.has(word))) continue
    if (line === null) line = middle
    if (Math.abs(middle - line) > 4) continue
    if (!end || box.right > end.right) end = { right: box.right, middle }
  }
  return end
}

/**
 * Where a text-view note would like its top: its "Builds on" level with the
 * middle of its section's heading, so the curve can run along the heading's
 * own line. A PDF note already sits at its heading's height.
 *
 * @param note The note.
 * @param natural Its top as the CSS places it, unshifted.
 * @returns The top it wants, on screen.
 */
function wantedTop(note: HTMLElement, natural: number): number {
  const heading = note.closest('section')?.querySelector('.reader-section-title')
  const label = note.querySelector('.reader-concepts-label')
  if (!heading || !label) return natural
  const headingBox = heading.getBoundingClientRect()
  const labelBox = label.getBoundingClientRect()
  const noteTop = note.getBoundingClientRect().top
  const labelMiddle = labelBox.top - noteTop + labelBox.height / 2
  return headingBox.top + headingBox.height / 2 - labelMiddle
}

/**
 * Stack the notes and draw their curves, once.
 *
 * @param pane The scrolling reading pane.
 */
export function layOut(pane: HTMLElement) {
  const notes = Array.from(pane.querySelectorAll<HTMLElement>('.reader-concepts')).map((note) => ({
    note,
    holder: note.closest<HTMLElement>('.reader-pdf-note') ?? note,
  }))
  // A note back under its heading (the pane narrowed) sheds the shift it had
  // in the margin: kept, it lifted the note over its own heading (Patrick).
  const inMargin = notes.filter(({ holder }) => getComputedStyle(holder).position === 'absolute')
  for (const { holder } of notes) {
    if (inMargin.some((entry) => entry.holder === holder)) continue
    delete holder.dataset.pushed
    holder.style.translate = ''
  }
  // Where each sits without the shift it was given last time, and where it
  // would like to be; then each goes as near that as the one above allows.
  const placed = inMargin
    .map((entry) => {
      const shifted = Number(entry.holder.dataset.pushed) || 0
      const box = entry.holder.getBoundingClientRect()
      const natural = box.top - shifted
      const want = entry.holder === entry.note ? wantedTop(entry.note, natural) : natural
      return { ...entry, natural, want, height: box.height }
    })
    .sort((first, second) => first.want - second.want)
  let below = -Infinity
  for (const entry of placed) {
    const top = Math.max(entry.want, below + STACK_GAP)
    const shift = Math.round(top - entry.natural)
    entry.holder.dataset.pushed = String(shift)
    entry.holder.style.translate = shift ? `0 ${shift}px` : ''
    below = top + entry.height
  }
  for (const { note, holder } of notes) {
    const path = note.querySelector('.reader-concepts-link path')
    if (!path) continue
    const inMargin = getComputedStyle(holder).position === 'absolute'
    const inPdf = holder.classList.contains('reader-pdf-note')
    const heading = inPdf
      ? pdfHeadingEnd(holder)
      : note.closest('section')?.querySelector('.reader-section-title')
    const end = heading instanceof Element ? textHeadingEnd(heading) : heading
    const box = note.getBoundingClientRect()
    if (!inMargin || !end || end.right + HEADING_GAP >= box.left) {
      path.setAttribute('d', '')
      continue
    }
    // Note-local: from the heading's end to the middle of the bar (x 0).
    const fromX = end.right + HEADING_GAP - box.left
    const fromY = end.middle - box.top
    const toY = box.height / 2
    if (inPdf) {
      path.setAttribute(
        'd',
        `M ${fromX} ${fromY} C ${fromX / 2} ${fromY}, ${fromX / 2} ${toY}, 0 ${toY}`,
      )
      continue
    }
    // In the text, around the text rather than through it (Patrick): along
    // the heading's own line, which is empty past its end, to the gap
    // beside the column, then down that gap to the bar.
    const article = note.closest('.reader-article')
    const column = article
      ? article.getBoundingClientRect().right -
        parseFloat(getComputedStyle(article).paddingRight || '0')
      : end.right
    const turnX =
      Math.min(Math.max(column + HEADING_GAP, end.right + HEADING_GAP), box.left - 4) - box.left
    path.setAttribute(
      'd',
      `M ${fromX} ${fromY} H ${turnX} C ${turnX / 2} ${fromY}, ${turnX / 2} ${toY}, 0 ${toY}`,
    )
  }
}

/**
 * Keep the margin notes stacked and tied to their headings.
 *
 * @param paneRef The scrolling reading pane.
 * @param key Changes whenever the notes do (which, and in which view), so
 *   the layout is redone with the new ones.
 */
export function useMarginNotes(paneRef: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const pane = paneRef.current
    if (!pane || !key) return
    let frame = 0
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule())
    // Each pass watches whatever is there now: a PDF's notes arrive with its
    // pages, after this effect (watching twice is harmless). Missing that
    // left a note's "+N more" unwatched, and it opened over the next note.
    const watch = () => {
      if (pane.firstElementChild) observer?.observe(pane.firstElementChild)
      for (const note of Array.from(pane.querySelectorAll('.reader-concepts')))
        observer?.observe(note)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        watch()
        layOut(pane)
      })
    }
    schedule()
    observer?.observe(pane)
    pane.addEventListener(PDF_TEXT_DRAWN, schedule)
    pane.addEventListener(NOTES_CHANGED, schedule)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      pane.removeEventListener(PDF_TEXT_DRAWN, schedule)
      pane.removeEventListener(NOTES_CHANGED, schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [paneRef, key])
}
