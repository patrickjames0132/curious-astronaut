/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What the Reader's runs share with the page around them: the context a
 * citation or ref reads to jump, the DOM ids paper elements render under, and
 * a run list as plain text. Apart from `ReaderBody.tsx` so that file exports
 * components only (fast refresh).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { createContext } from 'react'
import type { AnswerFigure, ReaderBibEntry, ReaderInline } from '../api'

/** What a citation does with its card (v8.43.0). */
interface CiteCard {
  /** The pointer is on a citation: preview its card after a moment. */
  hover: (bib: string, anchor: HTMLElement) => void
  /** The pointer left it: let a preview go after a moment. */
  leave: () => void
  /** A click: open the card and keep it open. */
  pin: (bib: string, anchor: HTMLElement) => void
  /** The entry whose card is open, for `aria-expanded`. */
  open: string | null
}

/** What a run needs from the page around it. */
interface ReaderLinks {
  /** Bibliography entries by element id, for a citation's card. */
  bibliography: Map<string, ReaderBibEntry>
  /** The citation card's controls. */
  cite: CiteCard
  /** Scroll the page to one of the paper's own element ids. */
  jump: (target: string) => void
  /** Open a figure panel in the shared lightbox. */
  enlarge: (figure: AnswerFigure) => void
}

export const ReaderLinksContext = createContext<ReaderLinks>({
  bibliography: new Map(),
  cite: { hover: () => {}, leave: () => {}, pin: () => {}, open: null },
  jump: () => {},
  enlarge: () => {},
})

/**
 * The DOM id a paper element renders under. ar5iv's ids (`S3.F1`) are only
 * unique within the paper, so they're prefixed to stay clear of the app's own.
 *
 * @param id The paper's element id.
 * @returns The id to put in the DOM.
 */
export function readerDomId(id: string): string {
  return `reader-${id}`
}

/**
 * The DOM id of a page in the PDF view (v8.40.0), for jumps.
 *
 * @param page The 1-based page.
 * @returns Its id.
 */
export function pdfPageId(page: number): string {
  return readerDomId(`page:${page}`)
}

/**
 * A run list as plain text, for tooltips and accessible labels.
 *
 * @param inlines The runs.
 * @returns Their text, math kept as its LaTeX source.
 */
export function plainText(inlines: ReaderInline[]): string {
  return inlines
    .map((run) => {
      if (run.kind === 'math') return run.latex
      if (run.kind === 'note') return ''
      return run.text
    })
    .join('')
}

/**
 * A run list as a `MathText` string: text as is, math fenced in `$…$`. For
 * surfaces shared with the rest of the app that take a string (the lightbox's
 * caption).
 *
 * @param inlines The runs.
 * @returns The string, footnotes left out.
 */
export function mathTextOf(inlines: ReaderInline[]): string {
  return inlines
    .map((run) => {
      if (run.kind === 'math') return `$${run.latex}$`
      if (run.kind === 'note') return ''
      return run.text
    })
    .join('')
}
