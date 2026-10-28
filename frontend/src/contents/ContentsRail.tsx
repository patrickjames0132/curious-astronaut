/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The contents rail: a page's sections down its left edge, following the
 * reading, one click to any of them. Resized by dragging its right edge,
 * folded away by the bump on that edge (or a drag narrow enough) to a thin
 * line whose own bump brings it back. Shared by the Reader and the
 * Criticisms card, so both read as one control.
 *
 * The host owns what the entries are and which one is active; this owns the
 * panel: open or folded (remembered), its width (remembered), the slide, and
 * the glide the host's page plays as the rail makes or gives back room.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { usePresence, type Presence } from '../ui/usePresence'
import { useResizablePanel, type ResizablePanel } from '../ui/useResizablePanel'
import './contents.css'

/** Longer than the rail's slide (--motion-panel), in ms: when the host's
 *  glide is over even if its animationend never came. */
const GLIDE_FALLBACK = 600

/** One entry in the rail. */
export interface ContentsEntry {
  /** The entry's id, handed back on a click. */
  id: string
  /** 1 for a top-level section, 2 and 3 indented beneath it. */
  level: number
  /** Its number ("3.2"), shown in the number column; empty for none. */
  number: string
  /** Its title as shown. */
  title: ReactNode
  /** Its title as plain text, for the tooltip. */
  label: string
}

/** The rail's panel state, from {@link useContentsRail}. */
export interface ContentsRailState {
  /** Whether it's open (or still sliding away). */
  open: boolean
  /** Whether it has been toggled since it mounted: only then does it slide. */
  toggled: boolean
  /** Folded by a drag: it snaps away instead of sliding. */
  snapped: boolean
  /** Its mount-through-exit state. */
  presence: Presence
  /** Its drag-resize state; `width` is the host's `--contents-width`. */
  panel: ResizablePanel
  /** The host page's glide while the rail slides, if any. */
  glide: 'open' | 'close' | null
  /** Wire to the host's `onAnimationEnd`: ends the glide on its own end. */
  onGlideEnd: (animationName: string) => void
  /** Open or fold it. */
  toggle: (open: boolean, snap?: boolean) => void
}

/**
 * Whether a rail was left open: open unless folded away before.
 *
 * @param key Its localStorage key.
 * @returns Whether it starts open.
 */
function storedOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0'
  } catch {
    return true // storage blocked: open, the default
  }
}

/**
 * The rail's panel: open or folded, its width, its slide and the host's glide.
 *
 * @param openKey The localStorage key remembering whether it's open.
 * @param widthKey The localStorage key remembering its dragged width.
 * @returns Its state, for {@link ContentsRail} and the host's glide.
 */
export function useContentsRail(openKey: string, widthKey: string): ContentsRailState {
  const [open, setOpen] = useState(() => storedOpen(openKey))
  // The panel slides like the app's docked panels: out on fold, back in on
  // reopen — but not on every arrival at the page, so only after a toggle.
  const [toggled, setToggled] = useState(false)
  const presence = usePresence(open)
  // Folded by a drag, the panel is already as narrow as it goes: it snaps
  // away instead of sliding, or it would first jump back to its width.
  const [snapped, setSnapped] = useState(false)
  // The host's page takes its new width at once and its contents glide
  // there (a transform), rather than the page resizing every frame of the
  // slide: re-laying out a whole paper sixty times a second lagged.
  const [glide, setGlide] = useState<'open' | 'close' | null>(null)
  // Ended by its animationend; this catches one that never comes, which
  // would leave the page unable to scroll sideways.
  useEffect(() => {
    if (!glide) return
    const timer = window.setTimeout(() => setGlide(null), GLIDE_FALLBACK)
    return () => window.clearTimeout(timer)
  }, [glide])
  const toggle = (next: boolean, snap = false) => {
    setToggled(true)
    setSnapped(snap)
    // No glide when motion is reduced: no animation, so nothing would end it.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setGlide(snap || still ? null : next ? 'open' : 'close')
    setOpen(next)
    try {
      localStorage.setItem(openKey, next ? '1' : '0')
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
  }
  // Resized by dragging its right edge, like the app's other side panels; a
  // drag well past the floor folds it away. Unlike the explorer rail, a drag
  // never opens it again: folded, it has no handle, only the bump — so the
  // two left-hand panels never compete for one pointer (Patrick, 2026-10-23).
  const panel = useResizablePanel(widthKey, 248, {
    min: 180,
    max: 420,
    maxFraction: 0.35,
    side: 'left',
    fold: {
      collapsed: !open,
      collapsedWidth: 0,
      closeAt: 130,
      openAt: Number.POSITIVE_INFINITY, // never reopened by a drag
      onToggle: () => toggle(false, true),
    },
  })
  return {
    open,
    toggled,
    snapped,
    presence,
    panel,
    glide,
    onGlideEnd: (animationName) => {
      if (animationName.startsWith('contents-glide')) setGlide(null)
    },
    toggle,
  }
}

/**
 * Keep a clicked entry the active one until the reader scrolls by hand: two
 * sections close together would otherwise light the later one, both having
 * passed the top third once the jump lands.
 *
 * @param pane The scrolling page.
 * @returns The pinned entry's id, and a setter (null releases it).
 */
export function usePinnedEntry(
  pane: RefObject<HTMLElement | null>,
): [string | null, (id: string | null) => void] {
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  useEffect(() => {
    const page = pane.current
    if (!page || !pinnedId) return
    const release = () => setPinnedId(null)
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const name of events) page.addEventListener(name, release, { passive: true })
    return () => {
      for (const name of events) page.removeEventListener(name, release)
    }
  }, [pane, pinnedId])
  return [pinnedId, setPinnedId]
}

