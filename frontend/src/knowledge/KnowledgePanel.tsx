/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's side panel: what the clicked item is, where it fits
 * (each item that needs it, and what for), what it needs in turn, its lesson —
 * streamed the first time and kept after, with no citations since v8.17.0
 * (`lessonText` hides an older lesson's markers) — and the ways
 * forward: break it down, check it off, or go to the next lesson. Docked right of the canvas, like the
 * citation graph's detail panel, and resizable the same way.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { AnimationEvent, CSSProperties } from 'react'
import AnswerMarkdown from '../teacher/transcript/AnswerMarkdown'
import { useResizablePanel } from '../ui/useResizablePanel'
import Switch from '../ui/Switch'
import { lessonText, neededBy, needs, nextLesson, type KnowledgeMap } from './model'
import type { LessonDraft } from './useLessons'

/**
 * Render the panel for the open item.
 *
 * @param props Component props.
 * @param props.map The course.
 * @param props.nodeId The item on show.
 * @param props.draft Its lesson's stream, while being written.
 * @param props.writing True when its lesson is still streaming from an earlier visit.
 * @param props.expanding True while it is being broken down.
 * @param props.expandError Why its last breakdown failed, if it did.
 * @param props.closing The panel is sliding out.
 * @param props.onAnimationEnd Wire to `usePresence`.
 * @param props.onOpen Open another item's lesson.
 * @param props.onExpand Break the item down.
 * @param props.onToggleKnown Check it off, or un-check it.
 * @param props.onRetry Write its lesson again after a failure.
 * @param props.onClose Close the panel.
 * @returns The panel.
 */
export default function KnowledgePanel({
  map,
  nodeId,
  draft,
  writing,
  expanding,
  expandError,
  closing,
  onAnimationEnd,
  onOpen,
  onExpand,
  onToggleKnown,
  onRetry,
  onClose,
}: {
  map: KnowledgeMap
  nodeId: string
  draft?: LessonDraft
  writing: boolean
  expanding: boolean
  expandError?: string
  closing: boolean
  onAnimationEnd: (event: AnimationEvent) => void
  onOpen: (nodeId: string) => void
  onExpand: (nodeId: string) => void
  onToggleKnown: (nodeId: string) => void
  onRetry: () => void
  onClose: () => void
}) {
  const { width, onHandlePointerDown, dragging } = useResizablePanel('ca.knowledgeWidth', 400)
  const node = map.nodes[nodeId]
  if (!node) return null
  const isRoot = node.id === map.rootId
  const reasons = neededBy(map, node.id)
  const known = map.known.includes(node.id)
  const next = nextLesson(map, node.id)
  const text = lessonText(node) ?? draft?.text ?? ''
  const meta = node.paper ? [node.paper.authors, node.paper.year].filter(Boolean).join(' · ') : ''

  return (
    <aside
      className={`knowledge-panel${closing ? ' closing' : ''}`}
      data-tour="lesson-pane"
      style={{ width, '--panel-width': `${width}px` } as CSSProperties}
      onAnimationEnd={onAnimationEnd}
    >
      <div
        className={`panel-resize-handle${dragging ? ' dragging' : ''}`}
        onPointerDown={onHandlePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
      />
      <button type="button" className="link-btn close" onClick={onClose} aria-label="Close">
        ✕
      </button>

      <p className={`lesson-kicker ${known ? 'known' : isRoot ? 'paper' : 'concept'}`}>
        {/* "Known" is always in the markup so the switch can animate it in:
            the word makes room, then rises in (knowledge.css). Hidden from
            screen readers while it isn't true. */}
        <span className="kicker-known" aria-hidden={!known}>
          Known{'\u00a0'}
        </span>
        {isRoot ? 'Paper' : 'Concept'}
      </p>
      <h2 className="lesson-title">{node.title}</h2>
      {meta && <p className="lesson-meta">{meta}</p>}

      {/* How it fits the course: each item that needs this one, and what for.
          The item's name heads its reason; until v8.17.0 a line read
          "<item> needs it: <why>", which Patrick found clunky. */}
      {reasons.length > 0 && (
        <ul className="lesson-reasons" aria-label="Where this fits in the course">
          {reasons.map((edge) => (
            <li key={edge.from}>
              <button
                type="button"
                onClick={() => onOpen(edge.from)}
                title={`Open ${map.nodes[edge.from]?.title ?? 'it'}`}
              >
                {map.nodes[edge.from]?.title}
              </button>
              <span>{edge.why}</span>
            </li>
          ))}
        </ul>
      )}

      {expandError && (
        <p className="lesson-error">
          {expandError}{' '}
          <button type="button" onClick={() => onExpand(node.id)}>
            Try again
          </button>
        </p>
      )}
      {node.expanded && !needs(map, node.id).length && (
        <p className="lesson-status">Nothing further to break down — this one is a foundation.</p>
      )}

      <div className="lesson-body">
        {text ? (
          <AnswerMarkdown text={text} />
        ) : (
          !draft?.error &&
          (draft || writing) && (
            <p className="lesson-status">
              <span className="spin" /> Writing the lesson…
            </p>
          )
        )}
        {draft?.error && (
          <p className="lesson-error">
            {draft.error}{' '}
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </p>
        )}
      </div>

      <footer className="lesson-foot" data-tour="lesson-foot">
        {/* "Known" beside the switch, its fuller name in the tooltip. */}
        <span className="lesson-known" title="I know this">
          <Switch checked={known} label="I know this" onChange={() => onToggleKnown(node.id)}>
            Known
          </Switch>
        </span>
        <span className="lesson-foot-gap" />
        {expanding ? (
          <span className="lesson-status">
            <span className="spin" /> Breaking it down…
          </span>
        ) : (
          !node.expanded && (
            <button
              type="button"
              className="lesson-action"
              onClick={() => onExpand(node.id)}
              title="Add what this needs to the graph (or double-click the node)"
            >
              + Break it down
            </button>
          )
        )}
        {next && next !== node.id ? (
          <button
            type="button"
            className="lesson-next"
            onClick={() => onOpen(next)}
            title={`Next: ${map.nodes[next].title}`}
          >
            Next lesson ›
          </button>
        ) : (
          !next && <span className="lesson-status">That’s the whole course.</span>
        )}
      </footer>
    </aside>
  )
}
