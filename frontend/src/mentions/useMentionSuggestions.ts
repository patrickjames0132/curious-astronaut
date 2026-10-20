/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The `@`-mention typeahead's engine: watch what is being typed, look up
 * candidates, and hold the keyboard selection.
 *
 * Everything here is about not making the reader wait or pay, and those pull
 * in opposite directions — so the two sources behind a lookup are fired on
 * different clocks.
 *
 * **The free half runs on every keystroke.** A cache-only lookup is a local
 * scan: no provider, no network beyond localhost, milliseconds. Debouncing it
 * would only add latency to something already instant, so suggestions paint
 * while the reader is still typing.
 *
 * **The paid half waits for a pause** (`DEBOUNCE_MS`), fires only past the
 * backend's minimum length, and aborts the request before it — so typing a
 * title straight through costs one provider lookup, not one per character. The
 * backend's day-cache absorbs the repeats.
 *
 * When the full list lands it **replaces** the provisional one, relevance-ranked
 * across both sources. One thing it must not do is move the row under the
 * reader's cursor: see `highlightedKey`.
 *
 * **Sibling threads are rows too**, listed above the papers. They are the
 * other discussions in the current exploration — a local list of a few
 * titles, filtered here with no request at all — so they show from the first
 * character, before the paper lookups are even allowed to fire. Typing `@`
 * alone lists every one of them, which is how a reader finds out that a
 * discussion can be mentioned at all.
 *
 * **What Enter does depends only on keys the reader pressed** (v8.29.0,
 * Patrick). It used to depend on timing too: Enter on a bare `@dqn` searched
 * if the reader beat the lookup and took whatever row had landed (or sat under
 * a resting mouse) if they didn't, so the same keystrokes did different things
 * on different tries. Now:
 *
 * - **The search is a row of its own** (`search`), pinned first and selected
 *   by default whenever the mention is the whole message on a bar that looks
 *   papers up. It exists from the first character, before anything loads, so
 *   results arriving only fill in rows below it — they can never change what
 *   Enter does.
 * - **A paper or chat row is chosen only by arrowing onto it.** Hovering
 *   shades a row (CSS) but selects nothing; a click picks it outright.
 * - Elsewhere — a mention inside a sentence, or a bar with no paper lookups —
 *   nothing is selected until the reader arrows, and Enter sends as typed.
 *
 * The full pass streams its phases, and `step` holds the latest — the dropdown
 * shows one live line naming what it is waiting on ("Searching Semantic
 * Scholar", "Working out which paper “dqn” is") rather than "Searching…" for
 * all three. Each label supersedes the last: a phase history would be noise
 * for a lookup this short.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCachedMentions, streamMentions } from '../api'
import type { MentionPaper, Provider } from '../api'
import { MENTION_MIN_CHARS, activeMention, graphPaperMatches, threadMatches } from './parse'
import type { ActiveMention, MentionChoice, MentionThread } from './parse'

/** How long the reader must pause before a lookup fires. Long enough that
 *  typing a title straight through costs one request; short enough that the
 *  list feels like it is keeping up. */
const DEBOUNCE_MS = 250

/** The search row's tracking key: a kind no paper or chat row can share. */
const SEARCH_KEY = 'search'

/**
 * The key a row is tracked by across re-ranks: its kind and its id, so a
 * thread and a paper that happen to share an id can never be confused.
 *
 * @param choice The row.
 * @returns Its tracking key.
 */
function rowKey(choice: MentionChoice): string {
  return choice.kind === 'paper' ? `paper:${choice.paper.id}` : `thread:${choice.thread.id}`
}

