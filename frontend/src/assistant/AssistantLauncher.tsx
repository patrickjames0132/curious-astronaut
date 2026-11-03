/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The floating astronaut that opens the assistant while it is closed (v9.0.0,
 * the OnePager's "One assistant", stage 3): one button over every view, where
 * each tool used to keep a 🎓 of its own. It starts in the top-right corner
 * of the view's canvas (the shell's overlay layer), where those were, clear
 * of the find bars the views keep at the bottom right and of the graphs'
 * detail panels beside their canvas.
 *
 * **Still until you reach for it** (Patrick): the astronaut is a still frame
 * until the pointer is over it. Hovered, he turns to face you and bobs up and
 * down for as long as the pointer stays; the pointer leaving, he finishes the
 * drop he is in and turns back to rest (v9.9.0 — which frame follows which is
 * `launcherFrames.ts`). An `<img>` can't be told to play part of an animation,
 * so he is drawn from a sprite sheet, a frame at a time at the video's own
 * rate. A click stills him at once. With reduced motion asked for, he never
 * moves.
 *
 * **Draggable** (Patrick, back with the astronaut): drag it anywhere over the
 * view and it stays there, remembered across reloads and views; once moved,
 * a ↺ beside it on hover puts it back in the corner. The 🎓 was draggable
 * for one round of testing too, and Patrick preferred it staying put then.
 * A press that moves less than a few pixels is a click, so opening it is
 * unchanged. Its spot is kept as its distance from the top-right corner, and
 * the stylesheet keeps it on the canvas however small the canvas gets.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import {
  FRAME_MS,
  REST,
  SHEET,
  SHEET_COLUMNS,
  SHEET_ROWS,
  framePosition,
  nextFrame,
} from './launcherFrames'

/** The astronaut at rest (`public/`, the sprite sheet's first frame). */
const STILL = '/astronaut-still.png'
/** Back from a hidden tab, he picks up where he was rather than racing to catch up. */
const MAX_CATCH_UP_MS = 250
/** Where it was dragged to, remembered. */
const SPOT_KEY = 'ca.launcherSpot'
/** How far a press must move before it is a drag rather than a click. */
const DRAG_THRESHOLD = 4

/** Its distance from the top-right corner of the view's canvas, in pixels. */
interface Spot {
  top: number
  right: number
}

/**
 * The remembered spot, or null for the corner.
 *
 * @returns The spot.
 */
function storedSpot(): Spot | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SPOT_KEY) ?? 'null')
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Spot).top === 'number' &&
      typeof (parsed as Spot).right === 'number'
    )
      return parsed as Spot
  } catch {
    // Unreadable or blocked storage: the corner.
  }
  return null
}

/**
 * Remember a spot, or forget it for the corner.
 *
 * @param spot The spot, or null.
 */
function storeSpot(spot: Spot | null): void {
  try {
    if (spot) localStorage.setItem(SPOT_KEY, JSON.stringify(spot))
    else localStorage.removeItem(SPOT_KEY)
  } catch {
    // Not remembered; it still moves for this sitting.
  }
}

/**
 * Render the floating launcher.
 *
 * @param props Component props.
 * @param props.onOpen Open the assistant.
 * @returns The astronaut, and its way back to the corner once moved.
 */
