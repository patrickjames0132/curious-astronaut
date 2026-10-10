/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The alt-drag box: hold Alt and drag a rectangle over a canvas to pick the
 * nodes inside it. A modifier-drag, not a mode — plain drag still pans the
 * graph, so this arms only while Alt is held and captures the drag through a
 * transparent overlay, which keeps the force engine from ever seeing it.
 *
 * Shared by both graphs since v8.17.0: the citation graph's `useMarquee`
 * picks the teacher's scope with it, and the knowledge graph picks concepts
 * to check off together. The hook owns only the gesture. What counts as
 * inside the box (`hitTest`, in canvas-local screen pixels) and what a pick
 * means (`onPick`, `onClear`) belong to the caller.
 *
 * A negligible drag is an alt-click on empty canvas, and clears. (Not
 * Alt+Shift for "add": that combo is the OS keyboard-layout switch on Windows,
 * which steals the modifier and the window focus mid-drag.)
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'

/** A drag rectangle in wrap-local pixels, for painting the outline. */
export interface BoxRect {
  left: number
  top: number
  width: number
  height: number
}

/** The released box, as bounds in wrap-local pixels. */
export interface BoxBounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/** Arguments for {@link useBoxSelect}. */
export interface UseBoxSelectArgs {
  /** The canvas wrap element: the coordinate origin for the box. */
  wrapRef: RefObject<HTMLDivElement | null>
  /** The ids of the nodes inside the released box. */
  hitTest: (box: BoxBounds) => string[]
  /** A box was released over these ids (possibly none). */
  onPick: (ids: string[]) => void
  /** An alt-click on empty canvas. */
  onClear: () => void
}

/** What {@link useBoxSelect} returns for the caller to render. */
export interface BoxSelectApi {
  /** True while Alt is held — the arm overlay is live and shows a crosshair. */
  armed: boolean
  /** The in-progress drag rectangle, or null when not dragging. */
  rect: BoxRect | null
  /** Mousedown handler for the arm overlay (starts an alt-drag). */
  onArmMouseDown: (event: ReactMouseEvent) => void
}

/** A drag below this many pixels in both axes counts as a click, not a box. */
const CLICK_SLOP = 3

/**
 * Own the alt-drag box: track when Alt arms the overlay, run the drag, and
 * hand the enclosed ids to the caller on release.
 *
 * @param args The wrap element, the hit test, and what a pick and a clear do.
 * @returns The arm/rect state and the overlay mousedown handler.
 */
export function useBoxSelect({
  wrapRef,
  hitTest,
  onPick,
  onClear,
}: UseBoxSelectArgs): BoxSelectApi {
  const [armed, setArmed] = useState(false)
  const [rect, setRect] = useState<BoxRect | null>(null)
  // Read at mouseup, so keep the latest in refs rather than rebinding the
  // window-attached drag handlers whenever the caller re-renders.
  const latest = useRef({ hitTest, onPick, onClear })
  latest.current = { hitTest, onPick, onClear }

  // Alt arms the overlay. A window blur (alt-tab) can swallow the keyup, so
  // reset on blur too, or the overlay would stay stuck capturing clicks.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setArmed(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setArmed(false)
    }
    const onBlur = () => setArmed(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const onArmMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      if (!event.altKey || !wrapRef.current) return
      event.preventDefault()
      // Snapshot the wrap's box once; the drag stays in this coordinate frame
      // even if the layout shifts, and the hit test uses the same origin.
      const bounds = wrapRef.current.getBoundingClientRect()
      const startX = event.clientX - bounds.left
      const startY = event.clientY - bounds.top
      setRect({ left: startX, top: startY, width: 0, height: 0 })

      const onMove = (moveEvent: globalThis.MouseEvent) => {
        const currentX = moveEvent.clientX - bounds.left
        const currentY = moveEvent.clientY - bounds.top
        setRect({
          left: Math.min(startX, currentX),
          top: Math.min(startY, currentY),
          width: Math.abs(currentX - startX),
          height: Math.abs(currentY - startY),
        })
      }

      const onUp = (upEvent: globalThis.MouseEvent) => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setRect(null)
        const endX = upEvent.clientX - bounds.left
        const endY = upEvent.clientY - bounds.top
        const box = {
          xMin: Math.min(startX, endX),
          xMax: Math.max(startX, endX),
          yMin: Math.min(startY, endY),
          yMax: Math.max(startY, endY),
        }
        if (box.xMax - box.xMin < CLICK_SLOP && box.yMax - box.yMin < CLICK_SLOP) {
          latest.current.onClear()
          return
        }
        latest.current.onPick(latest.current.hitTest(box))
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [wrapRef],
  )

  return { armed, rect, onArmMouseDown }
}

/**
 * Whether a screen point lies inside a released box.
 *
 * @param point Canvas-local screen coordinates.
 * @param point.x Horizontal pixel.
 * @param point.y Vertical pixel.
 * @param box The box's bounds.
 * @returns True when inside (edges included).
 */
// oxlint-disable-next-line id-length -- the engines' own screen-point field names
export function inBox(point: { x: number; y: number }, box: BoxBounds): boolean {
  return point.x >= box.xMin && point.x <= box.xMax && point.y >= box.yMin && point.y <= box.yMax
}
