/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader's PDF view (v8.40.0): the paper's PDF, served from our origin by
 * `/api/paper/<ref>/pdf` out of the on-disk cache, drawn by pdf.js. Shown
 * when a paper has no HTML render, or when the reader switches to it.
 *
 * Every page is sized up front from its own dimensions, so the scroll and
 * the jumps are right before anything is drawn; a page is drawn (a canvas at
 * the screen's pixel ratio, and pdf.js's transparent text layer over it, which
 * makes the text selectable) when it comes within a screen or so of view,
 * and kept, so a selection in it never vanishes under a re-render. Each page
 * carries `data-passage-from` and `data-section-id` (`page:<n>`) like the
 * text view's sections, so the highlight menu and the assistant work as they
 * do there, and `data-scale`, so the contents can find a heading's place on
 * it.
 *
 * Pages fit the pane's width, but only once it has settled: the contents
 * panel slides in and out, and a drag resizes it, and following every frame
 * of that redrew every drawn page on every frame (the fold was laggy). When
 * the scale changes for any reason, the reading position is kept: the page at
 * the top of the pane stays there, the same fraction of the way down.
 *
 * The reader can zoom (v8.44.0): the fitted width times `zoom`, wider than
 * the pane when they like, scrolled sideways then.
 *
 * Since v8.44.0 a page can carry notes in the margin beside it (the
 * Knowledge Graph notes), each at a place on the page; with any, the pages
 * leave `margin` pixels to their right for them.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfPlace } from '../api'
import type { DrawnBox } from './useBoxDraw'
import { PDF_TEXT_DRAWN, pdfPageId } from './links'
import { outlineOf, pdfjs, type PdfOutlineEntry } from './pdf'

/** Something shown in the margin beside a page (v8.44.0). */
export interface PdfMarginNote {
  /** A stable key among the page's notes. */
  key: string
  page: number
  /** How far down the page, in PDF points from its top edge. */
  top: number
  /** The heading it belongs to, so its connector can find it in the text
   *  layer (`useMarginNotes`). */
  title: string
  node: ReactNode
}

/** A page's size at scale 1, in PDF points. */
interface PageSize {
  width: number
  height: number
}

/** The widest a page is drawn, in CSS pixels, however wide the pane. */
const MAX_PAGE_WIDTH = 900
/** Room left beside a page, each side. */
const GUTTER = 24
/** No notes: one array, so the default never changes identity. */
const NO_NOTES: PdfMarginNote[] = []
/** Nothing lit, likewise. */
const NO_PLACES: PdfPlace[] = []
/** How far beyond the visible pane a page starts drawing. */
const DRAW_AHEAD = '1200px 0px'
/** How long the pane's width must hold before the pages follow it, in ms:
 *  past the contents panel's slide. */
const SETTLE = 200

/**
 * One page: sized at once, drawn when near the view.
 *
 * @param props Component props.
 * @param props.pdf The document.
 * @param props.page The 1-based page number.
 * @param props.size Its size at scale 1.
 * @param props.scale The scale to draw at.
 * @param props.root The scrolling pane, for drawing ahead of the view.
 * @param props.notes Its margin notes.
 * @param props.lit Rectangles to light on it, in PDF points (v8.45.0).
 * @param props.drawn A box being drawn or drawn on it, in PDF points
 *   (v8.46.0, `useBoxDraw`), or null.
 * @returns The page.
 */
