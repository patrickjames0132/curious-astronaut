/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's side panel: what the clicked item is, its
 * Connections (what it is required for, and why, and what it depends on), its lesson —
 * streamed the first time and kept after, with no citations since v8.17.0
 * (`lessonText` hides an older lesson's markers) — and the ways
 * forward: break it down, check it off, or go to the next lesson. Since
 * v8.23.0 any item but the paper can be deleted; "Break it down" on the
 * item above brings it back from the remembered breakdown, and "Break it
 * down again" asks the tutor for a fresh one. A synthesis's Connections are
 * what it builds toward and what it combines, then its lesson. It can't be
 * broken down, but it can be checked off as known, like a concept. Docked right of the canvas, like the
 * citation graph's detail panel, and resizable the same way.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useState, type AnimationEvent, type CSSProperties } from 'react'
import Fold from '../ui/Fold'
import AnswerMarkdown from '../teacher/transcript/AnswerMarkdown'
import { useResizablePanel } from '../ui/useResizablePanel'
import { nodeLook } from './look'
import {
  lessonText,
  missingChildren,
  splitLesson,
  neededBy,
  needs,
  nextLesson,
  type KnowledgeMap,
} from './model'
import type { LessonDraft } from './useLessons'

/** localStorage key: whether the Connections card is open (per browser).
 *  Named for the card's first name, "Where it fits", kept so the choice
 *  survives the rename. */
const CONNECTIONS_KEY = 'ca.knowledgeFitOpen'

/**
 * Whether the Connections card was left open; open when unknown.
 *
 * @returns The remembered state.
 */
function readConnectionsOpen(): boolean {
  try {
    return localStorage.getItem(CONNECTIONS_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Remember whether the card is open; a private window just doesn't.
 *
 * @param open The new state.
 */
function writeConnectionsOpen(open: boolean): void {
  try {
    localStorage.setItem(CONNECTIONS_KEY, open ? '1' : '0')
  } catch {
    // Unwritable storage: the choice lasts for this visit only.
  }
}

/** One of the card's sections: its heading, and the ids under it. */
interface ConnectionGroup {
  label: string
  items: string[]
}

/**
 * The item's immediate links, grouped for the Connections card (v8.23.0):
 * what it builds toward and what it combines, the same two for every kind
 * (Patrick: "Required for" and "Depends on" for a concept read less true,
 * and two vocabularies for one card were inconsistent): for a concept or the
 * paper, what needs it and what it needs; for a synthesis, its target and
 * its members. Empty
 * groups are left out. How it serves what needs it is the lesson's closing
 * "How it fits in" card, not a reason per row here.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns Its groups, in reading order.
 */
function connectionsOf(map: KnowledgeMap, nodeId: string): ConnectionGroup[] {
  const node = map.nodes[nodeId]
  const groups: ConnectionGroup[] =
    node.kind === 'synthesis'
      ? [
          { label: 'Builds toward', items: node.toward ? [node.toward] : [] },
          { label: 'Combines', items: node.members ?? [] },
        ]
      : [
          { label: 'Builds toward', items: neededBy(map, nodeId).map((edge) => edge.from) },
          { label: 'Combines', items: needs(map, nodeId).map((edge) => edge.to) },
        ]
  return groups
    .map((group) => ({ ...group, items: group.items.filter((id) => map.nodes[id]) }))
    .filter((group) => group.items.length)
}

/**
 * The Connections card (v8.23.0, Patrick; "Where it fits" until then): the
 * item's immediate links as one-line rows, each with a dot in its node's
 * own colour and its name as a link; hovering a row rings its node on the
 * graph, and only that node. (A row's tutor reason folded under a caret for
 * one round; the lesson's "How it fits in" card says it better.) Each section scrolls
 * past about five rows, and the whole card folds away, remembered per
 * browser. The deeper tree is the pyramid view's job, not this card's.
 *
 * @param props Component props.
 * @param props.map The course.
 * @param props.groups The sections (`connectionsOf`).
 * @param props.open Whether the card is unfolded.
 * @param props.onToggle Fold or unfold it.
 * @param props.onOpen Open a linked item.
 * @param props.onHover Point at a linked item on the graph, or let go (null).
 * @returns The card.
 */
function ConnectionsCard({
  map,
  groups,
  open,
  onToggle,
  onOpen,
  onHover,
}: {
  map: KnowledgeMap
  groups: ConnectionGroup[]
  open: boolean
  onToggle: () => void
  onOpen: (nodeId: string) => void
  onHover?: (nodeId: string | null) => void
}) {
  return (
    <section className="lesson-card">
      <button
        type="button"
        className={`lesson-card-head${open ? ' open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        title={open ? 'Fold this away' : 'Show what this connects to'}
      >
        <span className="lesson-card-caret" aria-hidden="true">
          ▸
        </span>
        Connections
      </button>
      <Fold open={open}>
        {groups.map((group) => (
          <div className="connections-group" key={group.label}>
            <h3 className="connections-label">
              {group.label} · {group.items.length}
            </h3>
            <ul className="connections-list" aria-label={group.label}>
              {group.items.map((id) => {
                const linked = map.nodes[id]
                return (
                  <li
                    key={id}
                    onMouseEnter={() => onHover?.(id)}
                    onMouseLeave={() => onHover?.(null)}
                  >
                    <span
                      className={`connections-dot${linked.kind === 'synthesis' ? ' diamond' : ''}`}
                      style={{ background: nodeLook(map, linked).color }}
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="connections-name"
                      onClick={() => onOpen(id)}
                      title={`Open ${linked.title}`}
                    >
                      {linked.title}
                    </button>
                    {map.known.includes(id) && (
                      <span className="connections-known" title="Known">
                        ✓
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </Fold>
    </section>
  )
}

/**
 * Render the panel for the open item.
 *
 * @param props Component props.
 * @param props.map The course.
 * @param props.nodeId The item on show.
 * @param props.draft Its lesson's stream, while being written.
 * @param props.writing True when its lesson is still streaming from an earlier visit.
 * @param props.refitting True while its "How it fits in" section is being rewritten.
 * @param props.expanding True while it is being broken down.
 * @param props.expandError Why its last breakdown failed, if it did.
 * @param props.closing The panel is sliding out.
 * @param props.onAnimationEnd Wire to `usePresence`.
 * @param props.onOpen Open another item's lesson.
 * @param props.onExpand Break the item down; one broken down already gets
 *                       back what was deleted, and `again` asks for a fresh breakdown.
 * @param props.onToggleKnown Check it off, or un-check it.
 * @param props.onRetry Write its lesson again after a failure.
 * @param props.onDelete Delete the item (any but the paper).
 * @param props.onHover Point at an item on the graph from its Connections row, or let go.
 * @param props.onClose Close the panel.
 * @returns The panel.
 */
export default function KnowledgePanel({
  map,
  nodeId,
  draft,
  writing,
  refitting = false,
  expanding,
  expandError,
  closing,
  onAnimationEnd,
  onOpen,
  onExpand,
  onToggleKnown,
  onRetry,
  onDelete,
  onHover,
  onClose,
}: {
  map: KnowledgeMap
  nodeId: string
  draft?: LessonDraft
  writing: boolean
  refitting?: boolean
  expanding: boolean
  expandError?: string
  closing: boolean
  onAnimationEnd: (event: AnimationEvent) => void
  onOpen: (nodeId: string) => void
  onExpand: (nodeId: string, again?: boolean) => void
  onToggleKnown: (nodeId: string) => void
  onRetry: () => void
  onDelete: (nodeId: string) => void
  onHover?: (nodeId: string | null) => void
  onClose: () => void
}) {
  const { width, onHandlePointerDown, dragging } = useResizablePanel('ca.knowledgeWidth', 400)
  const [connectionsOpen, setConnectionsOpen] = useState(() => readConnectionsOpen())
  const toggleConnections = () =>
    setConnectionsOpen((previous) => {
      writeConnectionsOpen(!previous)
      return !previous
    })
  // The paper's "Break it down again" asks first (v8.23.0): it replaces the
  // course's whole top level. Held by id, so opening another item drops it.
  const [confirmingFor, setConfirmingFor] = useState<string | null>(null)
  // The item whose Known button was just pressed, so its mark animates once,
  // on the click itself (the 💡 pops in, the 🤔 rises in), not every time
  // an item is opened.
  const [justToggled, setJustToggled] = useState<string | null>(null)
  const node = map.nodes[nodeId]
  if (!node) return null
  const isRoot = node.id === map.rootId
  const isSynthesis = node.kind === 'synthesis'
  const groups = connectionsOf(map, node.id)
  // What its breakdown gave that has since been deleted (v8.23.0).
  const missing = missingChildren(map, node.id)
  const known = map.known.includes(node.id)
  const next = nextLesson(map, node.id)
  const text = lessonText(node) ?? draft?.text ?? ''
  // Its closing "How it fits in" section shows in its own card (v8.23.0).
  const { body, fit } = splitLesson(text)
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
      {/* The panel scrolls inside this, not itself (v8.23.0): the resize
          handle, sized to the panel, scrolled away with the lesson, leaving
          nothing to grab below the first screenful. */}
      <div className="knowledge-panel-scroll">
        <p
          className={`lesson-kicker ${known ? 'known' : isSynthesis ? 'synthesis' : isRoot ? 'paper' : 'concept'}`}
        >
          {/* "Known" is always in the markup so the switch can animate it in:
            the word makes room, then rises in (knowledge.css). Hidden from
            screen readers while it isn't true. */}
          <span className="kicker-known" aria-hidden={!known}>
            Known{'\u00a0'}
          </span>
          {isSynthesis ? 'Synthesis' : isRoot ? 'Paper' : 'Concept'}
        </p>
        <h2 className="lesson-title">{node.title}</h2>
        {meta && <p className="lesson-meta">{meta}</p>}

        {/* Its immediate links, in a card that folds away (v8.23.0). */}
        {groups.length > 0 && (
          <ConnectionsCard
            key={node.id}
            map={map}
            groups={groups}
            open={connectionsOpen}
            onToggle={toggleConnections}
            onOpen={onOpen}
            onHover={onHover}
          />
        )}

        {expandError && (
          <p className="lesson-error">
            {expandError}{' '}
            <button type="button" onClick={() => onExpand(node.id, !!node.expanded)}>
              Try again
            </button>
          </p>
        )}
        {node.expanded && !needs(map, node.id).length && !missing.length && (
          <p className="lesson-status">Nothing further to break down — this one is a foundation.</p>
        )}
        <div className="lesson-body">
          {text ? (
            <>
              <AnswerMarkdown text={body} />
              {fit !== null && (
                <aside className="lesson-fit" aria-label="How it fits in">
                  <h3>How it fits in</h3>
                  {fit && <AnswerMarkdown text={fit} />}
                  {refitting && (
                    <p className="lesson-status">
                      <span className="spin" /> Updating for what needs it now…
                    </p>
                  )}
                </aside>
              )}
            </>
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
          {/* The paper's redo confirmation comes first: it floats above the
            footer, out of the row, so the narrow grid's last-cell rule in
            knowledge.css counts only what follows. */}
          {confirmingFor === node.id && (
            <div
              className="lesson-confirm"
              role="alertdialog"
              aria-label="Break the paper down again?"
            >
              <p>
                <strong>Are you sure?</strong> A fresh breakdown of the paper starts the course
                over: everything below the paper leaves the graph, and its concepts come back new,
                their lessons rewritten when you open them. Breaking one down again is instant (it’s
                cached), and anything you checked off stays known.
              </p>
              <div className="lesson-confirm-actions">
                <button
                  type="button"
                  className="lesson-action"
                  onClick={() => setConfirmingFor(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="lesson-action danger"
                  onClick={() => {
                    setConfirmingFor(null)
                    onExpand(node.id, true)
                  }}
                >
                  Break it down again
                </button>
              </div>
            </div>
          )}
          {/* A button like its neighbours since v8.23.0 (it was a switch):
            "Unknown", and "Known" in the known green once pressed. */}
          <button
            type="button"
            className={`lesson-action lesson-known${known ? ' on' : ''}${
              justToggled === node.id ? ' pop' : ''
            }`}
            aria-pressed={known}
            onClick={() => {
              setJustToggled(node.id)
              onToggleKnown(node.id)
            }}
            title={
              known
                ? 'You know this: the course skips it, with what only it needs. Click to take it back'
                : 'I know this: the course skips it, with what only it needs'
            }
          >
            {/* 🤔 while unknown, a 💡 that lights up once it's known
                (Patrick); decoration, so the name stays the word. */}
            <span
              className="lesson-known-mark"
              aria-hidden="true"
              // Played once: reopening the item later doesn't replay it.
              onAnimationEnd={(event) => {
                event.stopPropagation()
                setJustToggled(null)
              }}
            >
              {known ? '💡' : '🤔'}
            </span>
            {known ? 'Known' : 'Unknown'}
          </button>
          {!isRoot && (
            <button
              type="button"
              className="lesson-action"
              onClick={() => onDelete(node.id)}
              title={
                isSynthesis
                  ? 'Delete this synthesis, and any synthesis that would be left with fewer than two parts'
                  : 'Delete this, with what only it needs and any synthesis left short. Break down what needed it to bring it back'
              }
            >
              Delete
            </button>
          )}
          {/* One breakdown button (v8.23.0): break it down; once broken down,
            bring back what was deleted, with a count of what returns; and
            with nothing missing, ask for a fresh breakdown. */}
          {expanding ? (
            <span className="lesson-status">
              <span className="spin" /> Breaking it down…
            </span>
          ) : (
            !isSynthesis &&
            (!node.expanded ? (
              <button
                type="button"
                className="lesson-action"
                onClick={() => onExpand(node.id)}
                title="Add what this needs to the graph (or double-click the node)"
              >
                + Break it down
              </button>
            ) : missing.length ? (
              <button
                type="button"
                className="lesson-action"
                onClick={() => onExpand(node.id)}
                title={`Bring back what was deleted, as it was (or double-click the node): ${missing.map((child) => child.name).join(', ')}`}
              >
                + Break it down <span className="lesson-count">{missing.length}</span>
              </button>
            ) : (
              <button
                type="button"
                className="lesson-action"
                onClick={() => (isRoot ? setConfirmingFor(node.id) : onExpand(node.id, true))}
                aria-expanded={isRoot ? confirmingFor === node.id : undefined}
                title="Ask the tutor for a fresh breakdown: everything below this starts over, new, with its lessons rewritten when opened (what something else still needs stays). Check-offs survive"
              >
                ↻ Break it down again
              </button>
            ))
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
      </div>
    </aside>
  )
}
