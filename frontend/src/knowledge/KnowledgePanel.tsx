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
 * citation graph's detail panel, and resizable the same way. Since v8.25.0 a
 * passage highlighted in a finished lesson opens a small menu
 * (`SelectionMenu`): Explain asks the course's assistant about it, Expand
 * adds the idea it names to the graph, as something this item needs.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState, type AnimationEvent, type CSSProperties } from 'react'
import type { AnswerFigure } from '../api'
import FigCard from '../figures/FigCard'
import { splitAnswer } from '../figures/split'
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
import SelectionMenu from './SelectionMenu'
import { useLessonSelection } from './useLessonSelection'
import type { LessonDraft } from './useLessons'

/**
 * Where a lesson's Expand has got to (v8.25.0), shown above the lesson:
 * naming the concept, or what became of it.
 */
export interface PhraseNote {
  /** The item whose lesson the passage is in. */
  nodeId: string
  /** `working` while the tutor names it; `added`, a new prerequisite;
   *  `linked`, one already there; `self`, the passage names this item or
   *  one above it; `loop`, the concept already needs this item, so it
   *  can't come before it too; `error`, the tutor failed. */
  state: 'working' | 'added' | 'linked' | 'self' | 'loop' | 'error'
  /** The passage while working, the concept's name after, or the error. */
  text: string
  /** The concept's id, to open it. */
  childId?: string
}

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
 * The Quick response bolt: an outline that lights up on hover (`--bolt`)
 * (knowledge.css), drawn inline so it takes the link's colour.
 *
 * @returns The icon.
 */
function Bolt() {
  return (
    <svg className="lesson-quick-bolt" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2L13.5 2Z" />
    </svg>
  )
}

/**
 * What the tutor is doing (v8.24.0): one line, each new step rising in from
 * below in place of the last (Patrick: like a chat app's "thinking" line;
 * ported from the parked `feature/visuals`), cut short with an ellipsis. A
 * click unfolds every step so far, the tutor's train of thought, as plain
 * lines (the researcher's trace, without its chips).
 *
 * @param props Component props.
 * @param props.text The step now.
 * @param props.steps Every step so far, oldest first.
 * @param props.onQuick Give up on the images and have the lesson now, when
 *   that is still on offer.
 * @returns The line.
 */
