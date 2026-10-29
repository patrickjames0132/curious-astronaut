/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A criticism note beside a passage of the paper (v8.54.0): the criticisms
 * from the paper's Criticisms card that apply there, each by its number and
 * headline, a button opening its card (`CriticismCard`). Outlined in the
 * card's sage, the Knowledge Graph notes' shape (Patrick: "just like we do
 * for the knowledge graph"), and laid out with them (`useMarginNotes`), but
 * tied to its **passage**, not a heading: the reviewer quoted the words the
 * criticism is about, and the note finds them. Hovering the note lights the
 * passage, in sage.
 *
 * In the text view the note finds its quote in its own section; in the PDF
 * view it is handed the places the server found (`useCriticismPdfNotes`).
 * Either way it registers where its passage is (`noteAnchors`), so the
 * layout can set it level with the passage and run its curve there.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { Criticism, PdfPlace } from '../api'
import { NOTES_CHANGED, type CardControls } from './links'
import { findQuote, indexText } from './passages'
import { noteAnchors } from './useMarginNotes'

/** What hovering a note lights: its passage, as text ranges or PDF places. */
export type CriticismLight = { ranges: Range[] } | { places: PdfPlace[] }

/**
 * The card id a note's chip opens: its note and its criticism's number.
 *
 * @param slot The note.
 * @param number The criticism's number.
 * @returns The id; `criticismOf` reads the number back.
 */
export function criticismChipId(slot: string, number: number): string {
  return `${slot}|${number}`
}

/**
 * The criticism a chip's card id names.
 *
 * @param id The card id (`criticismChipId`).
 * @returns The criticism's number.
 */
export function criticismOf(id: string): number {
  return Number(id.slice(id.lastIndexOf('|') + 1))
}

/**
 * The note.
 *
 * @param props Component props.
 * @param props.slot Which note this is, for its chips' card ids.
 * @param props.numbers The card's numbers for its criticisms, from 1.
 * @param props.criticisms The card's criticisms, in its order.
 * @param props.quote Its passage, in the paper's words (the text view finds
 *        it in the note's section).
 * @param props.places Its passage in the PDF, when it's there.
 * @param props.card The criticism card's controls.
 * @param props.onLight Light its passage while hovered (null: put it out).
 * @returns The note, or nothing when none of its criticisms is on the card.
 */
export default function CriticismNote({
  slot,
  numbers,
  criticisms,
  quote,
  places,
  card,
  onLight,
}: {
  slot: string
  numbers: number[]
  criticisms: Criticism[]
  quote: string
  places?: PdfPlace[]
  card: CardControls
  onLight: (light: CriticismLight | null) => void
}) {
  const note = useRef<HTMLElement>(null)
  const [ranges, setRanges] = useState<Range[]>([])
  // Where the passage is: found in the section's text, or the PDF's places
  // turned to the screen; registered for the margin's layout, which is told.
  useLayoutEffect(() => {
    const element = note.current
    if (!element) return
    let found: Range[] = []
    if (!places) {
      const section = element.closest('section')
      found = section ? findQuote(indexText(section), quote) : []
      setRanges(found)
    }
    noteAnchors.set(element, () => {
      if (places) {
        const page = element.closest<HTMLElement>('.reader-pdf-page')
        const rect = places[0]?.rects[0]
        if (!page || !rect) return null
        const scale = Number(page.dataset.scale) || 1
        const box = page.getBoundingClientRect()
        const [, top, right, bottom] = rect
        return { right: box.left + right * scale, middle: box.top + ((top + bottom) / 2) * scale }
      }
      const first = found[0]
      if (!first || typeof first.getClientRects !== 'function') return null
      const line = first.getClientRects()[0]
      return line ? { right: line.right, middle: (line.top + line.bottom) / 2 } : null
    })
    element.dispatchEvent(new Event(NOTES_CHANGED, { bubbles: true }))
    return () => {
      noteAnchors.delete(element)
    }
  }, [quote, places])

  const shown = numbers.filter((number) => criticisms[number - 1])
  if (!shown.length) return null
  const light = () => onLight(places ? { places } : ranges.length ? { ranges } : null)
  return (
    <aside
      ref={note}
      className="reader-concepts reader-criticisms"
      aria-label="From the Criticisms card"
      data-tour="reader-criticisms"
      onPointerEnter={light}
      onPointerLeave={() => onLight(null)}
      onFocus={light}
      onBlur={() => onLight(null)}
    >
      {/* The faint curve to the passage, drawn by useMarginNotes when the
          note sits in the margin. */}
      <svg className="reader-concepts-link" aria-hidden="true">
        <path />
      </svg>
      <span className="reader-concepts-label">Criticisms</span>
      {shown.map((number) => {
        const criticism = criticisms[number - 1]
        const cardId = criticismChipId(slot, number)
        return (
          <button
            key={number}
            type="button"
            className="reader-criticism"
            aria-haspopup="dialog"
            aria-expanded={card.open === cardId}
            title={`Criticism ${number}: ${criticism.name}`}
            onPointerEnter={(event) => card.hover(cardId, event.currentTarget)}
            onPointerLeave={() => card.leave()}
            onClick={(event) => card.pin(cardId, event.currentTarget)}
          >
            <span className="reader-criticism-number">{number}</span>
            <span className="reader-concept-name">{criticism.name}</span>
          </button>
        )
      })}
    </aside>
  )
}
