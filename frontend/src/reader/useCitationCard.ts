/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Which citation card is open, and when (v8.43.0). Hovering a citation
 * previews its card after a moment, so a pointer passing over the text
 * doesn't flash cards; the preview stays while the pointer is on the citation
 * or the card, and goes a moment after it leaves both. A click pins the card
 * (a second click on the same citation unpins it); a pinned card stays until
 * its ×, Esc, or a click elsewhere, and hovering other citations meanwhile
 * leaves it be.
 *
 * The card sits in the reading pane's scrolled content, under the citation
 * (above it when there's no room below), so it scrolls with the text.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { CardPlacement } from './CitationCard'

/** How long the pointer rests on a citation before its card shows, ms. */
const SHOW_DELAY = 250
/** How long after the pointer leaves before a preview goes, ms. */
const HIDE_DELAY = 200
/** The card's width (`reader.css`), for keeping it inside the pane. */
const CARD_WIDTH = 360
/** Room a card needs below its citation before it opens upward instead. */
const CARD_ROOM = 260
/** Space between the citation and the card, and the card and the pane's edge. */
const MARGIN = 8

/** The open card: whose, where, and whether a click pinned it. */
export interface OpenCard {
  bib: string
  placement: CardPlacement
  pinned: boolean
}

/**
 * Where a card for a citation goes in the pane's scrolled content.
 *
 * @param anchor The citation.
 * @param pane The scrolling reading pane.
 * @returns Its placement.
 */
function place(anchor: HTMLElement, pane: HTMLElement): CardPlacement {
  const box = anchor.getBoundingClientRect()
  const frame = pane.getBoundingClientRect()
  const above = frame.bottom - box.bottom < CARD_ROOM && box.top - frame.top > CARD_ROOM
  const left = Math.max(
    MARGIN,
    Math.min(box.left - frame.left + pane.scrollLeft - 16, pane.clientWidth - CARD_WIDTH - MARGIN),
  )
  const top = (above ? box.top - MARGIN : box.bottom + MARGIN) - frame.top + pane.scrollTop
  return { top, left, above }
}

/**
 * The citation card's state and the handlers that drive it.
 *
 * @param paneRef The reading pane the card sits in.
 * @returns The open card (or null), the citations' controls, and the card's
 *          own: close it, keep a preview while hovered, let it go.
 */
export function useCitationCard(paneRef: RefObject<HTMLElement | null>) {
  const [card, setCard] = useState<OpenCard | null>(null)
  const cardRef = useRef(card)
  cardRef.current = card
  const showTimer = useRef(0)
  const hideTimer = useRef(0)

  const clearTimers = () => {
    window.clearTimeout(showTimer.current)
    window.clearTimeout(hideTimer.current)
  }
  const close = useCallback(() => {
    clearTimers()
    setCard(null)
  }, [])
  const open = useCallback(
    (bib: string, anchor: HTMLElement, pinned: boolean) => {
      const pane = paneRef.current
      if (pane) setCard({ bib, placement: place(anchor, pane), pinned })
    },
    [paneRef],
  )

  const hover = useCallback(
    (bib: string, anchor: HTMLElement) => {
      clearTimers()
      const current = cardRef.current
      if (current?.pinned || current?.bib === bib) return
      // One preview already showing: the next follows the pointer at once.
      if (current) open(bib, anchor, false)
      else showTimer.current = window.setTimeout(() => open(bib, anchor, false), SHOW_DELAY)
    },
    [open],
  )
  const release = useCallback(() => {
    window.clearTimeout(showTimer.current)
    if (cardRef.current && !cardRef.current.pinned)
      hideTimer.current = window.setTimeout(() => setCard(null), HIDE_DELAY)
  }, [])
  const keep = useCallback(() => window.clearTimeout(hideTimer.current), [])
  const pin = useCallback(
    (bib: string, anchor: HTMLElement) => {
      clearTimers()
      if (cardRef.current?.pinned && cardRef.current.bib === bib) setCard(null)
      else open(bib, anchor, true)
    },
    [open],
  )

  // A pinned card goes on Esc or a click elsewhere (a citation's own click
  // is the toggle above, so it doesn't count as elsewhere).
  useEffect(() => {
    if (!card?.pinned) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    const onDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.reader-cite')) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [card?.pinned, close])
  useEffect(() => clearTimers, [])

  const cite = useMemo(
    () => ({ hover, leave: release, pin, open: card?.bib ?? null }),
    [hover, release, pin, card?.bib],
  )
  return { card, cite, close, keep, release }
}