function StepLine({
  text,
  steps = [],
  onQuick,
}: {
  text: string
  steps?: string[]
  onQuick?: () => void
}) {
  const [open, setOpen] = useState(false)
  const earlier = steps.filter((step, index) => index < steps.length - 1 || step !== text)
  return (
    <div className={`lesson-step${open ? ' open' : ''}`}>
      <div className="lesson-step-row">
        <span className="spin" />
        <button
          type="button"
          className="lesson-step-toggle"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          title={open ? 'Hide the steps' : 'Show every step so far'}
          disabled={!earlier.length}
        >
          {earlier.length > 0 && (
            <span className={`trace-caret${open ? ' open' : ''}`} aria-hidden="true">
              ▸
            </span>
          )}
          {/* Keyed by its words, so each new step mounts and plays the rise. */}
          <span key={text} className="lesson-step-text" aria-live="polite">
            {text}
          </span>
        </button>
        {onQuick && (
          <button
            type="button"
            className="link-btn lesson-quick"
            onClick={onQuick}
            title="Skip the image search: the lesson now, from the tutor's own knowledge"
          >
            <Bolt />
            Quick response
          </button>
        )}
      </div>
      {open && earlier.length > 0 && (
        <ol className="lesson-steps" aria-label="Steps so far">
          {earlier.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * Render the panel for the open item.
 *
 * @param props Component props.
 * @param props.map The course.
 * @param props.nodeId The item on show.
 * @param props.draft Its lesson while being written: the step it is on, or why it failed.
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
 * @param props.onRewrite Write its finished lesson again, past the cache
 *   (v8.24.0, the ↻ beside the ✕).
 * @param props.onQuick Stop writing its lesson with images and write it now,
 *   from the tutor's own knowledge (a quick response, v8.24.0).
 * @param props.onDelete Delete the item (any but the paper).
 * @param props.onHover Point at an item on the graph from its Connections row, or let go.
 * @param props.onEnlarge Show one of its lesson's images full-screen.
 * @param props.onExplain Ask the course's assistant about a highlighted passage.
 * @param props.onExpandPhrase Add the idea a highlighted passage names to the
 *   graph, as something the item needs.
 * @param props.phrase Where the last Expand has got to.
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
  onRewrite,
  onQuick,
  onDelete,
  onHover,
  onEnlarge,
  onExplain,
  onExpandPhrase,
  phrase,
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
  onRewrite: () => void
  onQuick: () => void
  onDelete: (nodeId: string) => void
  onHover?: (nodeId: string | null) => void
  onEnlarge: (figure: AnswerFigure) => void
  onExplain: (text: string) => void
  onExpandPhrase: (text: string) => void
  phrase?: PhraseNote | null
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
  // The lesson follows its own writing (v8.24.0), the way the assistant's
  // transcript does: only while the reader is at the bottom, so scrolling up
  // to re-read stops the chase and scrolling back down resumes it. Instant,
  // never smooth: a smooth scroll can't keep up with the stream.
  const scrollRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const onScroll = () => {
    const box = scrollRef.current
    if (box) following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  }
  // A passage highlighted in the finished lesson (v8.25.0).
  const bodyRef = useRef<HTMLDivElement>(null)
  const lessonDone = !!map.nodes[nodeId]?.lesson && !draft
  const { selection, clear: clearSelection } = useLessonSelection(bodyRef, lessonDone)
  const streamed = draft?.text.length ?? 0
  useEffect(() => {
    // A new lesson starts at its top, ready to follow.
    following.current = true
  }, [nodeId])
  useEffect(() => {
    const box = scrollRef.current
    if (!box || !streamed || !following.current) return
    box.scrollTop = box.scrollHeight
  }, [streamed])
  if (!node) return null
  const isRoot = node.id === map.rootId
  const isSynthesis = node.kind === 'synthesis'
  const groups = connectionsOf(map, node.id)
  // What its breakdown gave that has since been deleted (v8.23.0).
  const missing = missingChildren(map, node.id)
  const known = map.known.includes(node.id)
  const next = nextLesson(map, node.id)
  // A lesson streams once the tutor starts writing, its images already placed
  // (v8.24.0); until then the draft's step is the one status line.
  const text = lessonText(node) ?? draft?.text ?? ''
  // Its closing "How it fits in" section shows in its own card (v8.23.0).
  const { body, fit } = splitLesson(text)
  // Its images sit at their `<<FIG n>>` markers, after the paragraphs they
  // illustrate (v8.24.0); one whose marker went missing shows at the end.
  const { parts, leftover } = splitAnswer(body, node.images ?? draft?.images)
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
      {/* Rewrite this lesson (v8.24.0): the footer is full, so a captionless
          ↻ beside the ✕, there only once the lesson is finished. */}
      {node.lesson && !draft && !writing && (
        <button
          type="button"
          className="link-btn rewrite"
          onClick={onRewrite}
          title="Rewrite this lesson"
          aria-label="Rewrite this lesson"
        >
          ↻
        </button>
      )}
      {/* The panel scrolls inside this, not itself (v8.23.0): the resize
          handle, sized to the panel, scrolled away with the lesson, leaving
          nothing to grab below the first screenful. */}
      <div className="knowledge-panel-scroll" ref={scrollRef} onScroll={onScroll}>
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
        {phrase && phrase.nodeId === node.id && (
          <p className={phrase.state === 'error' ? 'lesson-error' : 'lesson-status'}>
            {phrase.state === 'working' && (
              <>
                <span className="spin" /> Adding “{phrase.text}” to the graph…
              </>
            )}
            {phrase.state === 'error' && phrase.text}
            {phrase.state === 'self' && `“${phrase.text}” is what this lesson is about already.`}
            {phrase.state === 'loop' &&
              `“${phrase.text}” already builds on this, so it can't come before it as well.`}
            {(phrase.state === 'added' || phrase.state === 'linked') && phrase.childId && (
              <>
                {phrase.state === 'added' ? 'Added' : 'Already in the course:'}
                <button
                  type="button"
                  className="link-btn lesson-phrase-open"
                  onClick={() => onOpen(phrase.childId!)}
                  title={`Open ${phrase.text}`}
                >
                  {phrase.text}
                </button>
                {phrase.state === 'added' && 'as something this needs.'}
              </>
            )}
          </p>
        )}
        <div className="lesson-body" ref={bodyRef}>
          {text ? (
            <>
              {parts.map((part, index) =>
                typeof part === 'string' ? (
                  <AnswerMarkdown key={index} text={part} />
                ) : (
                  <div key={index} className="lesson-image">
                    <FigCard figure={part} onEnlarge={onEnlarge} />
                  </div>
                ),
              )}
              {/* While streaming, an image whose marker hasn't arrived yet
                  waits for it rather than flashing at the end. */}
              {(node.lesson ? leftover : []).map((figure, index) => (
                <div key={`left-${index}`} className="lesson-image">
                  <FigCard figure={figure} onEnlarge={onEnlarge} />
                </div>
              ))}
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
              <StepLine
                text={draft?.step || 'Writing the lesson…'}
                steps={draft?.steps}
                onQuick={draft?.quick ? undefined : onQuick}
              />
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

        {selection && (
          <SelectionMenu
            selection={selection}
            onExplain={(passage) => {
              clearSelection()
              onExplain(passage)
            }}
            onExpand={(passage) => {
              clearSelection()
              onExpandPhrase(passage)
            }}
          />
        )}

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
