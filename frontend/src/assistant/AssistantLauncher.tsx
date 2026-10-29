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
 * **Still until you reach for it** (Patrick): the astronaut is a still frame,
 * and floats only while the pointer is over it; a click, or the pointer
 * leaving, stills it again. The still is the animation's first frame, so the
 * swap doesn't jump. With reduced motion asked for, it never floats.
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

import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'

/** The astronaut, still and floating (`public/`, cut from Patrick's animation). */
const STILL = '/astronaut-still.png'
const FLOATING = '/astronaut.webp'
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
  const [floating, setFloating] = useState(false)
  const [spot, setSpot] = useState<Spot | null>(storedSpot)
  const [dragging, setDragging] = useState(false)
  const press = useRef<{ startX: number; startY: number; from: Spot; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stillOnly =
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
          setFloating(false)
          onOpen()
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerEnter={() => setFloating(!stillOnly)}
        onPointerLeave={() => setFloating(false)}
        title="The assistant — click to ask about what's on screen, drag to move it"
        aria-label="Open the assistant"
      >
        <img
          src={(floating || dragging) && !stillOnly ? FLOATING : STILL}
          alt=""
          draggable={false}
        />
      </button>
      {spot && !dragging && (
        <button
          type="button"
          className="assistant-launcher-home"
          onClick={() => {
            setSpot(null)
            storeSpot(null)
          }}
          title="Put the astronaut back in the corner"
          aria-label="Put the assistant back in the corner"
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
