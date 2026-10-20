/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The `@`-mention dropdown: the sibling threads and paper candidates for what
 * is being typed, shown above the composer.
 *
 * Above rather than below because the composer sits at the bottom of the panel
 * and a list below it would open off-screen. Two sections, threads first: the
 * reader's other discussions in this exploration, then the paper results. A
 * paper row is the **title** over `authors • venue • year` — the venue earns
 * its place here specifically, since two papers with near-identical titles
 * have to be told apart before one is picked, and where it was published is
 * what does that.
 *
 * **The search row** (v8.29.0) comes first on the General chat whenever the
 * mention is the whole message: `🔍 Search for “dqn”`, selected by default,
 * there from the first character. Enter runs it however far the lookup has
 * got; a paper or chat is attached only by arrowing onto it (or clicking it).
 * Hovering shades a row and selects nothing, so a list that opens under a
 * resting mouse can't take the reader's Enter. The footer still says what
 * Enter does right now, which is now a fact about the keys pressed alone.
 *
 * **Opening is its own control** (v8.29.0, Patrick): where the composer
 * passes `onOpen` (the General chat), each paper row ends in an `Open`
 * button that opens the paper's thread in one click — Shift+Enter on the
 * keyboard. A pick attaches; opening never hides inside the chip.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef } from 'react'
import type { AnimationEvent } from 'react'
import type { MentionPaper } from '../api'
import type { MentionChoice, MentionThread } from './parse'
import './mentions.css'

/** Props for {@link MentionSuggestions}. */
export interface MentionSuggestionsProps {
  /** The sibling threads matching the query, listed first. */
  threads: MentionThread[]
  /** The paper candidates to show, in the order the backend ranked them. */
  papers: MentionPaper[]
  /** What the search row searches for, or null for no search row. */
  search?: string | null
  /** Index of the row the keyboard is on, counted across the search row,
   *  threads then papers — Enter accepts it. -1 when no row is selected. */
  highlighted: number
  /** A lookup is in flight; the list may be stale or empty. */
  loading: boolean
  /** What the lookup is doing right now, in the server's own words, or null.
   *  One line that replaces itself, not a phase history. */
  step?: string | null
  /** Accept a row (click). */
  onPick: (choice: MentionChoice) => void
  /** Run the search row's search (click). */
  onSearch?: (query: string) => void
  /** Open a paper's thread (its Open button). Absent, paper rows have no
   *  button: the docked bars point at papers rather than opening them. */
  onOpen?: (paper: MentionPaper) => void
  /** The panel is playing its exit (ui/usePresence) — rows stop taking clicks. */
  closing?: boolean
  /** Wire-through for the presence hook's exit bookkeeping. */
  onAnimationEnd?: (event: AnimationEvent) => void
}

/**
 * One row's byline: `authors • venue • year`, skipping whatever is missing so
 * a sparse record doesn't render orphaned separators.
 *
 * @param paper The candidate paper.
 * @returns The byline text, possibly empty.
 */
function byline(paper: MentionPaper): string {
  return [paper.authors, paper.venue, paper.year].filter(Boolean).join(' • ')
}

/**
 * The footer line: what Enter does in the current state.
 *
 * @param choice The paper or chat the keyboard is on, or null.
 * @param search The search row's query when the search row is selected, or null.
 * @param canOpen Whether a paper can be opened from here (Shift+Enter).
 * @returns The hint text.
 */
export function hintFor(
  choice: MentionChoice | null,
  search: string | null,
  canOpen = false,
): string {
  if (search) return 'Enter searches · ↓ to attach a paper or chat instead'
  if (!choice) return 'Enter sends your message · ↑↓ to choose a row'
  if (choice.kind === 'thread') return 'Enter attaches this discussion'
  return canOpen
    ? 'Enter attaches this paper · Shift+Enter opens it'
    : 'Enter attaches this paper to your question'
}

/**
 * Render the mention dropdown.
 *
 * @param props See {@link MentionSuggestionsProps}.
 * @returns The suggestion panel.
 */
