/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The text selection inside a finished lesson (v8.25.0), the frontend's
 * first reader of one, for `SelectionMenu`. The pill sits above the
 * selection, or below it near the top of the window, in fixed coordinates,
 * so it holds its place wherever the lesson scrolls; it follows a scroll and
 * closes when the selection collapses or leaves the lesson.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** The fewest characters worth a menu: a stray click-drag selects one or two. */
const MIN_CHARS = 2

/** The gap between the pill and the selection, in px. */
const GAP = 8

/** The pill's height, for deciding whether it fits above the selection. */
const PILL_HEIGHT = 36

/** About half the pill's width, to keep it inside the window when the
 *  selection runs to its edge (it squeezed into a column there, v8.26.0). */
const PILL_HALF_WIDTH = 90

/** A passage highlighted in the lesson, and where the pill goes. */
export interface LessonSelection {
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
  const box = range.getBoundingClientRect()
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
 * @param containerRef The element whose text counts (the lesson's body).
 * @param enabled Read selections at all; off while the lesson is still
 *   being written.
 * @returns The selection, or null, and a way to drop it.
 */
export function useLessonSelection(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): { selection: LessonSelection | null; clear: () => void } {
  const [selection, setSelection] = useState<LessonSelection | null>(null)
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
    const text = current.toString().trim()
    if (
      text.length < MIN_CHARS ||
      !container.contains(range.startContainer) ||
      !container.contains(range.endContainer)
    ) {
      setSelection(null)
      return
    }
    setSelection({ text, ...anchorOf(range) })
  }, [containerRef, enabled])

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
