/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's side panel: what the clicked item is, why the course
 * needs it (every item that points at it), what it needs in turn, its lesson —
 * streamed the first time, kept after, with `[n]` citations of the paper's
 * real references that open the cited paper in its own thread — and the ways
 * forward: break it down, check it off, or go to the next lesson. Docked right of the canvas, like the
 * citation graph's detail panel, and resizable the same way.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { AnimationEvent, CSSProperties } from 'react'
import type { Provider } from '../api'
import AnswerMarkdown from '../teacher/transcript/AnswerMarkdown'
import { useResizablePanel } from '../ui/useResizablePanel'
import { needs, neededBy, nextLesson, type KnowledgeMap } from './model'
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
 * @param props.onOpenPaper Open a cited paper in its own thread.
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
  onOpenPaper,
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
  onOpenPaper: (paperId: string, provider?: Provider) => void
  onClose: () => void
}) {
  const { width, onHandlePointerDown, dragging } = useResizablePanel('ca.knowledgeWidth', 400)
  const node = map.nodes[nodeId]
  if (!node) return null
  const isRoot = node.id === map.rootId
  const reasons = neededBy(map, node.id)
  const prerequisites = needs(map, node.id)
  const known = map.known.includes(node.id)
  const next = nextLesson(map, node.id)
  const text = node.lesson ?? draft?.text ?? ''
  const refs = node.lesson ? node.refs : draft?.refs
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

      <p className="lesson-kicker">{isRoot ? 'The paper' : 'Concept'}</p>
      <h2 className="lesson-title">{node.title}</h2>
      {meta && <p className="lesson-meta">{meta}</p>}

      {reasons.length > 0 && (
        <ul className="lesson-reasons">
          {reasons.map((edge) => (
            <li key={edge.from}>
              <button type="button" onClick={() => onOpen(edge.from)}>
                {map.nodes[edge.from]?.title}
              </button>{' '}
              needs it: {edge.why}
            </li>
          ))}
        </ul>
      )}

      <div className="lesson-actions">
        {expanding ? (
          <span className="lesson-status">
            <span className="spin" /> Breaking it down…
          </span>
        ) : !node.expanded ? (
          <button
            type="button"
            className="lesson-action"
            onClick={() => onExpand(node.id)}
            title="Add what this needs to the graph (or double-click the node)"
          >
            + Break it down
          </button>
        ) : null}
      </div>
      {expandError && (
        <p className="lesson-error">
          {expandError}{' '}
          <button type="button" onClick={() => onExpand(node.id)}>
            Try again
          </button>
        </p>
      )}
      {prerequisites.length > 0 && (
        <div className="lesson-needs">
          <span className="lesson-needs-label">Needs</span>
          {prerequisites.map((edge) => (
            <button
              key={edge.to}
              type="button"
              className={`lesson-chip${map.known.includes(edge.to) ? ' known' : ''}`}
              onClick={() => onOpen(edge.to)}
              title={edge.why}
            >
              {map.nodes[edge.to]?.title}
            </button>
          ))}
        </div>
      )}
      {node.expanded && !prerequisites.length && (
        <p className="lesson-status">Nothing further to break down — this one is a foundation.</p>
      )}

      <div className="lesson-body">
        {text ? (
          <AnswerMarkdown text={text} paperRefs={refs} onPaperSeed={onOpenPaper} />
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
        <label className="lesson-known">
          <input type="checkbox" checked={known} onChange={() => onToggleKnown(node.id)} />I know
          this
        </label>
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