function PdfPage({
  pdf,
  page,
  size,
  scale,
  root,
  notes,
  lit,
  drawn,
}: {
  pdf: PDFDocumentProxy
  page: number
  size: PageSize
  scale: number
  root: RefObject<HTMLElement | null>
  notes: PdfMarginNote[]
  lit: number[][]
  drawn: number[] | null
}) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const element = box.current
    if (!element || near) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { root: root.current, rootMargin: DRAW_AHEAD },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near, root])

  useEffect(() => {
    if (!near || !canvas.current || !text.current) return
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null
    let textLayer: { cancel: () => void } | null = null
    const draw = async () => {
      const [lib, proxy] = await Promise.all([pdfjs(), pdf.getPage(page)])
      if (cancelled || !canvas.current || !text.current) return
      const viewport = proxy.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      const target = canvas.current
      target.width = Math.floor(viewport.width * ratio)
      target.height = Math.floor(viewport.height * ratio)
      renderTask = proxy.render({
        canvas: target,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      })
      await renderTask.promise
      if (cancelled || !text.current) return
      text.current.replaceChildren()
      const layer = new lib.TextLayer({
        textContentSource: proxy.streamTextContent(),
        container: text.current,
        viewport,
      })
      textLayer = layer
      await layer.render()
      // The sheet a drag lands on between words (`.endOfContent` in reader.css).
      const sheet = document.createElement('div')
      sheet.className = 'endOfContent'
      text.current?.append(sheet)
      if (!cancelled) box.current?.dispatchEvent(new Event(PDF_TEXT_DRAWN, { bubbles: true }))
    }
    draw().catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException'))
        console.warn('[reader] PDF page failed to draw', page, error)
    })
    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [near, pdf, page, scale])

  return (
    <div
      ref={box}
      id={pdfPageId(page)}
      className="reader-pdf-page"
      data-section-id={`page:${page}`}
      data-passage-from={`page ${page}`}
      data-scale={scale}
      style={
        {
          width: size.width * scale,
          height: size.height * scale,
          '--total-scale-factor': scale,
        } as CSSProperties
      }
    >
      <canvas ref={canvas} className="reader-pdf-canvas" aria-hidden="true" />
      {lit.map(([left, top, right, bottom], index) => (
        <div
          key={index}
          className="reader-pdf-lit"
          aria-hidden="true"
          style={{
            left: left * scale,
            top: top * scale,
            width: (right - left) * scale,
            height: (bottom - top) * scale,
          }}
        />
      ))}
      {drawn && (
        <div
          className="reader-pdf-box"
          aria-hidden="true"
          style={{
            left: drawn[0] * scale,
            top: drawn[1] * scale,
            width: (drawn[2] - drawn[0]) * scale,
            height: (drawn[3] - drawn[1]) * scale,
          }}
        />
      )}
      <div ref={text} className="textLayer" />
      {notes.map((note) => (
        <div
          key={note.key}
          className="reader-pdf-note"
          style={{ top: note.top * scale }}
          data-title={note.title}
        >
          {note.node}
        </div>
      ))}
    </div>
  )
}

/**
 * Render a paper's PDF.
 *
 * @param props Component props.
 * @param props.url Where to read it (the same-origin PDF route).
 * @param props.root The scrolling pane the pages sit in.
 * @param props.textRef Set to the element holding the pages, for the
 *   highlight menu.
 * @param props.onLoaded Told the page count and the PDF's outline once open.
 * @param props.onFailed Told why the PDF couldn't be opened.
 * @param props.notes Notes for the margin beside the pages (v8.44.0).
 * @param props.margin The room the notes need to the pages' right, in
 *   pixels; 0 without notes.
 * @param props.zoom How much larger than fitting the pane's width to draw
 *   the pages (v8.44.0); 1 fits.
 * @param props.lit What a Reader Assistant answer is about, to light as
 *   boxes over the pages (v8.45.0, `usePdfPassages`).
 * @param props.box A box drawn over a page with ⌥-drag (v8.46.0), or null.
 * @returns The pages, or a loading line.
 */
