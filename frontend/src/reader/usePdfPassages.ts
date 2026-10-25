/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The lit passages in the PDF view (v8.45.0), as places: pages and
 * rectangles, which the pages draw as boxes over themselves (`PdfView`).
 *
 * - **The passage a question was asked about** is lit where it was
 *   highlighted: the user turn keeps its places (`ChatMsg.places`).
 * - **An answer's quotes** are found by the server in the PDF's own words
 *   (`/pdf-find`, pymupdf), which come in reading order with their boxes. A
 *   passage with no places (asked in the text view, or before places were
 *   kept) is found the same way, by its prose and a part-formula's glyphs:
 *   its LaTeX is nowhere in a PDF.
 *
 * This replaced lighting pdf.js's text layer: that layer is in the order
 * the PDF was written, not read, so matching words in it lit an equation's
 * glyphs between a sentence's words, and only pages already drawn could be
 * lit at all (Patrick: "very noisy"). Places need no drawn page, so going to
 * one is a plain scroll.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState, type RefObject } from 'react'
import { findPdfQuotes, type PdfPlace } from '../api'
import { glide } from './glide'
import { passageParts } from './passages'

/** Nothing lit: one array, so the default never changes identity. */
const NO_PLACES: PdfPlace[] = []

/** What to light: the asked-about passage (by its places, else its words
 *  and labels) and an answer's quotes. */
export interface PdfLight {
  passage: string | null
  places: PdfPlace[]
  /** What the passage covers by label (v8.48.0): "Figure 1", "(6)". */
  labels: string[]
  quotes: string[]
}

/**
 * Whether part of a passage asked in the text view has no place in the PDF:
 * a label not found, a formula with no number to find it by (its LaTeX is
 * nowhere in a PDF), or words found nowhere.
 *
 * @param light What was asked to light.
 * @param wordsFound Whether any of the passage's words were found.
 * @param labelled Each label's places, in order.
 * @returns True when the reader should be told (`Reader`'s note).
 */
export function partMissing(light: PdfLight, wordsFound: boolean, labelled: PdfPlace[][]): boolean {
  if (light.places.length || !light.passage) return false
  if (labelled.some((places) => !places.length)) return true
  const { prose, formulas } = passageParts(light.passage)
  const numbered = light.labels.filter((label) => label.startsWith('(')).length
  if (formulas.length > numbered) return true
  return prose.length > 0 && !wordsFound && !labelled.length
}

/** Frames to wait for a page to be laid out before giving up (~5s). */
const PAGE_WAIT = 300
/** How long a page's scale must hold before landing on it, in ms. */
const SCALE_SETTLED = 250

/**
 * Scroll a pane so a place's first rectangle sits a third of the way down,
 * once its page is laid out at its settled scale. Arriving from the text
 * view, the PDF is still opening: its pages are sized at once, then fit the
 * pane's width when it settles, and PdfView keeps the page that was in view
 * across a change of scale. Landing before that put the reader back at the
 * top (seen live, 2026-10-25).
 *
 * @param pane The scrolling pane, holding the pages (`.reader-pdf-page`).
 * @param place The place.
 * @returns Stops waiting for the page.
 */
export function scrollToPlace(pane: HTMLElement, place: PdfPlace): () => void {
  let frame = 0
  let tries = 0
  let scale = ''
  let since = 0
  const attempt = (now: number) => {
    const element = pane.querySelectorAll<HTMLElement>('.reader-pdf-page')[place.page - 1]
    const current = element?.dataset.scale ?? ''
    if (current !== scale) {
      scale = current
      since = now
    }
    if (element && (now - since >= SCALE_SETTLED || tries >= PAGE_WAIT))
      landOn(pane, element, place)
    else if (tries++ < PAGE_WAIT) frame = requestAnimationFrame(attempt)
  }
  frame = requestAnimationFrame(attempt)
  return () => cancelAnimationFrame(frame)
}

/**
 * Scroll a pane to a place on a page that's laid out.
 *
 * @param pane The scrolling pane.
 * @param element The place's page.
 * @param place The place.
 */
function landOn(pane: HTMLElement, element: HTMLElement, place: PdfPlace) {
  const first = place.rects[0]
  if (!first) return
  glide(pane, () => {
    const scale = Number(element.dataset.scale) || 1
    const top = element.getBoundingClientRect().top - pane.getBoundingClientRect().top
    return pane.scrollTop + top + first[1] * scale - pane.clientHeight / 3
  })
}

/**
 * The places to light in a PDF, found as needed; goes to the first when asked.
 *
 * @param paper The paper's ref and provider, or null when there's no PDF.
 * @param paper.ref The paper's arXiv id, or its provider id.
 * @param paper.provider Who to ask for a non-arXiv paper's open-access PDF.
 * @param root The scrolling pane.
 * @param light What to light, or null for nothing.
 * @param scrollAsk Changes when the reader asked to go there.
 * @returns The places lit, the asked-about passage's first, and whether
 *          part of that passage has no place here (`partMissing`).
 */
export function usePdfPassages(
  paper: { ref: string; provider: string } | null,
  root: RefObject<HTMLElement | null>,
  light: PdfLight | null,
  scrollAsk: number,
): { lit: PdfPlace[]; missing: boolean } {
  const [lit, setLit] = useState<PdfPlace[]>(NO_PLACES)
  const [missing, setMissing] = useState(false)
  const seen = useRef(scrollAsk)
  // The paper the light was last shown for: none means the text view, so
  // arriving in the PDF view with something lit goes to it (Patrick).
  const shownFor = useRef<string | null>(null)
  const ref = paper?.ref
  const provider = paper?.provider

  useEffect(() => {
    const arrived = !!ref && shownFor.current !== ref
    shownFor.current = ref ?? null
    const scroll = scrollAsk !== seen.current || arrived
    seen.current = scrollAsk
    setMissing(false)
    if (!ref || !provider || !light) {
      setLit(NO_PLACES)
      return
    }
    let stopScrolling = () => {}
    const show = (found: PdfPlace[]) => {
      setLit(found.length ? found : NO_PLACES)
      const pane = root.current
      if (scroll && pane && found[0]) stopScrolling = scrollToPlace(pane, found[0])
    }
    // The passage's own places light at once; what must be searched for
    // joins them when the server answers.
    // A passage asked in the text view has no places: its prose and a
    // part-formula's glyphs are searched for, its LaTeX (nowhere in a PDF)
    // isn't.
    // Its labels are found as places too: a float's region, an equation's
    // line (v8.48.0).
    const words = light.places.length || !light.passage ? [] : passageParts(light.passage).prose
    const labels = light.places.length ? [] : light.labels
    const sought = [...words, ...light.quotes]
    if (!sought.length && !labels.length) {
      show(light.places)
      return () => stopScrolling()
    }
    if (light.places.length) setLit(light.places)
    const controller = new AbortController()
    findPdfQuotes(ref, provider, sought, labels, controller.signal)
      .then(({ found, labelled }) => {
        const wordsFound = found.slice(0, words.length).some((places) => places.length > 0)
        setMissing(partMissing(light, wordsFound, labelled))
        // The passage first (its labels, then its words), then the quotes.
        show([...light.places, ...labelled.flat(), ...found.flat()])
      })
      .catch(() => {
        if (!controller.signal.aborted) show(light.places)
      })
    return () => {
      controller.abort()
      stopScrolling()
    }
  }, [ref, provider, root, light, scrollAsk])

  return { lit, missing }
}