export default function MentionSuggestions({
  threads,
  papers,
  search = null,
  highlighted,
  loading,
  step,
  onPick,
  onSearch,
  onOpen,
  closing = false,
  onAnimationEnd,
}: MentionSuggestionsProps) {
  // The paper section exists once a lookup could have run: results are up,
  // or one is in flight. Below the query floor there is neither, and the
  // threads stand alone.
  const showPapers = papers.length > 0 || loading
  const rows: MentionChoice[] = [
    ...threads.map((thread): MentionChoice => ({ kind: 'thread', thread })),
    ...papers.map((paper): MentionChoice => ({ kind: 'paper', paper })),
  ]
  // Keyboard indexes count the search row first, when there is one.
  const offset = search ? 1 : 0
  // Keep the keyboard's row in view: arrowing past the bottom of the capped
  // list used to move the selection out of sight while the list sat still.
  // `nearest` scrolls only as far as it takes, and not at all for a row
  // already showing. Optional-called: jsdom has no scrollIntoView.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('.mention-row.on')?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted])
  return (
    <div className={`mention-panel${closing ? ' closing' : ''}`} onAnimationEnd={onAnimationEnd}>
      {/* Only the rows scroll. The footer sits outside the scrolling box so
          it stays in view however long the list gets — with eight rows up
          it used to be below the fold, which is exactly when it is needed. */}
      <div ref={listRef} className="mention-list" role="listbox" aria-label="Mention suggestions">
        {search && (
          <button
            type="button"
            role="option"
            aria-selected={highlighted === 0}
            className={`mention-row mention-search${highlighted === 0 ? ' on' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault()
              onSearch?.(search)
            }}
          >
            <span className="mention-icon" aria-hidden="true">
              🔍
            </span>
            <span className="mention-text">
              <span className="mention-title">Search for “{search}”</span>
            </span>
          </button>
        )}
        {threads.length > 0 && (
          <>
            <div className="mention-head">Discussions in this exploration</div>
            {threads.map((thread, position) => {
              const index = offset + position
              return (
                <button
                  key={`thread:${thread.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  className={`mention-row${index === highlighted ? ' on' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onPick({ kind: 'thread', thread })
                  }}
                >
                  <span className="mention-icon" aria-hidden="true">
                    💬
                  </span>
                  <span className="mention-text">
                    <span className="mention-title">{thread.title}</span>
                  </span>
                </button>
              )
            })}
          </>
        )}
        {showPapers && (
          <div className="mention-head">
            All paper results
            {loading && <span className="spin mention-spin" role="status" aria-label="Searching" />}
          </div>
        )}
        {/* The live phase line: what the lookup is waiting on, named by the
          server. It shows whether or not results are up yet, because the
          provisional cached list lands first and the reader should still be
          able to tell that more is coming — and which of the three phases
          (cache, provider, nickname resolve) is taking the time. `aria-live`
          so the change is announced without stealing focus from the textarea
          they are still typing in. */}
        {(step || (papers.length === 0 && loading)) && (
          <div className="mention-step" aria-live="polite">
            {step ?? 'Searching…'}
          </div>
        )}
        {papers.map((paper, index) => {
          // Rows are numbered across both sections, threads first, so the
          // keyboard walks one list.
          const row = offset + threads.length + index
          // The row and its Open are siblings in a wrapper, not nested:
          // a button inside a button is invalid, and the two do different
          // things.
          return (
            <div key={`paper:${paper.id}`} className="mention-paper">
              <button
                type="button"
                role="option"
                aria-selected={row === highlighted}
                className={`mention-row${row === highlighted ? ' on' : ''}`}
                // Pointer-down, not click: the composer's blur would otherwise
                // close the panel before a click could land on it.
                onMouseDown={(event) => {
                  event.preventDefault()
                  onPick({ kind: 'paper', paper })
                }}
              >
                <span className="mention-icon" aria-hidden="true">
                  📄
                </span>
                <span className="mention-text">
                  <span className="mention-title">{paper.title}</span>
                  {byline(paper) && <span className="mention-meta">{byline(paper)}</span>}
                </span>
              </button>
              {onOpen && (
                <button
                  type="button"
                  className="mention-open"
                  title="Open this paper in a thread of its own (Shift+Enter)"
                  aria-label={`Open ${paper.title}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onOpen(paper)
                  }}
                >
                  Open
                </button>
              )}
            </div>
          )
        })}
      </div>
      {/* What Enter does right now — the one thing the reader most needs to
          know, since the list looks like it might grab their Enter. */}
      <div className="mention-hint">
        {hintFor(
          highlighted >= offset ? (rows[highlighted - offset] ?? null) : null,
          search && highlighted === 0 ? search : null,
          onOpen !== undefined,
        )}
      </div>
    </div>
  )
}