export default function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  const [frame, setFrame] = useState(REST)
  const frameRef = useRef(REST)
  const hovered = useRef(false)
  const animation = useRef<number | null>(null)
  const [spot, setSpot] = useState<Spot | null>(storedSpot)
  const [dragging, setDragging] = useState(false)
  const press = useRef<{ startX: number; startY: number; from: Spot; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stillOnly =
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // The sheet is fetched up front, so the first hover has it to hand.
  useEffect(() => {
    if (stillOnly) return
    const sheet = new Image()
    sheet.src = SHEET
  }, [stillOnly])
  // Gone mid-bob (the assistant opened), he stops with it.
  useEffect(
    () => () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current)
    },
    [],
  )

  /** Step through the frames until he comes to rest; a no-op while already stepping. */
  const animate = () => {
    if (stillOnly || animation.current !== null) return
    let last: number | null = null
    const tick = (now: number) => {
      if (last === null || now - last > MAX_CATCH_UP_MS) last = now - FRAME_MS
      let current = frameRef.current
      let resting = false
      while (now - last >= FRAME_MS) {
        last += FRAME_MS
        const next = nextFrame(current, hovered.current)
        if (next === null) {
          resting = true
          break
        }
        current = next
      }
      frameRef.current = current
      setFrame(current)
      animation.current = resting ? null : requestAnimationFrame(tick)
    }
    animation.current = requestAnimationFrame(tick)
  }

  /** Back to rest at once, as a click asks. */
  const still = () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current)
    animation.current = null
    hovered.current = false
    frameRef.current = REST
    setFrame(REST)
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const wrap = wrapRef.current
    const canvas = wrap?.offsetParent
    if (!wrap || !canvas) return
    // Where it is now, measured, so a spot the stylesheet clamped drags from
    // where it shows.
    const box = wrap.getBoundingClientRect()
    const bounds = canvas.getBoundingClientRect()
    press.current = {
      startX: event.clientX,
      startY: event.clientY,
      from: { top: box.top - bounds.top, right: bounds.right - box.right },
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const pressed = press.current
    const wrap = wrapRef.current
    const canvas = wrap?.offsetParent
    if (!pressed || !wrap || !canvas) return
    const deltaX = event.clientX - pressed.startX
    const deltaY = event.clientY - pressed.startY
    if (!pressed.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return
    pressed.moved = true
    setDragging(true)
    // Carried about, he keeps bobbing.
    hovered.current = true
    animate()
    const bounds = canvas.getBoundingClientRect()
    const size = wrap.offsetWidth
    setSpot({
      top: Math.round(Math.min(Math.max(pressed.from.top + deltaY, 0), bounds.height - size)),
      right: Math.round(Math.min(Math.max(pressed.from.right - deltaX, 0), bounds.width - size)),
    })
  }

  const onPointerUp = () => {
    const pressed = press.current
    press.current = null
    if (!pressed?.moved) return
    dragged.current = true
    setDragging(false)
    setSpot((current) => {
      storeSpot(current)
      return current
    })
  }

  const style: CSSProperties | undefined = spot
    ? {
        top: `min(${spot.top}px, calc(100% - var(--launcher-size)))`,
        right: `min(${spot.right}px, calc(100% - var(--launcher-size)))`,
      }
    : undefined

  return (
    <div
      ref={wrapRef}
      className={`assistant-launcher-wrap${dragging ? ' dragging' : ''}`}
      style={style}
    >
      <button
        type="button"
        className="assistant-launcher"
        data-tour="assistant-btn"
        onClick={() => {
          // The click that ends a drag isn't a request to open it.
          if (dragged.current) {
            dragged.current = false
            return
          }
          still()
          onOpen()
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerEnter={() => {
          hovered.current = true
          animate()
        }}
        onPointerLeave={() => {
          hovered.current = false
        }}
        title="Ask Nova"
        aria-label="Open Nova"
      >
        {frame === REST ? (
          <img src={STILL} alt="" draggable={false} />
        ) : (
          <span
            className="assistant-launcher-sprite"
            style={{
              backgroundImage: `url(${SHEET})`,
              backgroundSize: `${SHEET_COLUMNS * 100}% ${SHEET_ROWS * 100}%`,
              backgroundPosition: framePosition(frame),
            }}
          />
        )}
      </button>
      {spot && !dragging && (
        <button
          type="button"
          className="assistant-launcher-home"
          onClick={() => {
            setSpot(null)
            storeSpot(null)
          }}
          title="Put Nova back in the corner"
          aria-label="Put Nova back in the corner"
        >
          {/* Drawn rather than the ↺ character, which sat small and off
              centre in its ring at this size. */}
          <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
            <path
              d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M3 1.8v3.6h3.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
