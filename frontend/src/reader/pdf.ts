/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * pdf.js for the Reader's PDF view (v8.40.0): loaded on first use, so the
 * app's start-up pays nothing for it, and a PDF's own outline (its
 * bookmarks) resolved to pages, and places on them, for the contents panel.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'

type PdfJs = typeof import('pdfjs-dist')

/** pdf.js, once loaded: the library and its worker, fetched together. */
let library: Promise<PdfJs> | null = null

/**
 * pdf.js, loading it (and pointing it at its worker) the first time.
 *
 * @returns The library.
 */
export function pdfjs(): Promise<PdfJs> {
  library ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })
  return library
}

/** One entry of a PDF's outline, as the contents panel lists it. */
export interface PdfOutlineEntry {
  title: string
  /** 1 for a top-level entry, 2 for one under it. */
  level: number
  /** The 1-based page it points at. */
  page: number
  /** How far down that page, in PDF points from its top edge, when known:
   *  two sections often start on one page. */
  top?: number
}

/** Outline entries deeper than this stay out of the contents, as sections do. */
const OUTLINE_DEPTH = 2

/**
 * Where a destination points: its page, and how far down it.
 *
 * An explicit destination is `[page, {name: kind}, ...args]` in the page's
 * own bottom-up coordinates; `XYZ` (hyperref's) carries its top as the
 * second argument, `FitH` and `FitBH` as the first.
 *
 * @param pdf The document.
 * @param dest A named or explicit destination.
 * @returns Its 1-based page (0 when it can't be resolved), and its top in
 *          points from the page's top edge when the destination gives one.
 */
async function placeOf(
  pdf: PDFDocumentProxy,
  dest: unknown,
): Promise<{ page: number; top?: number }> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit[0] == null) return { page: 0 }
    const target = explicit[0]
    const index = typeof target === 'number' ? target : await pdf.getPageIndex(target)
    const kind = (explicit[1] as { name?: string } | undefined)?.name
    const raw =
      kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : null
    if (typeof raw !== 'number') return { page: index + 1 }
    const [, bottom, , top] = (await pdf.getPage(index + 1)).view
    const fromTop = top - raw
    return { page: index + 1, top: fromTop >= 0 && fromTop < top - bottom ? fromTop : undefined }
  } catch {
    return { page: 0 }
  }
}

/**
 * A PDF's outline, flattened to two levels, each entry with its page.
 *
 * @param pdf The document.
 * @returns The entries in order; empty when the PDF has no outline (many
 *          papers don't).
 */
export async function outlineOf(pdf: PDFDocumentProxy): Promise<PdfOutlineEntry[]> {
  const outline = await pdf.getOutline().catch(() => null)
  if (!outline) return []
  const entries: PdfOutlineEntry[] = []
  const walk = async (items: typeof outline, level: number) => {
    for (const item of items) {
      const { page, top } = await placeOf(pdf, item.dest)
      if (page && item.title.trim()) entries.push({ title: item.title.trim(), level, page, top })
      if (level < OUTLINE_DEPTH && item.items?.length) await walk(item.items, level + 1)
    }
  }
  await walk(outline, 1)
  return entries
}
