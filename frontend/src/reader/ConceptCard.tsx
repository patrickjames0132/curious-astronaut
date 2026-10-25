/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The card a Knowledge Graph note's concept opens (v8.44.0), so the reader
 * stays in the paper (Patrick): why the course needs the concept, a
 * check-off that is the course's own (the Knowledge Graph shows it too),
 * the opening of its lesson when one is written, and a way to the whole
 * lesson in the Knowledge Graph. Placed and timed like the citation card
 * (`useAnchoredCard`), and styled with it.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { CSSProperties } from 'react'
import {
  lessonText,
  routeWhy,
  splitLesson,
  withoutImageMarks,
  type KnowledgeMap,
} from '../knowledge/model'
import MathText from '../notation/MathText'
import AnswerMarkdown from '../teacher/transcript/AnswerMarkdown'
import type { CardPlacement } from './CitationCard'

/**
 * A lesson's first paragraph of prose, for a taste of it.
 *
 * @param lesson The lesson's Markdown.
 * @returns The first paragraph that isn't a heading, or ''.
 */
function lessonOpening(lesson: string): string {
  const body = withoutImageMarks(splitLesson(lesson).body)
  return (
    body
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .find((paragraph) => paragraph && !paragraph.startsWith('#')) ?? ''
  )
}

/**
 * The card.
 *
 * @param props Component props.
 * @param props.id The concept.
 * @param props.map The course.
 * @param props.pinned Whether a click pinned it (it then has a close).
 * @param props.placement Where it sits.
 * @param props.onToggleKnown Check it off as known, or take that back.
 * @param props.onOpen Open it in the Knowledge Graph.
 * @param props.onClose Close it.
 * @param props.onPointerEnter Keep a preview open while the pointer is on it.
 * @param props.onPointerLeave Let a preview close.
 * @returns The card, or nothing when the concept has left the course.
 */
export default function ConceptCard({
  id,
  map,
  pinned,
  placement,
  onToggleKnown,
  onOpen,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  id: string
  map: KnowledgeMap
  pinned: boolean
  placement: CardPlacement
  onToggleKnown: () => void
  onOpen: () => void
  onClose: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
}) {
  const node = map.nodes[id]
  if (!node) return null
  const known = map.known.includes(id)
  const why = routeWhy(map, id)
  const lesson = lessonText(node)
  const opening = lesson ? lessonOpening(lesson) : ''
  const style: CSSProperties = { top: placement.top, left: placement.left }
  return (
    <div
      className={`reader-cite-card reader-concept-card${placement.above ? ' above' : ''}${pinned ? ' pinned' : ''}`}
      style={style}
      role="dialog"
      aria-label={`Concept: ${node.title}`}
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
        <MathText>{node.title}</MathText>
      </p>
      {why && (
        <p className="reader-cite-card-meta">
          <MathText>{why}</MathText>
        </p>
      )}
      {opening && (
        <div className="reader-concept-card-lesson">
          <AnswerMarkdown text={opening} />
        </div>
      )}
      <div className="reader-cite-card-actions">
        <button
          type="button"
          className="reader-known-toggle"
          aria-pressed={known}
          onClick={onToggleKnown}
          title={
            known
              ? 'Take back the check-off: the course teaches it again'
              : 'Check it off as known: the course skips it, as in the Knowledge Graph'
          }
        >
          <span className="reader-concept-check" aria-hidden="true">
            ✓
          </span>
          {known ? 'Known' : 'Mark as known'}
        </button>
        <button
          type="button"
          onClick={onOpen}
          title={
            lesson
              ? 'Read its whole lesson in the Knowledge Graph'
              : 'Open it in the Knowledge Graph, where its lesson is written'
          }
        >
          {lesson ? 'Read lesson in Knowledge Graph' : 'Open in Knowledge Graph'}
        </button>
      </div>
    </div>
  )
}
