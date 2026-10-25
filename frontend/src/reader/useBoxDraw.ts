/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A box drawn with ⌥ (Alt) and a drag, for what a text selection can't
 * grab, an equation, a figure, a table: over the PDF's pages (v8.46.0, the
 * Reader's stage 7) or the text view's article (v8.48.0, stage 8). The hook
 * only draws; what a box means is the view's. In the PDF it's a place
 * (`PdfPlace`): the server reads the words inside it and pictures it for
 * the model. In the text it takes the whole elements it touches
 * (`textBox.ts`): there's nothing to picture that isn't already there.
 *
 * ⌥-drag only, no button (Patrick, 2026-10-25): text selection stays the
 * plain drag, and the box is taught by the tour, the controls' ⓘ and the
 * assistant's tip. ⌥ is what stops the browser starting a selection.
 * Holding it turns the pointer over the pages into a crosshair
 * (`.reader-boxing`), so the mode shows before the drag (Patrick).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PdfPlace } from '../api'

/** A box in a frame, `[x0, y0, x1, y1]` from its top-left in the frame's
 *  units: a PDF page's points, or the text article's pixels (scale 1). */
export interface DrawnBox {
  /** The 1-based frame: the PDF's page, or 1 for the text's article. */
  page: number
  rect: number[]
  /** False while it's still being dragged. */
  done: boolean
}

/** Pixels a drag must cover, each way, to be a box rather than a click. */
const MIN_SIZE = 8

/**
 * The frame a box sits in, and its scale (px per unit).
 *
 * @param pane The scrolling pane.
 * @param frames The frames' selector.
 * @param page The 1-based frame.
 * @returns The element and scale, or null when it isn't laid out.
 */
function frameOf(
  pane: HTMLElement,
  frames: string,
  page: number,
): { element: HTMLElement; scale: number } | null {
  const element = pane.querySelectorAll<HTMLElement>(frames)[page - 1]
  return element ? { element, scale: Number(element.dataset.scale) || 1 } : null
}

/**
 * Where a box is on screen.
 *
 * @param pane The scrolling pane.
 * @param frames The frames' selector (`PDF_FRAMES` or `TEXT_FRAMES`).
 * @param box The box.
 * @returns Its screen rectangle, or null when its frame isn't laid out.
 */
export function boxOnScreen(pane: HTMLElement, frames: string, box: DrawnBox): DOMRect | null {
  const holder = frameOf(pane, frames, box.page)
  if (!holder) return null
  const origin = holder.element.getBoundingClientRect()
  const [left, top, right, bottom] = box.rect.map((value) => value * holder.scale)
  return new DOMRect(origin.left + left, origin.top + top, right - left, bottom - top)
}

/** The frames a box is drawn in: the PDF's pages. */
export const PDF_FRAMES = '.reader-pdf-page'
/** The frames a box is drawn in: the text view's article. */
export const TEXT_FRAMES = '.reader-article'

/**
 * Draw a box in a view's frames with ⌥-drag.
 *
 * @param root The scrolling pane holding the frames.
 * @param enabled Whether the view is showing.
 * @param frames The frames' selector (`PDF_FRAMES` or `TEXT_FRAMES`).
 * @returns The box (being drawn, or drawn), a counter that changes when the
 *          frame under it scrolls (to move its menu), and a way to let it go.
 */
export function useBoxDraw(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
  frames: string,
): { box: DrawnBox | null; moved: number; clear: () => void } {
  const [box, setBox] = useState<DrawnBox | null>(null)
  const [moved, setMoved] = useState(0)
  const drawn = useRef(false)
  drawn.current = !!box?.done
  const clear = useCallback(() => setBox(null), [])

  useEffect(() => {
    const pane = root.current
    if (!enabled || !pane) {
      setBox(null)
      return
    }
    let drag: {
      page: number
      element: HTMLElement
      scale: number
      left: number
      top: number
    } | null = null
    const pointAt = (event: MouseEvent) => {
      if (!drag) return [0, 0]
      const origin = drag.element.getBoundingClientRect()
      const clamp = (value: number, high: number) => Math.max(0, Math.min(value, high))
      return [
        clamp(event.clientX - origin.left, origin.width) / drag.scale,
        clamp(event.clientY - origin.top, origin.height) / drag.scale,
      ]
    }
    const rectTo = (event: MouseEvent) => {
      const [left, top] = [drag?.left ?? 0, drag?.top ?? 0]
      const [atX, atY] = pointAt(event)
      return [Math.min(left, atX), Math.min(top, atY), Math.max(left, atX), Math.max(top, atY)]
    }
    const onMove = (event: MouseEvent) => {
      if (!drag) return
      setBox({ page: drag.page, rect: rectTo(event), done: false })
    }
    const onUp = (event: MouseEvent) => {
      if (!drag) return
      const rect = rectTo(event)
      const big =
        (rect[2] - rect[0]) * drag.scale >= MIN_SIZE && (rect[3] - rect[1]) * drag.scale >= MIN_SIZE
      setBox(
        big
          ? {
              page: drag.page,
              rect: rect.map((value) => Math.round(value * 100) / 100),
              done: true,
            }
          : null,
      )
      drag = null
      aim(event.altKey)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (event.button !== 0 || target?.closest?.('.selection-menu')) return
      const element = target?.closest?.<HTMLElement>(frames)
      // A plain click anywhere lets a drawn box go; ⌥ in a frame draws one.
      if (!event.altKey || !element) {
        if (drawn.current) setBox(null)
        return
      }
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
      const pages = Array.from(pane.querySelectorAll<HTMLElement>(frames))
      const scale = Number(element.dataset.scale) || 1
      drag = { page: pages.indexOf(element) + 1, element, scale, left: 0, top: 0 }
      const [left, top] = pointAt(event)
      drag.left = left
      drag.top = top
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    // The crosshair: while ⌥ is held, and through a drag begun with it.
    const aim = (on: boolean) => pane.classList.toggle('reader-boxing', on || !!drag)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBox(null)
      if (event.key === 'Alt') aim(event.type === 'keydown')
    }
    const onHover = (event: MouseEvent) => {
      if (!drag) aim(event.altKey)
    }
    const onBlur = () => aim(false)
    const onScroll = () => {
      if (drawn.current) setMoved((count) => count + 1)
    }
    pane.addEventListener('mousedown', onDown)
    pane.addEventListener('mousemove', onHover)
    pane.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      pane.classList.remove('reader-boxing')
      pane.removeEventListener('mousedown', onDown)
      pane.removeEventListener('mousemove', onHover)
      pane.removeEventListener('scroll', onScroll)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [root, enabled, frames])

  return { box, moved, clear }
}

/**
 * A box drawn over the PDF as a place, the shape a highlight's places take.
 *
 * @param box The box.
 * @returns Its place.
 */
export function boxPlace(box: DrawnBox): PdfPlace {
  return { page: box.page, rects: [box.rect] }
}