/**
 * Drive the mention dropdown for one composer.
 *
 * @param provider The active graph provider, so a picked paper's id is in the
 *                 graph's own id space.
 * @param threads  The other threads in the current exploration, offered as
 *                 rows above the papers.
 * @param withPapers Look papers up too. The Knowledge Graph's assistant
 *                 (v8.25.0) offers its chats alone: a paper picked there would
 *                 only be its title in the question.
 * @param localPapers Papers to match locally instead of looking any up: the
 *                 open graph's, for the docked Citation Graph assistant
 *                 (v8.29.0), whose `@` points at papers on screen rather
 *                 than searching. Only read when `withPapers` is false.
 * @returns The dropdown's state plus the handlers the composer wires up.
 */
export function useMentionSuggestions(
  provider: Provider,
  threads: MentionThread[] = [],
  withPapers = true,
  localPapers?: MentionPaper[],
) {
  const [active, setActive] = useState<ActiveMention | null>(null)
  const [papers, setPapers] = useState<MentionPaper[]>([])
  const [loading, setLoading] = useState(false)
  // The phase the full pass is in, in the server's own reader-facing words.
  // Null when nothing is running or the result has landed.
  const [step, setStep] = useState<string | null>(null)
  // The row the keyboard is on, tracked by **key rather than index** — the
  // list is re-ranked under it when the full results land, and an index would
  // then point at a different paper than the one the reader was looking at.
  // Enter would take the wrong row, which is the one failure a picker must not
  // have. Null means **the default**: the search row when there is one,
  // otherwise nothing — never a paper or chat picked on the reader's behalf.
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null)
  const localCtrl = useRef<AbortController | null>(null)
  const fullCtrl = useRef<AbortController | null>(null)
  // The reader pressed Escape on this exact query: stay shut until they type
  // something else, rather than reopening on the next keystroke.
  const dismissed = useRef<string | null>(null)

  /** Re-read the composer and open, update, or close the dropdown.
   *  `completed` is the draft's already-picked mention texts, which end a
   *  mention rather than extending it (see `activeMention`). */
  const onInput = useCallback((text: string, caret: number, completed?: Iterable<string>) => {
    const found = activeMention(text, caret, completed)
    if (!found) {
      setActive(null)
      setPapers([])
      return
    }
    if (dismissed.current === found.query) return
    dismissed.current = null
    setActive(found)
  }, [])

  /** Close the dropdown and remember not to reopen on this query. */
  const dismiss = useCallback(() => {
    dismissed.current = active?.query ?? null
    setActive(null)
    setPapers([])
  }, [active])

  /** Close it outright — after a pick, or a send. */
  const reset = useCallback(() => {
    dismissed.current = null
    setActive(null)
    setPapers([])
    setLoading(false)
    setStep(null)
    setHighlightedKey(null)
    settled.current = null
    localCtrl.current?.abort()
    fullCtrl.current?.abort()
    localCtrl.current = null
    fullCtrl.current = null
  }, [])

  const query = active?.query ?? ''
  // The threads show for any live mention; the paper lookups below wait for
  // the backend's minimum length, and a shorter query holds no papers at all.
  const matchedThreads = active ? threadMatches(threads, query) : []
  // The graph's own papers, matched as the reader types: instant, so no
  // debounce, no spinner, and nothing to abort.
  const shownPapers =
    !withPapers && localPapers ? (active ? graphPaperMatches(localPapers, query) : []) : papers
  const lookup = withPapers && query.length >= MENTION_MIN_CHARS ? query : ''

  // The query whose FULL results we already hold. Each new query aborts both
  // requests before it, so a stale response can't arrive — but within one
  // query the two can finish out of order (a slow cache scan against a
  // day-cached provider hit), and the provisional list must never overwrite
  // the ranked one. This is that fact, stated rather than inferred from
  // whether a spinner is up.
  const settled = useRef<string | null>(null)

  // The free pass: no debounce, because a cache scan is already instant and
  // delaying it would only make the dropdown feel slower than it is.
  useEffect(() => {
    if (!lookup) {
      // Too short to look up: whatever papers a longer query left behind are
      // stale, and the phase label with them — and a lookup still in flight
      // for that longer query must not land on this one.
      localCtrl.current?.abort()
      fullCtrl.current?.abort()
      setPapers((previous) => (previous.length ? [] : previous))
      setStep(null)
      return
    }
    // A new query: the previous one's phase label must not sit over it. Done
    // here rather than in `onInput`, which is a stable callback and would
    // read a stale `active` to compare against.
    setStep(null)
    localCtrl.current?.abort()
    const ctrl = new AbortController()
    localCtrl.current = ctrl
    void fetchCachedMentions(lookup, provider, ctrl.signal).then((result) => {
      if (ctrl.signal.aborted || settled.current === lookup) return
      setPapers(result.papers)
    })
  }, [lookup, provider])

  // The paid pass: only once the reader pauses.
  useEffect(() => {
    if (!lookup) {
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      fullCtrl.current?.abort()
      const ctrl = new AbortController()
      fullCtrl.current = ctrl
      void streamMentions(lookup, provider, {
        signal: ctrl.signal,
        onStep: (label) => {
          if (!ctrl.signal.aborted) setStep(label)
        },
        onResult: (found) => {
          if (ctrl.signal.aborted) return
          settled.current = lookup
          setPapers(found)
          setStep(null)
          setLoading(false)
        },
      })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [lookup, provider])

  // Every row the keyboard can reach, threads first: they are the reader's
  // own, few, and already on screen in the rail, so they belong above a list
  // of strangers' papers that is still being fetched.
  const rows: MentionChoice[] = [
    ...matchedThreads.map((thread): MentionChoice => ({ kind: 'thread', thread })),
    ...shownPapers.map((paper): MentionChoice => ({ kind: 'paper', paper })),
  ]

  // The search row's query, or null when there is no search row: only a bar
  // that looks papers up, and only when the mention is the whole message —
  // inside a sentence, `@words` is part of a question, not a search.
  const search = withPapers && active?.whole && query.trim() ? query.trim() : null
  // The keys the keyboard walks, the search row (when there is one) first.
  const keys = [...(search ? [SEARCH_KEY] : []), ...rows.map(rowKey)]

  // Where the keyboard selection actually is: the tracked row's current
  // index. With nothing tracked — or a tracked row a re-rank dropped — it is
  // the default: the search row when there is one, otherwise -1, nothing.
  // Never a paper or chat the reader didn't arrow onto: that is exactly what
  // Enter must not act on.
  const tracked = highlightedKey === null ? -1 : keys.indexOf(highlightedKey)
  const highlighted = tracked !== -1 ? tracked : search ? 0 : -1
  // The offset from a keyboard index to its row in `rows`.
  const offset = search ? 1 : 0

  /** Move the keyboard selection, wrapping at both ends. From nothing
   *  selected, down goes to the first row and up to the last. */
  const move = useCallback(
    (delta: number) => {
      if (keys.length === 0) return
      const next =
        highlighted === -1
          ? delta > 0
            ? 0
            : keys.length - 1
          : (highlighted + delta + keys.length) % keys.length
      setHighlightedKey(keys[next])
    },
    [keys, highlighted],
  )

  return {
    /** The mention being typed, or null when the dropdown is shut. */
    active,
    /** Whether the dropdown should render: a live mention with something in it. */
    open: active !== null && (rows.length > 0 || loading || search !== null),
    /** The sibling threads matching the query, shown above the papers. */
    threads: matchedThreads,
    papers: shownPapers,
    loading,
    /** What the full pass is doing right now, or null. */
    step,
    /** What the search row would search for, or null when there is none. */
    search,
    /** The index of the selected row across the search row, threads then
     *  papers, or -1. */
    highlighted,
    /** The paper or chat Enter would attach, or null when it wouldn't attach
     *  one (the search row is selected, or nothing is). */
    choice: highlighted >= offset ? (rows[highlighted - offset] ?? null) : null,
    /** Whether Enter would run the search row's search. */
    searchChosen: search !== null && highlighted === 0,
    onInput,
    move,
    dismiss,
    reset,
  }
}
