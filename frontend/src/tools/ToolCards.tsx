/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A paper thread's card home: the paper at the top, then one card per tool
 * that works on it — the citation graph, (Phase 5b) the knowledge network,
 * the Reader (the paper itself), and Criticisms (what the field objected
 * to). Opening a card switches the thread to that tool; clicking the
 * thread in the rail always comes back here (`openThread`).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, type ReactNode } from 'react'
import { fetchPaperDetail, type PaperDetails } from '../api'
import { useAppDispatch } from '../store'
import { threadPaperSet, type ThreadRecord, type ThreadTool } from '../store/explorations'
import AuthorList from '../ui/AuthorList'
import './tools.css'

/** One card on the home: what it opens and how it introduces itself. */
interface ToolCard {
  tool: Exclude<ThreadTool, 'cards'>
  title: string
  blurb: string
  icon: ReactNode
  /** Shown but not yet openable — its tool hasn't shipped. */
  soon?: boolean
}

/** A small node-and-edge mark: the citation graph.
 * @returns The icon.
 */
function GraphIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M7 7l10 3M7 7l3 10M17 10l-7 7" />
      </g>
      <g fill="currentColor">
        <circle cx="7" cy="7" r="2.6" />
        <circle cx="17" cy="10" r="2.2" />
        <circle cx="10" cy="17" r="2.2" />
      </g>
    </svg>
  )
}

/** A root branching downward: prerequisites unfolding beneath a paper.
 * @returns The icon.
 */
function NetworkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 7.4V10M6 10h12M6 10v3.8M18 10v3.8M18 18.2v1" />
      </g>
      <g fill="currentColor">
        <circle cx="12" cy="5" r="2.4" />
        <circle cx="6" cy="16" r="2.2" />
        <circle cx="18" cy="16" r="2.2" />
        <circle cx="18" cy="20.5" r="1.6" />
      </g>
    </svg>
  )
}

/** An open book: the paper itself.
 * @returns The icon.
 */
function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M12 6.5C10 5 7 4.6 4 5v13c3-.4 6 0 8 1.5 2-1.5 5-1.9 8-1.5V5c-3-.4-6 0-8 1.5Z" />
        <path d="M12 6.5v13" />
      </g>
    </svg>
  )
}

/** Two quotation marks: what later papers said about it.
 * @returns The icon.
 */
function QuoteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <g fill="currentColor">
        <path d="M4 17.5c0-4.6 1.6-8 5.6-10.5l1 1.5C8.4 10.2 7.5 12 7.4 13H10v4.5H4Z" />
        <path d="M13.5 17.5c0-4.6 1.6-8 5.6-10.5l1 1.5c-2.2 1.7-3.1 3.5-3.2 4.5h2.6v4.5h-6Z" />
      </g>
    </svg>
  )
}

const CARDS: ToolCard[] = [
  {
    tool: 'graph',
    title: 'Citation Graph',
    blurb:
      'The papers it built on and the papers it spawned, with a teacher to narrate ' +
      'how the field got here.',
    icon: <GraphIcon />,
  },
  {
    tool: 'knowledge',
    title: 'Knowledge Graph',
    blurb:
      'A short course on what you need to know first: the ideas this paper rests on, ' +
      'broken down as far as you want to go.',
    icon: <NetworkIcon />,
  },
  {
    tool: 'reader',
    title: 'Reader',
    blurb:
      'The paper itself, section by section, with its equations typeset and every ' +
      'citation one click from its reference.',
    icon: <BookIcon />,
  },
  {
    tool: 'reviews',
    title: 'Criticisms',
    blurb:
      'What the field objected to: the weaknesses later papers found, each quoted from ' +
      'the paper that raised it.',
    icon: <QuoteIcon />,
  },
]

/**
 * Render a paper thread's card home.
 *
 * @param props Component props.
 * @param props.thread The active paper thread.
 * @param props.onOpen Switch the thread to a tool.
 * @param props.children The shell's floating overlays (loading, errors).
 * @returns The card home.
 */
export default function ToolCards({
  thread,
  onOpen,
  children,
}: {
  thread: ThreadRecord
  onOpen: (tool: ThreadTool) => void
  children?: ReactNode
}) {
  const dispatch = useAppDispatch()
  const seedRef = thread.data.graph_ref?.seed_ref
  const provider = thread.data.provider
  const missing = !thread.paper

  // Threads made by a graph build (or saved before the card home) carry no
  // hydrated paper; fetch it once, and keep it on the thread so it saves.
  useEffect(() => {
    if (!missing || !seedRef) return
    let cancelled = false
    void fetchPaperDetail(seedRef, provider)
      .then((paper) => {
        if (!cancelled) dispatch(threadPaperSet({ id: thread.id, paper }))
      })
      .catch(() => {}) // the title from the thread record still heads the page
    return () => {
      cancelled = true
    }
  }, [dispatch, missing, seedRef, provider, thread.id])

  const paper: Partial<PaperDetails> = thread.paper ?? {}
  const summary = paper.tldr || paper.abstract

  return (
    <div className="tool-home" data-tour="tool-home">
      <div className="tool-home-inner">
        <header className="tool-home-paper">
          <h1>{paper.title ?? thread.data.graph_ref?.seed.title ?? thread.title}</h1>
          {(paper.authors || paper.year) && (
            <p className="tool-home-meta">
              {paper.authors && <AuthorList key={thread.id} authors={paper.authors} />}
              {paper.authors && paper.year ? ' · ' : ''}
              {paper.year}
            </p>
          )}
          {summary && (
            <p className="tool-home-summary">
              {paper.tldr && <span className="tool-home-label">TL;DR</span>}
              {summary}
            </p>
          )}
        </header>
        <div className="tool-cards" data-tour="tool-cards">
          {CARDS.map((card) => (
            <button
              key={card.tool}
              type="button"
              className={`tool-card tool-card-${card.tool}`}
              disabled={card.soon}
              onClick={() => onOpen(card.tool)}
              title={
                card.soon ? `${card.title} — coming soon` : `Open the ${card.title.toLowerCase()}`
              }
            >
              <span className="tool-card-head">
                <span className="tool-card-icon">{card.icon}</span>
                <span className="tool-card-title">{card.title}</span>
                {card.soon && <span className="tool-card-soon">Coming soon</span>}
              </span>
              <span className="tool-card-blurb">{card.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}