export default function PdfView({
  url,
  root,
  textRef,
  onLoaded,
  onFailed,
  notes = NO_NOTES,
  margin = 0,
  zoom = 1,
  lit = NO_PLACES,
  box = null,
}: {
  url: string
  root: RefObject<HTMLElement | null>
  textRef: RefObject<HTMLDivElement | null>
  onLoaded: (info: { pages: number; outline: PdfOutlineEntry[] }) => void
  onFailed: (message: string) => void
  notes?: PdfMarginNote[]
  margin?: number
  zoom?: number
  lit?: PdfPlace[]
  box?: DrawnBox | null
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [paneWidth, setPaneWidth] = useState(0)
  // The callbacks change identity with the parent's renders; opening the PDF
  // must not restart when they do.
  const loaded = useRef(onLoaded)
  loaded.current = onLoaded
  const failed = useRef(onFailed)
  failed.current = onFailed

  useEffect(() => {
    let cancelled = false
    // Destroying the loading task destroys the document it opened, too.
    let destroyTask: (() => void) | null = null
    const open = async () => {
      const lib = await pdfjs()
      const task = lib.getDocument({ url })
      destroyTask = () => void task.destroy()
      const document = await task.promise
      const pages = await Promise.all(
        Array.from({ length: document.numPages }, (_, index) =>
          document.getPage(index + 1).then((proxy) => {
            const viewport = proxy.getViewport({ scale: 1 })
            return { width: viewport.width, height: viewport.height }
          }),
        ),
      )
      if (cancelled) return
      setSizes(pages)
      setPdf(document)
      loaded.current({ pages: document.numPages, outline: await outlineOf(document) })
    }
    open().catch((error: unknown) => {
      if (cancelled) return
      console.warn('[reader] PDF failed to open', error)
      failed.current(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      destroyTask?.()
    }
  }, [url])

  // Where the reader is: the page at the top of the pane and how far into
  // it, kept as they scroll, so any change of scale (the pane settling at a
  // new width, the zoom, room made for notes) puts them back there.
  const anchor = useRef<{ page: number; fraction: number } | null>(null)
  useEffect(() => {
    const pane = root.current
    if (!pane) return
    let frame = 0
    const track = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const paneTop = pane.getBoundingClientRect().top
        const pages = Array.from(pane.querySelectorAll<HTMLElement>('.reader-pdf-page'))
        const index = pages.findIndex((element) => element.getBoundingClientRect().bottom > paneTop)
        if (index < 0) return
        const box = pages[index].getBoundingClientRect()
        anchor.current = { page: index, fraction: (paneTop - box.top) / box.height }
      })
    }
    pane.addEventListener('scroll', track, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      pane.removeEventListener('scroll', track)
    }
  }, [root])

  // Pages fit the pane's width, up to a readable maximum, and follow it once
  // it settles.
  useEffect(() => {
    const pane = root.current
    if (!pane) return
    setPaneWidth(pane.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    let timer = 0
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setPaneWidth(pane.clientWidth), SETTLE)
    })
    observer.observe(pane)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [root])

  // A drag in a page's text spreads that page's `.endOfContent` sheet under
  // its words until the pointer lets go, as pdf.js's viewer does (v8.45.0).
  useEffect(() => {
    const pane = root.current
    if (!pane) return
    const start = (event: MouseEvent) => {
      const layer = (event.target as Element | null)?.closest?.('.textLayer')
      layer?.classList.add('selecting')
    }
    const end = () => {
      for (const layer of Array.from(pane.querySelectorAll('.textLayer.selecting')))
        layer.classList.remove('selecting')
    }
    pane.addEventListener('mousedown', start)
    document.addEventListener('pointerup', end)
    window.addEventListener('blur', end)
    return () => {
      pane.removeEventListener('mousedown', start)
      document.removeEventListener('pointerup', end)
      window.removeEventListener('blur', end)
    }
  }, [root])

  const widest = sizes.length ? Math.max(...sizes.map((size) => size.width)) : 1
  const fit = Math.max(0.5, Math.min(MAX_PAGE_WIDTH, paneWidth - GUTTER * 2 - margin) / widest)
  const scale = fit * zoom
  const lastScale = useRef(scale)
  useLayoutEffect(() => {
    const pane = root.current
    const kept = anchor.current
    const changed = lastScale.current !== scale
    lastScale.current = scale
    if (!pane || !kept || !changed) return
    const element = pane.querySelectorAll<HTMLElement>('.reader-pdf-page')[kept.page]
    if (!element) return
    const box = element.getBoundingClientRect()
    pane.scrollTop += box.top + kept.fraction * box.height - pane.getBoundingClientRect().top
  }, [scale, root])

  if (!pdf || sizes.length === 0) {
    return (
      <div className="reader-status">
        <span className="spin" /> Opening the PDF…
      </div>
    )
  }
  return (
    <div className="reader-pdf" ref={textRef} style={margin ? { paddingRight: margin } : undefined}>
      {sizes.map((size, index) => (
        <PdfPage
          key={index}
          pdf={pdf}
          page={index + 1}
          size={size}
          scale={scale}
          root={root}
          notes={notes.filter((note) => note.page === index + 1)}
          lit={lit.filter((place) => place.page === index + 1).flatMap((place) => place.rects)}
          drawn={box?.page === index + 1 ? box.rect : null}
        />
      ))}
    </div>
  )
}
