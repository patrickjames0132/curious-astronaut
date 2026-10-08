/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A paper thread's card home: the paper at the top, then one card per tool
 * that works on it — the citation graph, and (Phase 5b) the knowledge
 * network. Opening a card switches the thread to that tool; the thread
 * remembers it, so a revisit reopens the tool rather than these cards.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, type ReactNode } from 'react'
import { fetchPaperDetail, type PaperDetails } from '../api'
import { useAppDispatch } from '../store'
import { threadPaperSet, type ThreadRecord, type ThreadTool } from '../store/explorations'
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

const CARDS: ToolCard[] = [
  {
    tool: 'graph',
    title: 'Graph',
    blurb:
      'The papers it built on, the papers it spawned, and its nearest neighbours by ' +
      'meaning — with a teacher to narrate how the field got here.',
    icon: <GraphIcon />,
  },
  {
    tool: 'knowledge',
    title: 'Knowledge network',
    blurb:
      'A short course on what you need to know first: the papers and concepts this one ' +
      'rests on, broken down as far as you want to go.',
    icon: <NetworkIcon />,
    soon: true,
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
  const meta = [paper.authors, paper.year].filter(Boolean).join(' · ')
  const summary = paper.tldr || paper.abstract

  return (
    <div className="tool-home" data-tour="tool-home">
      <div className="tool-home-inner">
        <header className="tool-home-paper">
          <h1>{paper.title ?? thread.data.graph_ref?.seed.title ?? thread.title}</h1>
          {meta && <p className="tool-home-meta">{meta}</p>}
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
