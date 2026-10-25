/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A Knowledge Graph note beside a section of the paper (v8.44.0): the
 * concepts from the thread's course that the section builds on, each a
 * button opening its card (`ConceptCard`), a green ✓ on the ones checked off
 * as known, outlined in the Knowledge Graph's gold so they read as its own
 * (Patrick). In the margin when the pane has room for it, else under the
 * section's heading (`reader.css`). Long notes show their first three and
 * "+N more", and a chip's name ends in an ellipsis when it won't fit (its
 * tooltip has it whole). A concept two sections build on is in
 * both their notes, so a chip's card is keyed by its note too (`slot`):
 * only the chip that was clicked lights up (Patrick).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState } from 'react'
import type { KnowledgeMap } from '../knowledge/model'
import { NOTES_CHANGED, type CardControls } from './links'
import { chipId } from './useConceptNotes'

/** The most chips a note shows before "+N more" (Patrick: a narrow PDF
 *  margin piled long notes on each other). */
const SHOWN = 3

/**
 * The note.
 *
 * @param props Component props.
 * @param props.slot Which note this is: its section, or its place in the PDF.
 * @param props.ids The concepts the section needs, in course order.
 * @param props.map The course.
 * @param props.card The concept card's controls.
 * @returns The note.
 */
export default function ConceptNote({
  slot,
  ids,
  map,
  card,
}: {
  slot: string
  ids: string[]
  map: KnowledgeMap
  card: CardControls
}) {
  const known = new Set(map.known)
  const [expanded, setExpanded] = useState(false)
  // Tell the margin's layout (useMarginNotes) once the note has its new size.
  const note = useRef<HTMLElement>(null)
  const toggled = useRef(false)
  useEffect(() => {
    if (!toggled.current) return
    note.current?.dispatchEvent(new Event(NOTES_CHANGED, { bubbles: true }))
  }, [expanded])
  const present = ids.filter((id) => map.nodes[id])
  const shown = expanded ? present : present.slice(0, SHOWN)
  const hidden = present.length - shown.length
  return (
    <aside
      ref={note}
      className="reader-concepts"
      aria-label="From your Knowledge Graph"
      data-tour="reader-notes"
    >
      {/* The faint curve to the heading, drawn by useMarginNotes when the
          note sits in the margin. */}
      <svg className="reader-concepts-link" aria-hidden="true">
        <path />
      </svg>
      <span className="reader-concepts-label">Builds on</span>
      {shown.map((id) => {
        const node = map.nodes[id]
        const isKnown = known.has(id)
        const cardId = chipId(slot, id)
        return (
          <button
            key={id}
            type="button"
            className={`reader-concept${isKnown ? ' known' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={card.open === cardId}
            title={isKnown ? `${node.title}: you know this` : node.title}
            onPointerEnter={(event) => card.hover(cardId, event.currentTarget)}
            onPointerLeave={() => card.leave()}
            onClick={(event) => card.pin(cardId, event.currentTarget)}
          >
            {/* Always there, so checking it off and taking that back can
                both animate (reader.css). */}
            <span className="reader-concept-check" aria-hidden="true">
              ✓
            </span>
            <span className="reader-concept-name">{node.title}</span>
          </button>
        )
      })}
      {(hidden > 0 || expanded) && present.length > SHOWN && (
        <button
          type="button"
          className="reader-concepts-more"
          aria-expanded={expanded}
          onClick={() => {
            toggled.current = true
            setExpanded(!expanded)
          }}
          title={expanded ? 'Show only the first few' : 'Show every concept this section builds on'}
        >
          {expanded ? 'Show fewer' : `+${hidden} more`}
        </button>
      )}
    </aside>
  )
}
