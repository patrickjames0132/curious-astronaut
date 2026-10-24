/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader's citation card (v8.43.0): what a `[12]` in the text cites.
 * Hovering a citation previews it; clicking pins it (Patrick, 2026-10-24).
 * When the bibliography entry was matched to a paper
 * (`services/reader/citations.py`), the card shows that paper (title,
 * authors, year, venue, citations, TL;DR) and four ways on: open it as its
 * own thread, read it in its own Reader, show it in this thread's Citation
 * Graph, or go to the entry in the reference list. An entry nothing matched
 * shows its own text, with the last of those.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { CSSProperties } from 'react'
import type { PaperDetails, ReaderBibEntry } from '../api'
import MathText from '../notation/MathText'
import { plainText } from './links'

/** Where the card sits in the page, and which way it opens. */
export interface CardPlacement {
  top: number
  left: number
  /** Opens upward from `top` (no room below the citation). */
  above: boolean
}

/** What the card's buttons do; the Reader supplies them. */
export interface CitationActions {
  open: (paper: PaperDetails) => void
  read: (paper: PaperDetails) => void
  showInGraph: (paper: PaperDetails) => void
  goToReference: (entryId: string) => void
}

/**
 * The card.
 *
 * @param props Component props.
 * @param props.entry The bibliography entry cited.
 * @param props.paper The paper it was matched to, if any.
 * @param props.matching Whether the matching is still under way.
 * @param props.provider Whose reference list it was matched against.
 * @param props.inGraph Whether the paper is on this thread's Citation Graph:
 *   null when there's no graph yet (showing it builds one).
 * @param props.pinned Whether a click pinned it (it then has a close).
 * @param props.placement Where it sits.
 * @param props.actions What its buttons do.
 * @param props.onClose Close it.
 * @param props.onPointerEnter Keep a preview open while the pointer is on it.
 * @param props.onPointerLeave Let a preview close.
 * @returns The card.
 */
export default function CitationCard({
  entry,
  paper,
  matching,
  provider,
  inGraph,
  pinned,
  placement,
  actions,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  entry: ReaderBibEntry
  paper: PaperDetails | undefined
  matching: boolean
  provider: string
  inGraph: boolean | null
  pinned: boolean
  placement: CardPlacement
  actions: CitationActions
  onClose: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}) {
  const style: CSSProperties = { top: placement.top, left: placement.left }
  const source = provider === 'openalex' ? 'OpenAlex' : 'Semantic Scholar'
  const meta = paper ? [paper.authors, paper.year, paper.venue].filter(Boolean).join(' · ') : ''
  return (
    <div
      className={`reader-cite-card${placement.above ? ' above' : ''}${pinned ? ' pinned' : ''}`}
      style={style}
      role="dialog"
      aria-label={paper ? `Cited: ${paper.title}` : `Reference ${entry.label}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      // A click inside isn't a click outside.
      onMouseDown={(event) => event.stopPropagation()}
    >
      {pinned && (
        <button
          type="button"
          className="reader-cite-card-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      )}
      {paper ? (
        <>
          <p className="reader-cite-card-title">
            <MathText>{paper.title}</MathText>
          </p>
          {meta && <p className="reader-cite-card-meta">{meta}</p>}
          {paper.citation_count != null && (
            <p className="reader-cite-card-meta">
              {paper.citation_count.toLocaleString()} citation
              {paper.citation_count === 1 ? '' : 's'}
            </p>
          )}
          {paper.tldr && (
            <p className="reader-cite-card-tldr">
              <MathText>{paper.tldr}</MathText>
            </p>
          )}
        </>
      ) : (
        <>
          <p className="reader-cite-card-entry">{plainText(entry.text)}</p>
          {!matching && (
            <p className="reader-cite-card-meta">
              Not found in {source}’s list of this paper’s references.
            </p>
          )}
        </>
      )}
      <div className="reader-cite-card-actions">
        {paper && (
          <>
            <button
              type="button"
              onClick={() => actions.open(paper)}
              title="Open this paper as its own thread, on its card home"
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => actions.read(paper)}
              title="Read this paper in its own Reader"
            >
              Read
            </button>
            <button
              type="button"
              aria-disabled={inGraph === false}
              onClick={() => inGraph !== false && actions.showInGraph(paper)}
              title={
                inGraph === false
                  ? 'Not among this Citation Graph’s papers'
                  : 'Show this paper in this paper’s Citation Graph'
              }
            >
              Show in Citation Graph
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => actions.goToReference(entry.id)}
          title="Go to it in this paper’s reference list"
        >
          Reference ↓
        </button>
      </div>
    </div>
  )
}
