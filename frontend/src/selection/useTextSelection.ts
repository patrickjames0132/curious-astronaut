/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The text selection inside a container, for `SelectionMenu`: a finished
 * Knowledge Graph lesson (v8.25.0, the frontend's first reader of one), and
 * the Reader's page (v8.38.0). The pill sits above the selection, or below
 * it near the top of the window, in fixed coordinates, so it holds its place
 * wherever the text scrolls; it follows a scroll and closes when the
 * selection collapses or leaves the container.
 *
 * What a selection *says* is `formulas.selectionText` by default (typeset
 * formulas read as LaTeX, a part of one with the whole for context); a
 * container can pass its own `readText` (the Reader adds its own breaks and
 * leaves out footnote marks).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { selectionText } from './formulas'

/** The fewest characters worth a menu: a stray click-drag selects one or two. */
const MIN_CHARS = 2

/** The gap between the pill and the selection, in px. */
const GAP = 8

/** The pill's height, for deciding whether it fits above the selection. */
const PILL_HEIGHT = 36

/** About half the pill's width, to keep it inside the window when the
 *  selection runs to its edge (it squeezed into a column there, v8.26.0). */
const PILL_HALF_WIDTH = 90

/** A passage highlighted in the container, and where the pill goes. */
export interface TextSelection {
  text: string
  /** The pill's anchor: its horizontal centre, and its top edge. */
  left: number
  top: number
}

/**
 * Where the pill goes for a range: centred above it, or below it when the
 * top of the window leaves no room, and never past the window's sides.
 *
 * @param range The selection's range.
 * @returns The pill's anchor.
 */
function anchorOf(range: Range): { left: number; top: number } {
  return pillAnchor(range.getBoundingClientRect())
}

/**
 * Where the pill goes for anything on screen, a range's box or a box drawn
 * over the PDF (v8.46.0), placed as `anchorOf` places it over a range.
 *
 * @param box Its box in viewport pixels.
 * @param box.left Its left edge.
 * @param box.top Its top edge.
 * @param box.width Its width.
 * @param box.bottom Its bottom edge.
 * @returns The pill's anchor.
 */
export function pillAnchor(box: { left: number; top: number; width: number; bottom: number }): {
  left: number
  top: number
} {
  const above = box.top - GAP - PILL_HEIGHT
  const centre = box.left + box.width / 2
  return {
    left: Math.max(
      PILL_HALF_WIDTH + GAP,
      Math.min(centre, window.innerWidth - PILL_HALF_WIDTH - GAP),
    ),
    top: above >= GAP ? above : box.bottom + GAP,
  }
}

/**
 * Track the text selection inside a container.
 *
 * @param containerRef The element whose text counts (a lesson's body, the
 *   Reader's article).
 * @param enabled Read selections at all; off while a lesson is still being
 *   written.
 * @param readText What a selected range says; `selectionText` (formulas
 *   as LaTeX) when absent.
 * @returns The selection, or null, and a way to drop it.
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  readText?: (range: Range) => string,
): { selection: TextSelection | null; clear: () => void } {
  const [selection, setSelection] = useState<TextSelection | null>(null)
  // Whether the pill is up, for the scroll listener: a scroll moves it, and
  // re-reading with nothing selected would be wasted work on every frame.
  const shown = useRef(false)
  shown.current = selection !== null

  const read = useCallback(() => {
    const container = containerRef.current
    const current = window.getSelection()
    if (!enabled || !container || !current || current.isCollapsed || !current.rangeCount) {
      setSelection(null)
      return
    }
    const range = current.getRangeAt(0)
    const text = (readText ?? selectionText)(range).trim()
    if (
      text.length < MIN_CHARS ||
      !container.contains(range.startContainer) ||
      !container.contains(range.endContainer)
    ) {
      setSelection(null)
      return
    }
    setSelection({ text, ...anchorOf(range) })
  }, [containerRef, enabled, readText])

  useEffect(() => {
    // `selectionchange` alone fires mid-drag, which would open the pill under
    // the pointer before the reader has finished choosing; a collapse is
    // the one change it has to catch (a click elsewhere, Esc).
    const onChange = () => {
      const current = window.getSelection()
      if (!current || current.isCollapsed) setSelection(null)
    }
    const onRelease = () => window.setTimeout(read, 0)
    const onScroll = () => {
      if (shown.current) read()
    }
    document.addEventListener('selectionchange', onChange)
    document.addEventListener('mouseup', onRelease)
    document.addEventListener('keyup', onRelease)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('selectionchange', onChange)
      document.removeEventListener('mouseup', onRelease)
      document.removeEventListener('keyup', onRelease)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [read])

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [])

  return { selection, clear }
}
