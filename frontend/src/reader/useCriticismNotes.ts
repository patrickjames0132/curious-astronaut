/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader's criticism notes (v8.54.0): the paper's Criticisms card,
 * pinned by the reviewer to the passages it is about (`/api/reviews/notes`),
 * each pin a criticism's number, a section and a quote in the paper's own
 * words. Only once the card has been gathered (Patrick): no card, no notes,
 * and the Reader never starts a gather. Asked once per paper and view's
 * source; the server caches the pins with the card.
 *
 * Pins that point at one passage share one note. In the text view each note
 * finds its quote in its own section (`CriticismNote`); in the PDF view
 * (`useCriticismPdfNotes`) the quotes are found in the PDF's own words by
 * the server (`/pdf-find`), so the text's pins serve the PDF too.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useMemo, useState } from 'react'
import {
  fetchCriticismNotes,
  findPdfQuotes,
  type CriticisedPaper,
  type Criticism,
  type CriticismPin,
  type PdfPlace,
} from '../api'

/** One note: a passage, and the criticisms that apply there. */
export interface CriticismNoteData {
  /** A stable key: its section and passage. */
  key: string
  section: string
  quote: string
  /** The card's numbers for its criticisms, from 1, in order. */
  numbers: number[]
}

/** No notes: one array, so the default never changes identity. */
const NO_NOTES: CriticismNoteData[] = []

/**
 * Pins grouped into notes: one per passage, in the paper's order.
 *
 * @param pins The pins, in the paper's order.
 * @returns The notes.
 */
export function notesOf(pins: CriticismPin[]): CriticismNoteData[] {
  const notes: CriticismNoteData[] = []
  for (const pin of pins) {
    const key = `${pin.section}|${pin.quote}`
    const known = notes.find((note) => note.key === key)
    if (known) {
      if (!known.numbers.includes(pin.criticism)) known.numbers.push(pin.criticism)
    } else notes.push({ key, section: pin.section, quote: pin.quote, numbers: [pin.criticism] })
  }
  for (const note of notes) note.numbers.sort((first, second) => first - second)
  return notes
}

/**
 * The paper's criticism notes.
 *
 * @param paper The thread's paper, the card's key; null for none.
 * @param target What the Reader reads; null for no notes.
 * @param target.document The arXiv id, or a provider id for the PDF.
 * @param target.source The text's sections or the PDF's contents.
 * @param target.provider Who to ask for a non-arXiv paper's PDF.
 * @returns The card's criticisms (empty without a card) and the notes.
 */
export function useCriticismNotes(
  paper: CriticisedPaper | null,
  target: { document: string; source: 'text' | 'pdf'; provider?: string } | null,
): { criticisms: Criticism[]; notes: CriticismNoteData[] } {
  const [answer, setAnswer] = useState<{ criticisms: Criticism[]; notes: CriticismNoteData[] }>({
    criticisms: [],
    notes: NO_NOTES,
  })
  const paperId = paper?.id
  const { document, source, provider } = target ?? {}
  useEffect(() => {
    setAnswer({ criticisms: [], notes: NO_NOTES })
    if (!paper || !document || !source) return
    const controller = new AbortController()
    fetchCriticismNotes(paper, { document, source, provider }, controller.signal)
      .then(({ card, pins }) =>
        setAnswer({
          criticisms: card?.themes ?? [],
          notes: pins.length ? notesOf(pins) : NO_NOTES,
        }),
      )
      .catch((error: unknown) => {
        // A nicety: the paper reads the same without its notes.
        if (!controller.signal.aborted)
          console.warn('[reader] placing the criticisms failed', error)
      })
    return () => controller.abort()
    // The paper by its id: the thread's object changes identity on every save.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, document, source, provider])
  return answer
}

/** A note in the PDF view: where its passage is. */
export interface CriticismPdfNote extends CriticismNoteData {
  /** Where the passage is, from the server's search of the PDF's words. */
  places: PdfPlace[]
}

/**
 * The notes' passages, found in the PDF: a note whose quote isn't there has
 * no note in the PDF.
 *
 * @param paper The PDF: the paper's arXiv id or provider id, and provider;
 *        null outside the PDF view.
 * @param paper.ref The arXiv id or provider id.
 * @param paper.provider Who to ask for a non-arXiv paper's PDF.
 * @param notes The notes.
 * @returns The notes found, each with its places.
 */
export function useCriticismPdfNotes(
  paper: { ref: string; provider: string } | null,
  notes: CriticismNoteData[],
): CriticismPdfNote[] {
  const [found, setFound] = useState<CriticismPdfNote[]>([])
  const ref = paper?.ref
  const provider = paper?.provider
  const quotesKey = useMemo(() => notes.map((note) => note.key).join('\n'), [notes])
  useEffect(() => {
    setFound([])
    if (!ref || !provider || !notes.length) return
    const controller = new AbortController()
    findPdfQuotes(
      ref,
      provider,
      notes.map((note) => note.quote),
      [],
      controller.signal,
    )
      .then(({ found: places }) =>
        setFound(
          notes.flatMap((note, index) =>
            places[index]?.length ? [{ ...note, places: places[index] }] : [],
          ),
        ),
      )
      .catch(() => {}) // a nicety, as above
    return () => controller.abort()
    // The notes by their keys.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, provider, quotesKey])
  return found
}
