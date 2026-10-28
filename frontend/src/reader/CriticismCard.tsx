/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The card a criticism note's chip opens (v8.54.0), so the reader stays in
 * the paper: the criticism's number and headline, how many papers raise
 * it, its summary, and its most-cited quote with the paper that wrote it;
 * then **Read in Criticisms**, which opens the Criticisms card at it, with
 * a way back here. Placed and timed like the citation card
 * (`useAnchoredCard`), styled with it, in the Criticisms card's sage.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { CSSProperties } from 'react'
import type { Criticism } from '../api'
import type { CardPlacement } from './CitationCard'

/**
 * The card.
 *
 * @param props Component props.
 * @param props.number The criticism's number, from 1.
 * @param props.criticism The criticism.
 * @param props.pinned Whether a click pinned it (it then has a close).
 * @param props.placement Where it sits.
 * @param props.onOpen Open the Criticisms card at it.
 * @param props.onClose Close it.
 * @param props.onPointerEnter Keep a preview open while the pointer is on it.
 * @param props.onPointerLeave Let a preview close.
 * @returns The card.
 */
export default function CriticismCard({
  number,
  criticism,
  pinned,
  placement,
  onOpen,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  number: number
  criticism: Criticism
  pinned: boolean
  placement: CardPlacement
  onOpen: () => void
  onClose: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}) {
  const style: CSSProperties = { top: placement.top, left: placement.left }
  const quote = criticism.quotes[0]
  return (
    <div
      className={`reader-cite-card reader-criticism-card${placement.above ? ' above' : ''}${pinned ? ' pinned' : ''}`}
      style={style}
      role="dialog"
      aria-label={`Criticism ${number}: ${criticism.name}`}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
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
      <p className="reader-cite-card-title">
        <span className="reader-criticism-number">{number}</span>
        {criticism.name}
      </p>
      <p className="reader-cite-card-meta">
        Raised by {criticism.papers} {criticism.papers === 1 ? 'paper' : 'papers'}
      </p>
      <p>{criticism.summary}</p>
      {quote && (
        <blockquote className="reader-criticism-quote">
          “{quote.text}”
          <cite>
            {quote.paper.title}
            {quote.paper.year ? ` · ${quote.paper.year}` : ''}
          </cite>
        </blockquote>
      )}
      <div className="reader-cite-card-actions">
        <button
          type="button"
          onClick={onOpen}
          title="Open the Criticisms card at this criticism, with every quote and the papers that raise it"
        >
          Read in Criticisms
        </button>
      </div>
    </div>
  )
}
