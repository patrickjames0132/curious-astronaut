/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader card: the paper itself, from its HTML render (arXiv's own, else
 * ar5iv's), with a table of
 * contents that follows the reading. Opened from the thread's card home like
 * the two graphs. v1's first slice is the reading view; citation hover cards,
 * Knowledge Graph margin notes and highlight-and-explain build on it (see the
 * OnePager's "Reader card" item).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  fetchCited,
  fetchDocument,
  fetchPdfContents,
  fetchPdfPassage,
  pdfUrl,
  type AnswerFigure,
  type PdfPlace,
  type PaperDetails,
  type ReaderDocument,
  type ReaderSection,
  type ReaderUnavailable,
} from '../api'
import type { PassageQuote } from '../assistant/askAssistant'
import Lightbox from '../figures/Lightbox'
import { courseOrder } from '../knowledge/model'
import SelectionMenu from '../selection/SelectionMenu'
import { useTextSelection } from '../selection/useTextSelection'
import { useAppDispatch, useAppSelector } from '../store'
import { passagesCleared } from '../store/highlight'
import {
  knowledgeKnownToggled,
  knowledgeOpened,
  threadReaderPlaceSet,
  threadReaderViewSet,
  threadReturnSet,
  type ReaderPlace,
  type ReaderView,
  type ThreadRecord,
} from '../store/explorations'
import { graphFocusRequested, openPaper, openTool } from '../store/workspace'
import AuthorList from '../ui/AuthorList'
import { usePresence } from '../ui/usePresence'
import { useResizablePanel } from '../ui/useResizablePanel'
import { Blocks, Inlines } from './ReaderBody'
import CitationCard, { type CitationActions } from './CitationCard'
import ConceptCard from './ConceptCard'
import ConceptNote from './ConceptNote'
import { conceptOf, pdfContentsNotes, textNotesInPdf, useConceptNotes } from './useConceptNotes'
import { useAnchoredCard } from './useAnchoredCard'
import { useMarginNotes } from './useMarginNotes'
import { boxesOf, findPassage, indexText, scrollToRange, type LitBox } from './passages'
import { selectionSpan } from './pdfPlaces'
import { usePdfPassages, type PdfLight } from './usePdfPassages'
import PdfView, { type PdfMarginNote } from './PdfView'
import type { PdfOutlineEntry } from './pdf'
import { askReader, documentRef, readerMessage, setReadingSection } from './askReader'
import { ReaderLinksContext, pdfPageId, plainText, readerDomId } from './links'
import { readerSelectionText, selectionSource } from './selectionText'
import './reader.css'

/** Sections deeper than this (paragraph headings) stay out of the contents. */
const CONTENTS_DEPTH = 3

/** Longer than the contents' slide (--motion-panel), in ms: when the
 *  reading pane's glide is over even if its animationend never came. */
const GLIDE_FALLBACK = 600

/** Room left above a PDF heading a jump lands on, as the text view's
 *  `scroll-padding-top` leaves above its headings. */
const HEADING_ROOM = 24

/** No lit passages: one array, so the default never changes identity. */
const NO_PASSAGES: string[] = []

/** The PDF view's zoom steps, as multiples of fitting the pane's width. */
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/**
 * The next zoom step in or out from a zoom.
 *
 * @param zoom The zoom now.
 * @param direction 1 to zoom in, -1 to zoom out.
 * @returns The next step that way, or the last one when there's none.
 */
function zoomStep(zoom: number, direction: 1 | -1): number {
  const steps = direction > 0 ? ZOOMS : [...ZOOMS].reverse()
  return (
    steps.find((step) => (direction > 0 ? step > zoom : step < zoom)) ?? steps[steps.length - 1]
  )
}

/** Room the PDF view leaves beside its pages for the Knowledge Graph notes:
 *  their 200px column and the gap before it (`reader.css`). */
const PDF_NOTES_ROOM = 232

/**
 * The scale a PDF page is drawn at (PdfView's `data-scale`).
 *
 * @param page The page's element.
 * @returns CSS pixels per PDF point.
 */
function pdfScale(page: HTMLElement): number {
  return Number(page.dataset.scale) || 1
}

/** Whether the contents rail is open, remembered like the app's other panels. */
const CONTENTS_KEY = 'ca.readerContentsOpen'
/** The contents' dragged width, remembered the same way. */
const CONTENTS_WIDTH_KEY = 'ca.readerContentsWidth'

/** The remembered contents state: open unless folded away before.
 * @returns Whether the contents start open.
 */
function storedContentsOpen(): boolean {
  try {
    return localStorage.getItem(CONTENTS_KEY) !== '0'
  } catch {
    return true // storage blocked: open, the default
  }
}

/** Why the Text button is off, by reason: a paper with only its PDF. */
const NO_TEXT: Record<ReaderUnavailable, string> = {
  not_arxiv: 'No text: this paper isn’t on arXiv, so it has no HTML version',
  no_render: 'No text: arXiv couldn’t convert this paper’s LaTeX to HTML',
  error: 'No text right now: arXiv’s HTML didn’t answer',
}

/** What to say when a paper has nothing to read, by reason. */
const UNAVAILABLE: Record<ReaderUnavailable, { title: string; body: string }> = {
  not_arxiv: {
    title: 'Not on arXiv',
    body:
      'This paper isn’t on arXiv, and no open-access PDF could be opened for it, so ' +
      'there’s nothing to read here yet.',
  },
  no_render: {
    title: 'No HTML render for this paper',
    body:
      'Neither arXiv’s HTML render nor ar5iv could convert this paper’s LaTeX, and its PDF ' +
      'couldn’t be opened here. It may still open on arXiv.',
  },
  error: {
    title: 'Couldn’t reach arXiv’s HTML',
    body:
      'Neither arXiv’s HTML render nor ar5iv answered, and the PDF couldn’t be opened. ' +
      'Try again in a moment.',
  },
}

/**
 * Where a passage in a section is from, as the assistant's messages say it.
 *
 * @param section The section.
 * @returns E.g. "section 3.2, Attention", or "the part on Encoder" for an
 *          unnumbered paragraph heading.
 */
function passageFrom(section: ReaderSection): string {
  const title = plainText(section.title)
    .replace(/[:.]\s*$/, '')
    .trim()
  if (section.number) return `section ${section.number}, ${title}`
  return title ? `the part on ${title}` : 'the paper'
}

/** The Reader's highlight menu: what each button does, and says. */
const MENU = [
  {
    action: 'explain',
    label: 'Explain',
    title: 'Ask the Reader Assistant to explain this passage',
  },
  {
    action: 'simplify',
    label: 'Simplify',
    title: 'Ask the Reader Assistant to say this in plain words',
  },
  {
    action: 'chat',
    label: 'Chat',
    title: 'Open the Reader Assistant with this passage attached, and ask anything about it',
  },
] as const

/**
 * Render the Reader for a paper thread.
 *
 * @param props Component props.
 * @param props.thread The active paper thread.
 * @param props.onAssistant Open the Reader's assistant (a highlight's
 *        Explain or Simplify), with a passage attached to its bar (Chat).
 * @param props.children The shell's floating overlays (the ↑ back to the
 *        cards, loading, errors), placed over the reading pane.
 * @returns The Reader.
 */
export default function Reader({
  thread,
  onAssistant,
  children,
}: {
  thread: ThreadRecord
  onAssistant?: (quote?: PassageQuote) => void
  children?: ReactNode
}) {
  const dispatch = useAppDispatch()
  const ref = documentRef(thread)
  const provider = thread.data.provider ?? 's2'
  const articleRef = useRef<HTMLElement>(null)
  const pdfRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<ReaderDocument | null>(null)
  // The PDF view (v8.40.0): what it found once open, or why it couldn't open.
  const [pdfInfo, setPdfInfo] = useState<{ pages: number; outline: PdfOutlineEntry[] } | null>(null)
  const [pdfFailure, setPdfFailure] = useState<string | null>(null)
  const [pdfPage, setPdfPage] = useState(1)
  // The PDF view's zoom, a multiple of fitting the width (v8.44.0).
  const [zoom, setZoom] = useState(1)
  const [zoomedRef, setZoomedRef] = useState(ref)
  if (zoomedRef !== ref) {
    setZoomedRef(ref)
    setZoom(1)
  }
  const [attempt, setAttempt] = useState(0)
  const pageRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [enlarged, setEnlarged] = useState<AnswerFigure | null>(null)
  const [contentsOpen, setContentsOpen] = useState(storedContentsOpen)
  // The panel slides like the app's docked panels: out on fold, back in on
  // reopen — but not on every arrival at the Reader, so only after a toggle.
  const [contentsToggled, setContentsToggled] = useState(false)
  const contentsPresence = usePresence(contentsOpen)
  // Folded by a drag, the panel is already as narrow as it goes: it snaps
  // away instead of sliding, or it would first jump back to its width.
  const [contentsSnapped, setContentsSnapped] = useState(false)
  // The reading pane takes its new width at once and its contents glide
  // there (a transform), rather than the pane resizing every frame of the
  // slide: re-laying out a whole paper sixty times a second lagged.
  const [glide, setGlide] = useState<'open' | 'close' | null>(null)
  // Ended by its animationend; this catches one that never comes, which
  // would leave the pane unable to scroll sideways.
  useEffect(() => {
    if (!glide) return
    const timer = window.setTimeout(() => setGlide(null), GLIDE_FALLBACK)
    return () => window.clearTimeout(timer)
  }, [glide])
  const toggleContents = (open: boolean, snap = false) => {
    setContentsToggled(true)
    setContentsSnapped(snap)
    // No glide when motion is reduced: no animation, so nothing would end it.
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setGlide(snap || still ? null : open ? 'open' : 'close')
    setContentsOpen(open)
    try {
      localStorage.setItem(CONTENTS_KEY, open ? '1' : '0')
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
  }
  // Resized by dragging its right edge, like the app's other side panels; a
  // drag well past the floor folds it away. Unlike the explorer rail, a drag
  // never opens it again: folded, it has no handle, only the bump — so the
  // two left-hand panels never compete for one pointer (Patrick, 2026-10-23).
  const contentsPanel = useResizablePanel(CONTENTS_WIDTH_KEY, 248, {
    min: 180,
    max: 420,
    maxFraction: 0.35,
    side: 'left',
    fold: {
      collapsed: !contentsOpen,
      collapsedWidth: 0,
      closeAt: 130,
      openAt: Number.POSITIVE_INFINITY, // never reopened by a drag
      onToggle: () => toggleContents(false, true),
    },
  })

  useEffect(() => {
    if (!ref) {
      setDoc({ available: false, reason: 'not_arxiv' })
      return
    }
    const controller = new AbortController()
    setDoc(null)
    fetchDocument(ref, controller.signal)
      .then(setDoc)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.warn('[reader] document fetch failed', error)
          setDoc({ available: false, reason: 'error' })
        }
      })
    return () => controller.abort()
  }, [ref, attempt])

  // Text or PDF: the thread's choice when there's a text to choose; the PDF
  // when the paper has no HTML render. A remembered PDF choice opens at once,
  // without waiting for the text to answer.
  const view: ReaderView | null = !doc
    ? thread.readerView === 'pdf'
      ? 'pdf'
      : null
    : doc.available
      ? (thread.readerView ?? 'text')
      : 'pdf'
  const chooseView = (next: ReaderView) => {
    setPdfFailure(null)
    dispatch(threadReaderViewSet({ id: thread.id, view: next }))
  }

  // Slide between the views (v8.40.0): the arriving view comes in from the
  // side its button is on (PDF from the right, Text from the left), as the
  // cards' scroll does; only on a switch, never on arrival.
  const [shownView, setShownView] = useState(view)
  const [slide, setSlide] = useState<'from-right' | 'from-left' | null>(null)
  if (view !== shownView) {
    setShownView(view)
    setSlide(shownView && view ? (view === 'pdf' ? 'from-right' : 'from-left') : null)
  }

  // The PDF's table of contents (v8.40.0): its outline, else the headings the
  // server finds in its text, since many PDFs carry no outline. pdf.js's own
  // outline stands in when the server can't read PDFs (no `pdf` extra).
  const [pdfContents, setPdfContents] = useState<PdfOutlineEntry[]>([])
  useEffect(() => {
    if (view !== 'pdf' || !ref) return
    const controller = new AbortController()
    fetchPdfContents(ref, provider, controller.signal)
      .then(setPdfContents)
      .catch(() => {}) // a nicety: no contents, the PDF still reads
    return () => controller.abort()
  }, [view, ref, provider])

  const sections = useMemo(() => (doc?.available ? doc.sections : []), [doc])
  const outline = useMemo(
    () => (pdfContents.length ? pdfContents : (pdfInfo?.outline ?? [])),
    [pdfContents, pdfInfo],
  )
  const outlinePlaces = useRef(new Map<string, PdfOutlineEntry>())
  const contents = useMemo(() => {
    if (view === 'pdf') {
      outlinePlaces.current = new Map(outline.map((entry, index) => [`outline-${index}`, entry]))
      return outline.map((entry, index): ReaderSection => {
        // "3.2 Attention" → the number in the rail's number column.
        const numbered = /^((?:\d{1,2}|[A-H])(?:\.\d{1,2}){0,2})\s+(.+)$/.exec(entry.title)
        return {
          id: `outline-${index}`,
          level: entry.level,
          number: numbered?.[1] ?? '',
          title: [{ kind: 'text', text: numbered?.[2] ?? entry.title }],
          blocks: [],
        }
      })
    }
    return sections.filter((section) => section.level <= CONTENTS_DEPTH && section.title.length > 0)
  }, [view, outline, sections])
  const bibliography = useMemo(
    () => new Map((doc?.available ? doc.bibliography : []).map((entry) => [entry.id, entry])),
    [doc],
  )

  const jump = useCallback((target: string) => {
    const place = outlinePlaces.current.get(target)
    const element = document.getElementById(place ? pdfPageId(place.page) : readerDomId(target))
    if (!element) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const pane = pageRef.current
    // A PDF heading whose place on its page is known: straight to it, with
    // the same room above as the text view's headings get.
    if (place?.top !== undefined && pane) {
      const offset = element.getBoundingClientRect().top - pane.getBoundingClientRect().top
      const top = pane.scrollTop + offset + place.top * pdfScale(element) - HEADING_ROOM
      pane.scrollTo({ top, behavior: still ? 'auto' : 'smooth' })
      return
    }
    element.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    // Mark where a jump landed, so a reference in a long list is easy to find.
    element.classList.add('landed')
    window.setTimeout(() => element.classList.remove('landed'), 1600)
  }, [])

  // The citation cards (v8.43.0): the bibliography matched to the papers it
  // names, once the text is in; a card shows an entry's own text meanwhile.
  const [cited, setCited] = useState<Record<string, PaperDetails>>({})
  const [matching, setMatching] = useState(false)
  const textAvailable = !!doc?.available
  useEffect(() => {
    setCited({})
    if (!textAvailable || !ref) return
    const controller = new AbortController()
    setMatching(true)
    fetchCited(ref, provider, controller.signal)
      .then(setCited)
      .catch(() => {}) // a nicety: the cards show the entries' own text
      .finally(() => {
        if (!controller.signal.aborted) setMatching(false)
      })
    return () => controller.abort()
  }, [textAvailable, ref, provider])
  const citationCard = useAnchoredCard(pageRef, '.reader-cite')
  const closeCard = citationCard.close
  useEffect(() => closeCard(), [view, ref, closeCard])
  const graph = useAppSelector((state) => state.workspace.graph)
  const citationActions = useMemo<CitationActions>(
    () => ({
      open: (paper) => {
        closeCard()
        void dispatch(openPaper({ seed: paper.id, provider }))
      },
      read: (paper) => {
        closeCard()
        void dispatch(openPaper({ seed: paper.id, provider })).then(() =>
          dispatch(openTool('reader')),
        )
      },
      showInGraph: (paper) => {
        closeCard()
        dispatch(graphFocusRequested(paper.id))
        void dispatch(openTool('graph'))
      },
      goToReference: (entryId) => {
        closeCard()
        jump(entryId)
      },
    }),
    [closeCard, dispatch, provider, jump],
  )
  // The Knowledge Graph notes (v8.44.0): the course's concepts beside the
  // sections that build on them, in course order; nothing without a course.
  const { notes, map: course } = useConceptNotes(
    thread.knowledge,
    textAvailable && ref ? { paper: ref, source: 'text' } : null,
  )
  // A paper with only its PDF is placed in the PDF's own contents; the PDF
  // view of a paper with a text moves the text's notes to the PDF's
  // headings, so both views say the same and nothing is asked twice.
  const pdfOnly = !!doc && !doc.available && view === 'pdf' && !!ref
  const { notes: pdfOwnNotes } = useConceptNotes(
    thread.knowledge,
    pdfOnly && ref ? { paper: ref, source: 'pdf', provider } : null,
  )
  // The course's order as if nothing were known: a check-off prunes what the
  // known item needs from the real teaching order, which would move chips
  // around as they're ticked (Patrick saw MDPs jump to the front and back).
  const courseRank = useMemo(
    () =>
      new Map(
        (course ? courseOrder({ ...course, known: [] }) : []).map((id, index) => [id, index]),
      ),
    [course],
  )
  const ranked = (ids: string[]) =>
    [...ids].sort(
      (first, second) => (courseRank.get(first) ?? Infinity) - (courseRank.get(second) ?? Infinity),
    )
  const conceptCard = useAnchoredCard(pageRef, '.reader-concept')
  const pdfNotes = useMemo<PdfMarginNote[]>(() => {
    if (view !== 'pdf' || !course) return []
    const placed = textAvailable
      ? textNotesInPdf(notes, sections, outline)
      : pdfContentsNotes(pdfOwnNotes, pdfContents)
    return placed.map((note, index) => ({
      key: `${note.page}:${index}`,
      page: note.page,
      top: note.top,
      title: note.title,
      node: (
        <ConceptNote
          slot={`pdf:${note.page}:${index}`}
          ids={ranked(note.ids)}
          map={course}
          card={conceptCard.controls}
        />
      ),
    }))
    // `ranked` follows `courseRank`, which follows `course`.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view,
    course,
    textAvailable,
    notes,
    sections,
    outline,
    pdfOwnNotes,
    pdfContents,
    conceptCard.controls,
  ])
  const closeConcept = conceptCard.close
  useEffect(() => closeConcept(), [view, ref, closeConcept])
  // Stacked so they never overlap, each tied to its heading by a curve.
  useMarginNotes(
    pageRef,
    view === 'pdf'
      ? pdfNotes.map((note) => note.key).join(',')
      : view === 'text' && course
        ? [...notes.keys()].join(',')
        : '',
  )
  const openConcept = conceptCard.card
  // The card's id is the chip's (its note and its concept): the concept alone.
  const openConceptId = openConcept ? conceptOf(openConcept.id) : null

  const openCard = citationCard.card
  const cardEntry = openCard ? bibliography.get(openCard.id) : undefined
  const cardPaper = openCard ? cited[openCard.id] : undefined
  const links = useMemo(
    () => ({ bibliography, cite: citationCard.controls, jump, enlarge: setEnlarged }),
    [bibliography, citationCard.controls, jump],
  )

  // A contents entry clicked stays the active one until the reader scrolls
  // by hand: two headings close together on a page would otherwise light the
  // later one, both having passed the top third once the jump lands.
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  useEffect(() => {
    const pane = pageRef.current
    if (!pane || !pinnedId) return
    const release = () => setPinnedId(null)
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const name of events) pane.addEventListener(name, release, { passive: true })
    return () => {
      for (const name of events) pane.removeEventListener(name, release)
    }
  }, [pinnedId])
  useEffect(() => setPinnedId(null), [view])

  // The contents follow the reading: the active entry is the last heading
  // that has scrolled past the top third of the page.
  useEffect(() => {
    const page = pageRef.current
    if (!page || contents.length === 0 || view === 'pdf') return
    const update = () => {
      const line = page.getBoundingClientRect().top + page.clientHeight / 3
      let current: string | null = contents[0].id
      for (const section of contents) {
        const heading = document.getElementById(readerDomId(section.id))
        if (heading && heading.getBoundingClientRect().top <= line) current = section.id
        else if (heading) break
      }
      setActiveId(current)
    }
    update()
    page.addEventListener('scroll', update, { passive: true })
    return () => page.removeEventListener('scroll', update)
  }, [contents, view])

  // In the PDF view: the page in view is the last whose top has passed the
  // top third of the pane, and the outline's active entry is the last one
  // whose heading has — its place on its page when known, else its page's
  // top (several sections can start on one page).
  const [outlineActive, setOutlineActive] = useState<string | null>(null)
  useEffect(() => {
    const pane = pageRef.current
    if (!pane || view !== 'pdf' || !pdfInfo) return
    const update = () => {
      const line = pane.getBoundingClientRect().top + pane.clientHeight / 3
      const pages = Array.from(pane.querySelectorAll<HTMLElement>('.reader-pdf-page'))
      let current = 1
      for (const element of pages) {
        if (element.getBoundingClientRect().top <= line)
          current = Number(element.dataset.sectionId?.slice('page:'.length)) || current
        else break
      }
      setPdfPage(current)
      let active: string | null = null
      outline.forEach((entry, index) => {
        const element = pages[entry.page - 1]
        if (!element) return
        const top = element.getBoundingClientRect().top + (entry.top ?? 0) * pdfScale(element)
        if (top <= line) active = `outline-${index}`
      })
      setOutlineActive(active)
    }
    update()
    pane.addEventListener('scroll', update, { passive: true })
    return () => pane.removeEventListener('scroll', update)
  }, [view, pdfInfo, outline])
  const shownActiveId = pinnedId ?? (view === 'pdf' ? outlineActive : activeId)

  // Where the reader is (v8.44.0): the section or page at the top of the
  // pane and how far into it, kept as they scroll and saved on the thread
  // when the Reader closes, so it reopens there (Patrick: coming back from a
  // lesson in the Knowledge Graph meant finding the place again by hand).
  const place = useRef<ReaderPlace | null>(null)
  useEffect(() => {
    const pane = pageRef.current
    if (!pane || !view) return
    let frame = 0
    const track = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = pane.getBoundingClientRect().top
        let found: { at: string; fraction: number } | null = null
        for (const element of Array.from(pane.querySelectorAll<HTMLElement>('[data-section-id]'))) {
          const box = element.getBoundingClientRect()
          if (box.top > top + 1) break
          found = {
            at: element.dataset.sectionId ?? '',
            fraction: box.height ? (top - box.top) / box.height : 0,
          }
        }
        place.current = found?.at ? { view, ...found } : null
      })
    }
    pane.addEventListener('scroll', track, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      pane.removeEventListener('scroll', track)
    }
  }, [view])
  const threadId = thread.id
  useEffect(
    () => () => {
      if (place.current) dispatch(threadReaderPlaceSet({ id: threadId, place: place.current }))
    },
    [dispatch, threadId],
  )
  // Back to that place once, when its view is laid out: the text once the
  // document is in, the PDF once its pages are sized.
  const restored = useRef(false)
  const saved = thread.readerPlace
  const laidOut = view === 'text' ? !!doc?.available : view === 'pdf' ? !!pdfInfo : false
  useEffect(() => {
    if (restored.current || !laidOut) return
    restored.current = true
    const pane = pageRef.current
    if (!pane || !saved || saved.view !== view) return
    const frame = requestAnimationFrame(() => {
      const element = Array.from(pane.querySelectorAll<HTMLElement>('[data-section-id]')).find(
        (candidate) => candidate.dataset.sectionId === saved.at,
      )
      if (!element) return
      const box = element.getBoundingClientRect()
      pane.scrollTop += box.top - pane.getBoundingClientRect().top + saved.fraction * box.height
    })
    return () => cancelAnimationFrame(frame)
  }, [laidOut, saved, view])

  // The assistant opens on the section in view, or the page in the PDF view
  // (askReader's own note of it).
  useEffect(() => {
    setReadingSection(thread.id, view === 'pdf' ? `page:${pdfPage}` : activeId)
  }, [thread.id, view, pdfPage, activeId])

  // The highlight menu (v8.38.0): Explain and Simplify ask the Reader's
  // assistant about the passage, opening it; Chat attaches the passage to its
  // bar. Formulas are read as their LaTeX (`selectionText`).
  const { selection, clear: clearSelection } = useTextSelection(
    view === 'pdf' ? pdfRef : articleRef,
    view === 'pdf' ? !!pdfInfo : !!doc?.available,
    readerSelectionText,
  )

  // An answer's passages, lit (v8.45.0, stage 6): the Reader Assistant sets
  // them (an answer finishing, an answer or a quote clicked); here they're
  // found in the text and lit, and gone to when asked. The PDF view lights
  // places instead, where the passage was highlighted and where the server
  // finds the quotes (`usePdfPassages`). They stay lit until something else
  // is chosen: another answer, the same one again, Esc, or a passage the
  // reader highlights themselves (Patrick).
  const litPassages = useAppSelector((state) => state.highlight?.passages)
  const lit = litPassages?.threadId === thread.id ? litPassages : null
  const passages = useMemo(
    () => (lit ? [...(lit.passage ? [lit.passage] : []), ...lit.quotes] : NO_PASSAGES),
    [lit],
  )
  const passageScroll = lit?.scroll ?? 0
  const pdfLight = useMemo<PdfLight | null>(
    () =>
      lit && (lit.passage || lit.places.length || lit.quotes.length)
        ? { passage: lit.passage, places: lit.places, quotes: lit.quotes }
        : null,
    [lit],
  )
  const pdfPaper = useMemo(() => (ref ? { ref, provider } : null), [ref, provider])
  const pdfLit = usePdfPassages(view === 'pdf' ? pdfPaper : null, pageRef, pdfLight, passageScroll)
  const seenPassageScroll = useRef(passageScroll)
  const [textLit, setTextLit] = useState<LitBox[]>([])
  // The view the text's light was last shown in: arriving from the PDF view
  // with something lit goes to it (Patrick).
  const litView = useRef(view)
  useEffect(() => {
    const article = articleRef.current
    const pane = pageRef.current
    const arrived = litView.current !== view
    litView.current = view
    if (view !== 'text' || !doc?.available || !article || !pane) {
      setTextLit([])
      return
    }
    const index = passages.length ? indexText(article) : null
    const ranges = index ? passages.flatMap((quote) => findPassage(article, index, quote)) : []
    // Measured again whenever the column reflows (a resize, the contents
    // folding, the notes moving into the margin).
    const measure = () => setTextLit(ranges.length ? boxesOf(ranges, article) : [])
    measure()
    const asked = passageScroll !== seenPassageScroll.current
    seenPassageScroll.current = passageScroll
    if ((asked || arrived) && ranges[0]) scrollToRange(pane, ranges[0])
    if (!ranges.length || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(article)
    return () => observer.disconnect()
  }, [view, doc, passages, passageScroll])
  const anyPassages = !!pdfLight
  useEffect(() => {
    if (!anyPassages) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dispatch(passagesCleared())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [anyPassages, dispatch])
  // Only a new selection lets them go: one still standing when an answer to
  // it finishes (Explain, say) mustn't put out what that answer lit.
  const passagesLitNow = useRef(anyPassages)
  passagesLitNow.current = anyPassages
  useEffect(() => {
    if (selection && passagesLitNow.current) dispatch(passagesCleared())
  }, [selection, dispatch])
  const pick = async (action: (typeof MENU)[number]['action'], browserPassage: string) => {
    // Where it's from, and where it sits on the page, must be read while the
    // text is still selected.
    const source = selectionSource()
    const live = window.getSelection()
    const range = live?.rangeCount ? live.getRangeAt(0) : null
    const pages = pdfRef.current
    const span = view === 'pdf' && range && pages ? selectionSpan(range, pages) : null
    clearSelection()
    if (source.sectionId) setReadingSection(thread.id, source.sectionId)
    // In the PDF view, the words are the PDF's own from where the drag began
    // to where it ended, in reading order (v8.45.0), and their places are
    // what the answer lights again; the browser's reading of pdf.js's text
    // layer only stands in when that read fails.
    let passage = browserPassage
    let where: PdfPlace[] | undefined
    if (span && ref) {
      const read = await fetchPdfPassage(ref, provider, span)
      if (read.text) passage = read.text
      if (read.places.length) where = read.places
    }
    if (action === 'chat') {
      onAssistant?.({ text: passage, from: source.from, places: where })
      return
    }
    onAssistant?.()
    void dispatch(
      askReader({
        threadId: thread.id,
        question: readerMessage(action, passage, source.from),
        provider,
        places: where,
      }),
    )
  }

  const paper = thread.paper
  const title = doc?.available && doc.title.length > 0 ? doc.title : null
  const fallbackTitle = paper?.title ?? thread.data.graph_ref?.seed.title ?? thread.title
  const arxivId = paper?.arxiv_id ?? thread.data.graph_ref?.seed.arxiv_id

  // The zoom shows in the PDF view only (it folds away in the text).
  const zoomShown = view === 'pdf' && !pdfFailure
  let body: ReactNode
  if (view === 'pdf' && ref && !pdfFailure) {
    body = (
      <PdfView
        key={ref}
        url={pdfUrl(ref, provider)}
        root={pageRef}
        textRef={pdfRef}
        onLoaded={setPdfInfo}
        onFailed={setPdfFailure}
        notes={pdfNotes}
        margin={pdfNotes.length ? PDF_NOTES_ROOM : 0}
        zoom={zoom}
        lit={pdfLit}
      />
    )
  } else if (view === 'pdf' && doc?.available) {
    // The reader chose the PDF and it wouldn't open: say so, and offer the text.
    body = (
      <div className="reader-status reader-unavailable">
        <h2>Couldn’t open the PDF</h2>
        <p>This paper’s PDF couldn’t be downloaded or opened here. Its text is still readable.</p>
        <button type="button" className="reader-retry" onClick={() => chooseView('text')}>
          Show the text
        </button>
      </div>
    )
  } else if (!doc) {
    body = (
      <div className="reader-status">
        <span className="spin" /> Reading the paper…
      </div>
    )
  } else if (!doc.available) {
    const message = UNAVAILABLE[doc.reason]
    body = (
      <div className="reader-status reader-unavailable">
        <h2>{message.title}</h2>
        <p>{message.body}</p>
        {doc.reason === 'error' && (
          <button
            type="button"
            className="reader-retry"
            onClick={() => {
              setPdfFailure(null)
              setAttempt((count) => count + 1)
            }}
          >
            Try again
          </button>
        )}
        {doc.reason === 'no_render' && arxivId && (
          <a
            className="reader-retry"
            href={`https://arxiv.org/pdf/${arxivId}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open the PDF on arXiv
          </a>
        )}
      </div>
    )
  } else {
    body = (
      <ReaderLinksContext.Provider value={links}>
        <article
          className={`reader-article${course && notes.size ? ' has-notes' : ''}`}
          ref={articleRef}
        >
          {textLit.map((box, index) => (
            <div key={index} className="reader-text-lit" aria-hidden="true" style={box} />
          ))}
          <header className="reader-header">
            <h1>{title ? <Inlines inlines={title} /> : fallbackTitle}</h1>
            {paper?.authors && (
              <p className="reader-meta">
                <AuthorList key={thread.id} authors={paper.authors} />
                {paper.year ? ` · ${paper.year}` : ''}
              </p>
            )}
          </header>
          {doc.abstract.length > 0 && (
            <section className="reader-abstract" data-passage-from="the abstract">
              <h2>Abstract</h2>
              <Blocks blocks={doc.abstract} />
            </section>
          )}
          {doc.sections.map((section) => {
            const level = Math.min(section.level, 4)
            const Heading = (['h2', 'h3', 'h4', 'h5'] as const)[level - 1]
            return (
              <section
                key={section.id}
                className={`reader-section reader-level-${level}`}
                data-section-id={section.id}
                data-passage-from={passageFrom(section)}
              >
                {section.title.length > 0 && (
                  <Heading id={readerDomId(section.id)} className="reader-section-title">
                    {section.number && (
                      <span className="reader-section-number">{section.number}</span>
                    )}
                    <Inlines inlines={section.title} />
                  </Heading>
                )}
                {course && notes.has(section.id) && (
                  <ConceptNote
                    slot={section.id}
                    ids={ranked(notes.get(section.id) ?? [])}
                    map={course}
                    card={conceptCard.controls}
                  />
                )}
                <Blocks blocks={section.blocks} />
              </section>
            )
          })}
          {doc.bibliography.length > 0 && (
            <section className="reader-references" data-passage-from="the references">
              <h2 id={readerDomId('bib')}>References</h2>
              <ol>
                {doc.bibliography.map((entry) => (
                  <li key={entry.id} id={readerDomId(entry.id)}>
                    <span className="reader-reference-label">[{entry.label}]</span>
                    <span>
                      <Inlines inlines={entry.text} />
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <footer className="reader-credit">
            Text from{' '}
            <a
              href={doc.source?.url ?? `https://arxiv.org/html/${arxivId ?? ref ?? ''}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {doc.source?.name === 'ar5iv' ? 'ar5iv' : 'arXiv’s HTML'}
            </a>
            , a render of the paper’s LaTeX.
          </footer>
        </article>
      </ReaderLinksContext.Provider>
    )
  }

  return (
    <div
      className="reader"
      style={{ '--contents-width': `${contentsPanel.width}px` } as CSSProperties}
    >
      {contents.length > 0 && !contentsPresence.present && (
        <button
          type="button"
          className={`reader-contents-folded${contentsToggled ? ' arriving' : ''}`}
          data-tour="reader-contents"
          aria-expanded={false}
          aria-controls="reader-contents"
          onClick={() => toggleContents(true)}
          title="Show contents"
          aria-label="Show contents"
        >
          <span className="reader-contents-bump" aria-hidden="true">
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
      )}
      {contents.length > 0 && contentsPresence.present && (
        <nav
          className={`reader-contents${contentsToggled ? ' sliding' : ''}${
            contentsPresence.closing ? (contentsSnapped ? ' closing snap' : ' closing') : ''
          }${contentsPanel.dragging ? ' dragging' : ''}`}
          style={{ width: contentsPanel.width }}
          onAnimationEnd={contentsPresence.onAnimationEnd}
          id="reader-contents"
          aria-label="Contents"
          data-tour="reader-contents"
        >
          {/* The list scrolls inside a frame that doesn't, so the handle on
              the frame's edge stays put however far down the list is. */}
          <div className="reader-contents-scroll">
            <p className="reader-contents-label">Contents</p>
            <ol>
              {contents.map((section) => (
                <li key={section.id} className={`reader-contents-level-${section.level}`}>
                  <button
                    type="button"
                    className={section.id === shownActiveId ? 'active' : undefined}
                    aria-current={section.id === shownActiveId ? 'location' : undefined}
                    onClick={() => {
                      setPinnedId(section.id)
                      jump(section.id)
                    }}
                    title={plainText(section.title)}
                  >
                    {section.number && (
                      <span className="reader-contents-number">{section.number}</span>
                    )}
                    <span className="reader-contents-title">
                      <Inlines inlines={section.title} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div
            className="reader-contents-handle"
            onPointerDown={contentsPanel.onHandlePointerDown}
            title="Drag to resize the contents; drag it narrow to fold them away"
            aria-hidden="true"
          />
          {/* The fold's mirror: the same coral line and bump, on the panel's
              inside edge, pointing back the way it goes. */}
          <button
            type="button"
            className="reader-contents-hide"
            aria-expanded={true}
            aria-controls="reader-contents"
            onClick={() => toggleContents(false)}
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
      )}
      {/* The shell's overlays go over the reading pane, not the whole
          Reader, so the ↑ back centres over the text, not the contents. */}
      <div
        className={`reader-main${glide ? ` glide-${glide}` : ''}`}
        onAnimationEnd={(event) => {
          if (event.animationName.startsWith('reader-glide')) setGlide(null)
        }}
      >
        {children}
        <div
          key={view ?? 'loading'}
          className={`reader-page${view === 'pdf' ? ' reader-page-pdf' : ''}${slide ? ` ${slide}` : ''}`}
          ref={pageRef}
          data-tour="reader-page"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setSlide(null)
          }}
        >
          {body}
          {openCard && cardEntry && view === 'text' && (
            <CitationCard
              entry={cardEntry}
              paper={cardPaper}
              matching={matching}
              provider={provider}
              inGraph={graph ? graph.nodes.some((node) => node.id === cardPaper?.id) : null}
              pinned={openCard.pinned}
              placement={openCard.placement}
              actions={citationActions}
              onClose={citationCard.close}
              onPointerEnter={citationCard.keep}
              onPointerLeave={citationCard.release}
            />
          )}
          {openConcept && openConceptId && course && (
            <ConceptCard
              id={openConceptId}
              map={course}
              pinned={openConcept.pinned}
              placement={openConcept.placement}
              onToggleKnown={() =>
                dispatch(knowledgeKnownToggled({ threadId: thread.id, nodeId: openConceptId }))
              }
              onOpen={() => {
                closeConcept()
                dispatch(knowledgeOpened({ threadId: thread.id, nodeId: openConceptId }))
                // The Knowledge Graph then offers the way back here.
                dispatch(
                  threadReturnSet({
                    id: thread.id,
                    returnTo: { tool: 'reader', from: 'knowledge' },
                  }),
                )
                void dispatch(openTool('knowledge'))
              }}
              onClose={closeConcept}
              onPointerEnter={conceptCard.keep}
              onPointerLeave={conceptCard.release}
            />
          )}
        </div>
        {/* Text or PDF (v8.40.0), remembered on the thread. Shown even when
            there's no text (Patrick), its Text button saying why; hidden only
            when neither the text nor the PDF could be had. */}
        {doc && !(pdfFailure && !doc.available) && (
          <div className="reader-bottom-bar">
            <div className="reader-controls" data-tour="reader-view-switch">
              <div
                className={`reader-view-switch${view === 'pdf' ? ' on-pdf' : ''}`}
                role="group"
                aria-label="Show the paper as"
              >
                <span className="reader-view-thumb" aria-hidden="true" />
                <button
                  type="button"
                  aria-pressed={view === 'text'}
                  // Not `disabled`: some browsers show no tooltip on a disabled button.
                  aria-disabled={!doc.available}
                  onClick={() => doc.available && chooseView('text')}
                  title={
                    doc.available
                      ? 'Read the paper’s text: typeset equations, live citations'
                      : NO_TEXT[doc.reason]
                  }
                >
                  Text
                </button>
                <button
                  type="button"
                  aria-pressed={view === 'pdf'}
                  onClick={() => chooseView('pdf')}
                  title="Read the paper as its PDF: the original layout"
                >
                  PDF
                </button>
              </div>
              {/* Zoom (v8.44.0, Patrick): a small window shrank the PDF past
                  reading. Steps around fitting the width; the percentage goes
                  back to fitting. Always there, so switching to the PDF can
                  grow it out from the switch, left to right, and switching
                  back fold it away; out of reach while folded. */}
              <div
                className={`reader-zoom-fold${zoomShown ? ' open' : ''}`}
                inert={!zoomShown}
                aria-hidden={!zoomShown}
              >
                <div className="reader-zoom" role="group" aria-label="Zoom">
                  <button
                    type="button"
                    onClick={() => setZoom(zoomStep(zoom, -1))}
                    disabled={zoom <= ZOOMS[0]}
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="reader-zoom-level"
                    onClick={() => setZoom(1)}
                    title="Fit the page to the width"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom(zoomStep(zoom, 1))}
                    disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {selection && (
        <SelectionMenu
          selection={selection}
          actions={MENU.map((item) => ({
            label: item.label,
            title: item.title,
            onPick: (passage) => void pick(item.action, passage),
          }))}
        />
      )}
      <Lightbox figure={enlarged} onClose={() => setEnlarged(null)} />
    </div>
  )
}