/**
 * Render the rail, open or folded to its line.
 *
 * @param props Component props.
 * @param props.rail Its panel state, from {@link useContentsRail}.
 * @param props.entries The sections.
 * @param props.activeId The entry to light, the one being read.
 * @param props.onPick Go to an entry.
 * @param props.id The open panel's DOM id, for the toggles' aria-controls.
 * @param props.tour Its `data-tour` anchor.
 * @returns The rail.
 */
export default function ContentsRail({
  rail,
  entries,
  activeId,
  onPick,
  id,
  tour,
}: {
  rail: ContentsRailState
  entries: ContentsEntry[]
  activeId: string | null
  onPick: (id: string) => void
  id: string
  tour: string
}) {
  const { presence, panel } = rail
  if (!presence.present)
    return (
      <button
        type="button"
        className={`contents-rail-folded${rail.toggled ? ' arriving' : ''}`}
        data-tour={tour}
        aria-expanded={false}
        aria-controls={id}
        onClick={() => rail.toggle(true)}
        title="Show contents"
        aria-label="Show contents"
      >
        <span className="contents-rail-bump" aria-hidden="true">
          <svg viewBox="0 0 10 16" width="10" height="16">
            <path
              d="M3 3.5 7.5 8 3 12.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
    )
  return (
    <nav
      className={`contents-rail${rail.toggled ? ' sliding' : ''}${
        presence.closing ? (rail.snapped ? ' closing snap' : ' closing') : ''
      }${panel.dragging ? ' dragging' : ''}`}
      style={{ width: panel.width }}
      onAnimationEnd={presence.onAnimationEnd}
      id={id}
      aria-label="Contents"
      data-tour={tour}
    >
      {/* The list scrolls inside a frame that doesn't, so the handle on
          the frame's edge stays put however far down the list is. */}
      <div className="contents-rail-scroll">
        <p className="contents-rail-label">Contents</p>
        <ol>
          {entries.map((entry) => (
            <li key={entry.id} className={`contents-rail-level-${entry.level}`}>
              <button
                type="button"
                className={entry.id === activeId ? 'active' : undefined}
                aria-current={entry.id === activeId ? 'location' : undefined}
                onClick={() => onPick(entry.id)}
                title={entry.label}
              >
                {entry.number && <span className="contents-rail-number">{entry.number}</span>}
                <span className="contents-rail-title">{entry.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div
        className="contents-rail-handle"
        onPointerDown={panel.onHandlePointerDown}
        title="Drag to resize the contents; drag it narrow to fold them away"
        aria-hidden="true"
      />
      {/* The fold's mirror: the same line and bump, on the panel's inside
          edge, pointing back the way it goes. */}
      <button
        type="button"
        className="contents-rail-hide"
        aria-expanded={true}
        aria-controls={id}
        onClick={() => rail.toggle(false)}
        title="Hide contents"
        aria-label="Hide contents"
      >
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
          <path
            d="M7 3.5 2.5 8 7 12.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </nav>
  )
}
