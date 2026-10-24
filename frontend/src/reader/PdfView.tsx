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
 * the size does change, the reading position is kept: the page at the top of
 * the pane stays there, the same fraction of the way down.
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
  type RefObject,
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pdfPageId } from './links'
import { outlineOf, pdfjs, type PdfOutlineEntry } from './pdf'

/** A page's size at scale 1, in PDF points. */
interface PageSize {
  width: number
  height: number
}

/** The widest a page is drawn, in CSS pixels, however wide the pane. */
const MAX_PAGE_WIDTH = 900
/** Room left beside a page, each side. */
const GUTTER = 24
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
 * @returns The page.
 */
function PdfPage({
  pdf,
  page,
  size,
  scale,
  root,
}: {
  pdf: PDFDocumentProxy
  page: number
  size: PageSize
  scale: number
  root: RefObject<HTMLElement | null>
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
      <div ref={text} className="textLayer" />
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
 * @returns The pages, or a loading line.
 */
export default function PdfView({
  url,
  root,
  textRef,
  onLoaded,
  onFailed,
}: {
  url: string
  root: RefObject<HTMLElement | null>
  textRef: RefObject<HTMLDivElement | null>
  onLoaded: (info: { pages: number; outline: PdfOutlineEntry[] }) => void
  onFailed: (message: string) => void
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

  // Pages fit the pane's width, up to a readable maximum, and follow it once
  // it settles; where the reader was is noted first, to be put back.
  const anchor = useRef<{ page: number; fraction: number } | null>(null)
  const paneWidthRef = useRef(paneWidth)
  paneWidthRef.current = paneWidth
  useEffect(() => {
    const pane = root.current
    if (!pane) return
    setPaneWidth(pane.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    let timer = 0
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (pane.clientWidth === paneWidthRef.current) return
        const paneTop = pane.getBoundingClientRect().top
        const pages = Array.from(pane.querySelectorAll<HTMLElement>('.reader-pdf-page'))
        const index = pages.findIndex((element) => element.getBoundingClientRect().bottom > paneTop)
        if (index >= 0) {
          const box = pages[index].getBoundingClientRect()
          anchor.current = { page: index, fraction: (paneTop - box.top) / box.height }
        }
        setPaneWidth(pane.clientWidth)
      }, SETTLE)
    })
    observer.observe(pane)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [root])

  const widest = sizes.length ? Math.max(...sizes.map((size) => size.width)) : 1
  const scale = Math.max(0.5, Math.min(MAX_PAGE_WIDTH, paneWidth - GUTTER * 2) / widest)
  useLayoutEffect(() => {
    const pane = root.current
    const kept = anchor.current
    anchor.current = null
    if (!pane || !kept) return
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
    <div className="reader-pdf" ref={textRef}>
      {sizes.map((size, index) => (
        <PdfPage key={index} pdf={pdf} page={index + 1} size={size} scale={scale} root={root} />
      ))}
    </div>
  )
}
