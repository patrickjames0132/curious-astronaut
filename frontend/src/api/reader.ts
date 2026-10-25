/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader card's document: a paper's HTML render (arXiv's own, else
 * ar5iv's) parsed into sections,
 * blocks and inline runs by `integrations/arxiv/document.py`. The shapes here
 * mirror that module's docstring. Also the PDF view's file and contents,
 * and the papers the bibliography names (`fetchCited`, the citation cards).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { PaperDetails } from './graph'

/** One run of text inside a block. */
export type ReaderInline =
  | { kind: 'text'; text: string; style?: 'italic' | 'bold' | 'code' | 'sup' | 'sub' }
  | { kind: 'math'; latex: string; display: boolean }
  /** A citation marker, tied to its bibliography entry by element id. */
  | { kind: 'cite'; bib: string; text: string }
  /** A jump to a figure, equation or section in the same paper. */
  | { kind: 'ref'; target: string; text: string }
  | { kind: 'link'; href: string; text: string }
  /** A footnote, carrying its own runs. */
  | { kind: 'note'; mark: string; inlines: ReaderInline[] }

/** One cell of a table row. */
export interface ReaderCell {
  inlines: ReaderInline[]
  header: boolean
  colspan?: number
}

/** One panel of a figure, served through the same-origin figure proxy. */
export interface ReaderImage {
  src: string
  alt: string
  width: number | null
  height: number | null
}

/** One block of a section's body. */
export type ReaderBlock =
  | { kind: 'paragraph'; inlines: ReaderInline[] }
  | { kind: 'heading'; inlines: ReaderInline[] }
  | { kind: 'equation'; id: string; latex: string; tag?: string }
  | { kind: 'table'; id: string; rows: ReaderCell[][] }
  | { kind: 'list'; ordered: boolean; items: ReaderBlock[][] }
  /** An algorithm: numbered lines, each indented by `indent` em. */
  | {
      kind: 'listing'
      id: string
      lines: { number: string; indent: number; inlines: ReaderInline[] }[]
    }
  | {
      kind: 'figure'
      id: string
      /** "Figure 2", "Table 1" — the paper's own label. */
      tag: string
      caption: ReaderInline[]
      images: ReaderImage[]
      /** A table float's rows. */
      rows?: ReaderCell[][]
      /** A float that is neither images nor a table (an algorithm box). */
      blocks?: ReaderBlock[]
    }

/** One section, in document order; nesting is carried by `level`. */
export interface ReaderSection {
  id: string
  /** 1 section, 2 subsection, 3 subsubsection, 4 paragraph heading. */
  level: number
  /** "3.2", or "" for unnumbered sections and paragraph headings. */
  number: string
  title: ReaderInline[]
  blocks: ReaderBlock[]
}

/** One reference-list entry. */
export interface ReaderBibEntry {
  /** The element id citations point at (`bib.bib2`). */
  id: string
  /** The marker it's cited by, brackets stripped. */
  label: string
  text: ReaderInline[]
}

/** Why a paper has nothing to read. */
export type ReaderUnavailable = 'not_arxiv' | 'no_render' | 'error'

/** The `/api/paper/<ref>/document` response. */
export type ReaderDocument =
  | {
      available: true
      title: ReaderInline[]
      abstract: ReaderBlock[]
      sections: ReaderSection[]
      bibliography: ReaderBibEntry[]
      /** Who rendered it (v8.39.0): arXiv's own HTML, or ar5iv as the fallback. */
      source?: { name: 'arXiv' | 'ar5iv'; url: string }
    }
  | { available: false; reason: ReaderUnavailable }

/**
 * Fetch a paper's structured document for the Reader card.
 *
 * @param ref The paper's arXiv id (`arxiv_id ?? id`, as for figures).
 * @param signal Aborts the request when the Reader closes.
 * @returns The document, or why there isn't one; a failed request reads as
 *          `error`, never a throw.
 */
export async function fetchDocument(ref: string, signal?: AbortSignal): Promise<ReaderDocument> {
  const res = await fetch(`/api/paper/${encodeURIComponent(ref)}/document`, { signal })
  if (!res.ok) return { available: false, reason: 'error' }
  return res.json()
}

/**
 * Where the Reader's PDF view reads a paper's PDF (v8.40.0): from our own
 * origin, out of the server's PDF cache.
 *
 * @param ref The paper's arXiv id, or its provider id.
 * @param provider Who to ask for a non-arXiv paper's open-access PDF.
 * @returns The URL.
 */
export function pdfUrl(ref: string, provider: string): string {
  return `/api/paper/${encodeURIComponent(ref)}/pdf?provider=${encodeURIComponent(provider)}`
}

/**
 * A paper's PDF table of contents (v8.40.0): its outline, else the headings
 * found in its text.
 *
 * @param ref The paper's arXiv id, or its provider id.
 * @param provider Who to ask for a non-arXiv paper's open-access PDF.
 * @param signal Aborts the request when the view changes.
 * @returns The entries (empty when there are none, or on any failure).
 */
export async function fetchPdfContents(
  ref: string,
  provider: string,
  signal?: AbortSignal,
): Promise<{ title: string; level: number; page: number; top?: number }[]> {
  const res = await fetch(
    `/api/paper/${encodeURIComponent(ref)}/pdf-contents?provider=${encodeURIComponent(provider)}`,
    { signal },
  )
  if (!res.ok) return []
  const data = (await res.json()) as {
    entries?: { title: string; level: number; page: number; top?: number }[]
  }
  return data.entries ?? []
}

/**
 * The papers a Reader document's bibliography names (v8.43.0), for its
 * citation cards: each entry matched to the provider's reference list.
 *
 * @param ref The paper's arXiv id.
 * @param provider Whose papers to match to (the thread's provider).
 * @param signal Aborts the request when the paper changes.
 * @returns The matched papers by bibliography entry id (`bib.bib2`); empty on
 *          any failure, when the cards show the entries' own text.
 */
export async function fetchCited(
  ref: string,
  provider: string,
  signal?: AbortSignal,
): Promise<Record<string, PaperDetails>> {
  const res = await fetch(
    `/api/paper/${encodeURIComponent(ref)}/cited?provider=${encodeURIComponent(provider)}`,
    { signal },
  )
  if (!res.ok) return {}
  const data = (await res.json()) as { papers?: Record<string, PaperDetails> }
  return data.papers ?? {}
}

/**
 * Where a passage is in a PDF (v8.45.0): a 1-based page and rectangles on
 * it, `[x0, y0, x1, y1]` in PDF points from the page's top-left, the space
 * pdf.js draws a page in at scale 1 (and pymupdf reads it in, server-side).
 */
export interface PdfPlace {
  page: number
  rects: number[][]
}

/** A point on a PDF's page, in points from its left and top edges (v8.45.0). */
export interface PdfPoint {
  page: number
  left: number
  top: number
}

/**
 * What a highlight in the PDF view covers (v8.45.0): the PDF's own words
 * from where the drag began to where it ended, in reading order, across
 * columns and pages, which the browser's reading of pdf.js's text layer
 * isn't, and their lines' rectangles.
 *
 * A box drawn over the PDF (v8.46.0) is read the same way, by its places:
 * the words inside it.
 *
 * @param ref The paper's arXiv id, or its provider id.
 * @param provider Who to ask for a non-arXiv paper's open-access PDF.
 * @param where Where the drag began and ended (`span`), or a box's places.
 * @returns The words and places; empty on any failure.
 */
export async function fetchPdfPassage(
  ref: string,
  provider: string,
  where: { span: { start: PdfPoint; end: PdfPoint } } | { places: PdfPlace[] },
): Promise<{ text: string; places: PdfPlace[] }> {
  const none = { text: '', places: [] }
  try {
    const res = await fetch(
      `/api/paper/${encodeURIComponent(ref)}/pdf-passage?provider=${encodeURIComponent(provider)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(where),
      },
    )
    if (!res.ok) return none
    const data = (await res.json()) as { text?: string; places?: PdfPlace[] }
    return { text: data.text ?? '', places: data.places ?? [] }
  } catch {
    return none
  }
}

/**
 * Where an answer's quotes are in a paper's PDF (v8.45.0).
 *
 * @param ref The paper's arXiv id, or its provider id.
 * @param provider Who to ask for a non-arXiv paper's open-access PDF.
 * @param quotes The quotes.
 * @param signal Aborts the request when the lit passages change.
 * @returns One list of places per quote, in order (empty for one not found,
 *          and for all of them on any failure).
 */
export async function findPdfQuotes(
  ref: string,
  provider: string,
  quotes: string[],
  signal?: AbortSignal,
): Promise<PdfPlace[][]> {
  const none = quotes.map((): PdfPlace[] => [])
  const res = await fetch(
    `/api/paper/${encodeURIComponent(ref)}/pdf-find?provider=${encodeURIComponent(provider)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotes }),
      signal,
    },
  )
  if (!res.ok) return none
  const data = (await res.json()) as { found?: PdfPlace[][] }
  return data.found ?? none
}
