/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader card: the paper itself, from its ar5iv render, with a table of
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
  fetchDocument,
  type AnswerFigure,
  type ReaderDocument,
  type ReaderUnavailable,
} from '../api'
import Lightbox from '../figures/Lightbox'
import type { ThreadRecord } from '../store/explorations'
import AuthorList from '../ui/AuthorList'
import { usePresence } from '../ui/usePresence'
import { useResizablePanel } from '../ui/useResizablePanel'
import { Blocks, Inlines } from './ReaderBody'
import { ReaderLinksContext, plainText, readerDomId } from './links'
import './reader.css'

/** Sections deeper than this (paragraph headings) stay out of the contents. */
const CONTENTS_DEPTH = 3

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

/** What to say when a paper has nothing to read, by reason. */
const UNAVAILABLE: Record<ReaderUnavailable, { title: string; body: string }> = {
  not_arxiv: {
    title: 'Not on arXiv',
    body:
      'The Reader works from arXiv’s HTML render of a paper, and this one isn’t on arXiv. ' +
      'Reading open-access PDFs is planned.',
  },
  no_render: {
    title: 'No HTML render for this paper',
    body:
      'arXiv’s HTML renderer (ar5iv) couldn’t convert this paper’s LaTeX, so there’s no ' +
      'text to show yet. The PDF is still on arXiv.',
  },
  error: {
    title: 'Couldn’t reach ar5iv',
    body: 'arXiv’s HTML renderer didn’t answer. It’s often slow; try again in a moment.',
  },
}

/**
 * The ref to ask the document route for: the paper's arXiv id when known.
 *
 * @param thread The paper thread.
 * @returns Its arXiv id, else its seed ref, else null.
 */
function documentRef(thread: ThreadRecord): string | null {
  return (
    thread.paper?.arxiv_id ??
    thread.data.graph_ref?.seed.arxiv_id ??
    thread.data.graph_ref?.seed_ref ??
    null
  )
}

/**
 * Render the Reader for a paper thread.
 *
 * @param props Component props.
 * @param props.thread The active paper thread.
 * @param props.children The shell's floating overlays (the ↑ back to the
 *        cards, loading, errors), placed over the reading pane.
 * @returns The Reader.
 */
export default function Reader({
  thread,
  children,
}: {
  thread: ThreadRecord
  children?: ReactNode
}) {
  const ref = documentRef(thread)
  const [doc, setDoc] = useState<ReaderDocument | null>(null)
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
  const toggleContents = (open: boolean, snap = false) => {
    setContentsToggled(true)
    setContentsSnapped(snap)
    setContentsOpen(open)
    try {
      localStorage.setItem(CONTENTS_KEY, open ? '1' : '0')
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
  } // Resized by dragging its right edge, like the app's other side panels; a
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

  const sections = useMemo(() => (doc?.available ? doc.sections : []), [doc])
  const contents = useMemo(
    () => sections.filter((section) => section.level <= CONTENTS_DEPTH && section.title.length > 0),
    [sections],
  )
  const bibliography = useMemo(
    () => new Map((doc?.available ? doc.bibliography : []).map((entry) => [entry.id, entry])),
    [doc],
  )

  const jump = useCallback((target: string) => {
    const element = document.getElementById(readerDomId(target))
    if (!element) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
    // Mark where a jump landed, so a reference in a long list is easy to find.
    element.classList.add('landed')
    window.setTimeout(() => element.classList.remove('landed'), 1600)
  }, [])
  const links = useMemo(() => ({ bibliography, jump, enlarge: setEnlarged }), [bibliography, jump])

  // The contents follow the reading: the active entry is the last heading
  // that has scrolled past the top third of the page.
  useEffect(() => {
    const page = pageRef.current
    if (!page || contents.length === 0) return
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
  }, [contents])

  const paper = thread.paper
  const title = doc?.available && doc.title.length > 0 ? doc.title : null
  const fallbackTitle = paper?.title ?? thread.data.graph_ref?.seed.title ?? thread.title
  const arxivId = paper?.arxiv_id ?? thread.data.graph_ref?.seed.arxiv_id

  let body: ReactNode
  if (!doc) {
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
            onClick={() => setAttempt((count) => count + 1)}
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
        <article className="reader-article">
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
            <section className="reader-abstract">
              <h2>Abstract</h2>
              <Blocks blocks={doc.abstract} />
            </section>
          )}
          {doc.sections.map((section) => {
            const level = Math.min(section.level, 4)
            const Heading = (['h2', 'h3', 'h4', 'h5'] as const)[level - 1]
            return (
              <section key={section.id} className={`reader-section reader-level-${level}`}>
                {section.title.length > 0 && (
                  <Heading id={readerDomId(section.id)} className="reader-section-title">
                    {section.number && (
                      <span className="reader-section-number">{section.number}</span>
                    )}
                    <Inlines inlines={section.title} />
                  </Heading>
                )}
                <Blocks blocks={section.blocks} />
              </section>
            )
          })}
          {doc.bibliography.length > 0 && (
            <section className="reader-references">
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
              href={`https://ar5iv.labs.arxiv.org/html/${arxivId ?? ref ?? ''}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              ar5iv
            </a>
            , arXiv’s HTML render of the paper’s LaTeX.
          </footer>
        </article>
      </ReaderLinksContext.Provider>
    )
  }

  return (
    <div className="reader">
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
          style={
            {
              width: contentsPanel.width,
              '--contents-width': `${contentsPanel.width}px`,
            } as CSSProperties
          }
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
                    className={section.id === activeId ? 'active' : undefined}
                    aria-current={section.id === activeId ? 'location' : undefined}
                    onClick={() => jump(section.id)}
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
      <div className="reader-main">
        {children}
        <div className="reader-page" ref={pageRef} data-tour="reader-page">
          {body}
        </div>
      </div>
      <Lightbox figure={enlarged} onClose={() => setEnlarged(null)} />
    </div>
  )
}
