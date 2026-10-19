/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's side panel: what the clicked item is, its
 * Connections (what it is required for, and why, and what it depends on), its lesson —
 * streamed the first time and kept after, with no citations since v8.17.0
 * (`lessonText` hides an older lesson's markers) — and the ways
 * forward: break it down, check it off, or go to the next lesson. Since
 * v8.23.0 any item but the paper can be hidden (deleted, until v8.26.0);
 * "Unhide" on the item above brings it back from the remembered
 * breakdown, and "Break it down again" asks the tutor for a fresh one.
 * Since v8.26.0 it can also be deleted for good, past any unhide. A synthesis's Connections are
 * what it builds toward and what it combines, then its lesson. It can't be
 * broken down, but it can be checked off as known, like a concept. Docked right of the canvas, like the
 * citation graph's detail panel, and resizable the same way. Since v8.25.0 a
 * passage highlighted in a finished lesson opens a small menu
 * (`SelectionMenu`): Explain asks the course's assistant about it, Expand
 * adds the idea it names to the graph, as something this item needs.
 * Since v8.26.0 the header carries the Known toggle and a ⋮ menu of the
 * occasional actions (rewrite the lesson; unhide what was hidden, break
 * it down again; hide, delete permanently), leaving the footer one row: what just happened,
 * a first "Break it down", and Next lesson.
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
import { usePresence } from '../ui/usePresence'
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

/**
 * A phrase note as one plain sentence: the footer cuts the note to a line
 * (v8.26.0), and this is its tooltip, so the whole of it is a hover away.
 *
 * @param phrase The note.
 * @returns Its words.
 */
function phraseSentence(phrase: PhraseNote): string {
  switch (phrase.state) {
    case 'working':
      return `Adding “${phrase.text}” to the graph…`
    case 'added':
      return `Added ${phrase.text} as something this needs.`
    case 'linked':
      return `Already in the course: ${phrase.text}`
    case 'self':
      return `“${phrase.text}” is what this lesson is about already.`
    case 'loop':
      return `“${phrase.text}” already builds on this, so it can't come before it as well.`
    case 'error':
      return phrase.text
  }
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
 * The Connections card (v8.23.0, Patrick; "Where it fits" until then): folded,
 * one quiet line of counts ("Builds toward 1 · Combines 3", v8.26.0); unfolded, the
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
    <section className={`lesson-card${open ? ' open' : ''}`}>
      <button
        type="button"
        className={`lesson-card-head${open ? ' open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Connections: ${groups.map((group) => `${group.label} ${group.items.length}`).join(', ')}`}
        title={open ? 'Fold this away' : 'Show what this connects to'}
      >
        <span className="lesson-card-caret" aria-hidden="true">
          ▸
        </span>
        {groups.map((group, index) => (
          <span key={group.label} className="lesson-card-count">
            {index > 0 && <span aria-hidden="true">·</span>}
            {group.label} <b>{group.items.length}</b>
          </span>
        ))}
      </button>
      <Fold open={open}>
        {groups.map((group) => (
          <div className="connections-group" key={group.label}>
            <h3 className="connections-label">{group.label}</h3>
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

/** The ⋮ menu's icons (v8.26.0), each a path list on a 16px grid. */
const MENU_ICONS = {
  rewrite: ['M10.5 2.5l3 3L5.5 13.5h-3v-3z', 'M9 4l3 3'],
  hide: [
    'M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8z',
    'M9.8 8a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0z',
    'M3 13L13 3',
  ],
  unhide: [
    'M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8z',
    'M9.8 8a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0z',
  ],
  again: ['M13 8a5 5 0 1 1-1.46-3.54', 'M13 2.5v3h-3'],
  delete: ['M2.5 4.5h11', 'M6 4.5V2.8h4v1.7', 'M4 4.5l.7 9h6.6l.7-9', 'M6.8 7v4.5M9.2 7v4.5'],
}

/**
 * One of the ⋮ menu's icons (v8.26.0): line drawings of one size and
 * weight, in the entry's own colour, in place of the mixed glyphs and emoji
 * that sat at different sizes and pushed their words out of line.
 *
 * @param props Component props.
 * @param props.name Which icon.
 * @returns The inline SVG.
 */
function MenuIcon({ name }: { name: keyof typeof MENU_ICONS }) {
  return (
    <svg
      className="lesson-menu-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MENU_ICONS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
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
          {/* Keyed by its words, so each new step mounts and plays the rise. */}
          <span key={text} className="lesson-step-text" aria-live="polite">
            {text}
          </span>
          {/* After the words (v8.26.0): before them, it sat against the
              spinner as two odd marks side by side. */}
          {earlier.length > 0 && (
            <span className={`trace-caret${open ? ' open' : ''}`} aria-hidden="true">
              ▸
            </span>
          )}
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
 *   (v8.24.0; in the header's ⋮ menu since v8.26.0).
 * @param props.onQuick Stop writing its lesson with images and write it now,
 *   from the tutor's own knowledge (a quick response, v8.24.0).
 * @param props.onHide Take the item off the course, undoably (any but the paper).
 * @param props.onDelete Delete the item for good (any but the paper).
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
  onHide,
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
  onHide: (nodeId: string) => void
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
  // What can't be undone asks first (v8.26.0, Patrick): "Break it down
  // again" (on the paper since v8.23.0, where it replaces the course's whole
  // top level; on every item now, since it takes the branch with it) and
  // "Delete permanently". Held by id, so opening another item drops it.
  const [confirming, setConfirming] = useState<{
    nodeId: string
    action: 'again' | 'delete'
  } | null>(null)
  // The item whose Known button was just pressed, so its mark animates once,
  // on the click itself (the 💡 pops in, the 🤔 rises in), not every time
  // an item is opened.
  const [justToggled, setJustToggled] = useState<string | null>(null)
  // The header's ⋮ menu (v8.26.0); opening another item closes it.
  const [menuOpen, setMenuOpen] = useState(false)
  const menu = usePresence(menuOpen)
  useEffect(() => setMenuOpen(false), [nodeId])
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
  const kindWord = isSynthesis ? 'synthesis' : isRoot ? 'paper' : 'concept'
  const meta = node.paper ? [node.paper.authors, node.paper.year].filter(Boolean).join(' · ') : ''
  // The ⋮ menu's entries (v8.26.0), in three groups (Patrick): the lesson
  // (rewrite it); what shows (hide this node, unhide its hidden children;
  // a synthesis is never archived, so it can't hide); and what can't be
  // undone, both red and asking first (break it down again, delete
  // permanently). The first breakdown stays in the footer, the obvious next step.
  const canRewrite = !!node.lesson && !draft && !writing
  const canRebreak = !isSynthesis && !!node.expanded && !expanding
  const canUnhide = canRebreak && missing.length > 0
  const canTakeOff = !isRoot
  const canHide = canTakeOff && !isSynthesis
  const hasMenu = canRewrite || canRebreak || canTakeOff
  const confirmingNow = confirming?.nodeId === node.id ? confirming.action : null
  /**
   * Close the menu, then run its entry.
   *
   * @param action The entry's action.
   * @returns The click handler.
   */
  const fromMenu = (action: () => void) => () => {
    setMenuOpen(false)
    action()
  }

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
      {/* The header's tools (v8.26.0): Known, the ⋮ menu, ✕. Known moved up
          from the footer, where it said again what the kicker says. */}
      <div className="lesson-tools">
        <button
          type="button"
          className={`link-btn lesson-known${known ? ' on' : ''}${
            justToggled === node.id ? ' pop' : ''
          }`}
          aria-label="Known"
          aria-pressed={known}
          onClick={() => {
            setJustToggled(node.id)
            onToggleKnown(node.id)
          }}
          title={
            known
              ? `Known or familiar ${kindWord}; lesson will be skipped`
              : `Unknown or unfamiliar ${kindWord}; lesson will not be skipped`
          }
        >
          {/* 🤔 while unknown, a 💡 that lights up once it's known (Patrick). */}
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
        </button>
        {hasMenu && (
          <button
            type="button"
            className="link-btn lesson-more"
            onClick={() => setMenuOpen((previous) => !previous)}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More actions"
          >
            ⋮
          </button>
        )}
        <button type="button" className="link-btn close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {menu.present && (
          <>
            {/* A click anywhere else closes it, as the rail's session menu. */}
            {menuOpen && <div className="rail-menu-scrim" onClick={() => setMenuOpen(false)} />}
            <div
              className={`rail-menu lesson-menu${menu.closing ? ' closing' : ''}`}
              role="menu"
              onAnimationEnd={(event) => {
                event.stopPropagation()
                menu.onAnimationEnd(event)
              }}
            >
              {canRewrite && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={fromMenu(onRewrite)}
                  title="Write this lesson again, past the cache"
                >
                  <MenuIcon name="rewrite" />
                  Rewrite this lesson
                </button>
              )}
              {canRewrite && (canHide || canUnhide) && (
                <div className="lesson-menu-rule" role="separator" />
              )}
              {canHide && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={fromMenu(() => onHide(node.id))}
                  title="Hide this, with what only it needs and any synthesis left short. Double-click what needed it (or Unhide in its ⋮) to bring it back as it was"
                >
                  <MenuIcon name="hide" />
                  Hide this node
                </button>
              )}
              {canUnhide && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={fromMenu(() => onExpand(node.id))}
                  title={`Bring back what was hidden, as it was (or double-click the node): ${missing.map((child) => child.name).join(', ')}`}
                >
                  <MenuIcon name="unhide" />
                  Unhide {missing.length} {missing.length === 1 ? 'child' : 'children'}
                </button>
              )}
              {(canRewrite || canHide || canUnhide) && (canRebreak || canTakeOff) && (
                <div className="lesson-menu-rule" role="separator" />
              )}
              {canRebreak && (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={fromMenu(() => setConfirming({ nodeId: node.id, action: 'again' }))}
                  title="Ask the tutor for a fresh breakdown: everything below this starts over, new, with its lessons rewritten when opened (what something else still needs stays). Check-offs survive"
                >
                  <MenuIcon name="again" />
                  Break it down again…
                </button>
              )}
              {canTakeOff && (
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={fromMenu(() => setConfirming({ nodeId: node.id, action: 'delete' }))}
                  title={
                    isSynthesis
                      ? 'Delete this synthesis, and any synthesis that would be left with fewer than two parts'
                      : 'Delete this for good, with what only it needs: no unhide brings it back'
                  }
                >
                  <MenuIcon name="delete" />
                  {isSynthesis ? 'Delete…' : 'Delete permanently…'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {/* The confirmations, dropping from the header's menu (v8.26.0). */}
      {confirmingNow === 'again' && (
        <div
          className="lesson-confirm"
          role="alertdialog"
          aria-label={isRoot ? 'Break the paper down again?' : 'Break this down again?'}
        >
          {isRoot ? (
            <p>
              <strong>Are you sure?</strong> A fresh breakdown of the paper starts the course over:
              everything below the paper leaves the graph, and its concepts come back new, their
              lessons rewritten when you open them. Breaking one down again is instant (it’s
              cached), and anything you checked off stays known.
            </p>
          ) : (
            <p>
              <strong>Are you sure?</strong> A fresh breakdown of <em>{node.title}</em> starts its
              branch over: everything below it leaves the graph, except what something else still
              needs, and its concepts come back new, their lessons rewritten when you open them.
              Anything you checked off stays known.
            </p>
          )}
          <div className="lesson-confirm-actions">
            <button type="button" className="lesson-action" onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="lesson-action danger"
              onClick={() => {
                setConfirming(null)
                onExpand(node.id, true)
              }}
            >
              Break it down again
            </button>
          </div>
        </div>
      )}
      {confirmingNow === 'delete' && (
        <div
          className="lesson-confirm"
          role="alertdialog"
          aria-label={isSynthesis ? 'Delete this synthesis?' : 'Delete this permanently?'}
        >
          {isSynthesis ? (
            <p>
              <strong>Are you sure?</strong> <em>{node.title}</em> leaves the course, with any
              synthesis left with fewer than two parts. A synthesis can’t be unhidden; synthesizing
              its parts again makes a new one.
            </p>
          ) : (
            <p>
              <strong>Are you sure?</strong> <em>{node.title}</em> leaves the graph for good, with
              what only it needs, and no unhide brings it back: its lesson and check-off go too. To
              take it off for now, Hide it instead.
            </p>
          )}
          <div className="lesson-confirm-actions">
            <button type="button" className="lesson-action" onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="lesson-action danger"
              onClick={() => {
                setConfirming(null)
                onDelete(node.id)
              }}
            >
              {isSynthesis ? 'Delete' : 'Delete permanently'}
            </button>
          </div>
        </div>
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

        {/* One row since v8.26.0 (two rows of four equal pills before): what
            just happened on the left, a first "Break it down" and Next lesson
            on the right. The rest lives in the header's ⋮ menu. */}
        <footer className="lesson-foot" data-tour="lesson-foot">
          {phrase && phrase.nodeId === node.id && (
            <p className="lesson-note" aria-live="polite" title={phraseSentence(phrase)}>
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
                  {phrase.state === 'added' ? 'Added ' : 'Already in the course: '}
                  <button
                    type="button"
                    className="link-btn lesson-phrase-open"
                    onClick={() => onOpen(phrase.childId!)}
                    title={`Open ${phrase.text}`}
                  >
                    {phrase.text}
                  </button>
                  {phrase.state === 'added' && ' as something this needs.'}
                </>
              )}
            </p>
          )}
          {expanding ? (
            <span className="lesson-status">
              <span className="spin" /> Breaking it down…
            </span>
          ) : (
            !isSynthesis &&
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
      </div>
    </aside>
  )
}
