/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Criticisms card: what the field objected to in a paper. Each criticism
 * is a concern later papers raised, numbered, with the sentences that raise
 * it quoted word for word and the citing paper one click away (its own
 * thread, or its node in this paper's Citation Graph). The contents rail
 * (`contents/`, the Reader's) lists them and follows the reading. Not
 * conference reviews: v1 reads the literature, so the card says where its
 * critiques come from.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  fetchCriticisms,
  type CitingPaper,
  type CriticisedPaper,
  type Criticism,
  type CriticismsCard,
} from '../api'
import ContentsRail, {
  useContentsRail,
  usePinnedEntry,
  type ContentsEntry,
} from '../contents/ContentsRail'
import { useAppDispatch, useAppSelector } from '../store'
import { threadReturnSet, type ThreadRecord } from '../store/explorations'
import { openPaper, showCiterInGraph } from '../store/workspace'
import ScrollNav, { useAtTop } from '../tools/ScrollNav'
import { takeFocus } from './focus'
import './criticisms.css'

/** Quotes a criticism shows before "Show all". */
const QUOTES_SHOWN = 3

/** Whether the contents rail is open, remembered apart from the Reader's. */
const CONTENTS_KEY = 'ca.criticismsContentsOpen'
/** The contents' dragged width, remembered the same way. */
const CONTENTS_WIDTH_KEY = 'ca.criticismsContentsWidth'

/** Room left above a criticism a contents click lands on. */
const HEADING_ROOM = 24

/**
 * A criticism's DOM id, by its number.
 *
 * @param number Its number, from 1.
 * @returns The id of its section.
 */
function criticismDomId(number: number): string {
  return `criticism-${number}`
}

/**
 * Cards gathered (or being gathered) this session, by paper id. Module-level so
 * leaving the card mid-gather and coming back joins the same request instead
 * of starting a second one; the server caches the finished card for a month.
 */
const GATHERED = new Map<string, Promise<CriticismsCard>>()

/**
 * Gather a paper's card once per session (or again, when asked fresh).
 *
 * @param paper The paper.
 * @param fresh Skip both caches.
 * @returns The card.
 */
function gather(paper: CriticisedPaper, fresh: boolean) {
  const known = GATHERED.get(paper.id)
  if (known && !fresh) return known
  const request = fetchCriticisms(paper, fresh)
  GATHERED.set(paper.id, request)
  // A failure isn't remembered, so "Try again" asks again.
  request.catch(() => GATHERED.delete(paper.id))
  return request
}

/**
 * Where the reader was in each paper's card this session: how far down, and
 * which criticisms showed all their quotes. "Show in Citation Graph" offers a
 * way back here, and back should mean the same place, as the Reader's does.
 */
const PLACES = new Map<string, { scrollTop: number; expanded: string[] }>()

/** Forget every gathered card and place (the tests' isolation). */
export function forgetGathered() {
  GATHERED.clear()
  PLACES.clear()
}

/**
 * What a card read, and from where, in a sentence.
 *
 * @param card The card.
 * @returns The provenance line.
 */
export function provenance(card: CriticismsCard): string {
  const papers = `${card.citers} ${card.citers === 1 ? 'paper' : 'papers'}`
  const read = `${card.sentences} ${card.sentences === 1 ? 'sentence' : 'sentences'}`
  if (card.source === 'live')
    return (
      `From the ${read} in which the ${papers} citing it most recently cite it. That's ` +
      'the recent conversation rather than the field’s settled verdict: this paper isn’t ' +
      'in the offline corpus, which ranks every citer.'
    )
  return `From the ${read} in which the ${papers} citing it that are themselves most cited cite it.`
}

/**
 * Why a card has no criticisms, in a sentence.
 *
 * @param card A card with none.
 * @returns The empty state's text.
 */
export function emptyReason(card: CriticismsCard): string {
  if (card.source === null)
    return 'Semantic Scholar doesn’t know this paper, so there are no citing sentences to read.'
  if (card.citers === 0)
    return (
      'No paper cited widely enough to be read here cites this one yet. New papers ' +
      'gather a literature slowly; check back once the field has had time to answer.'
    )
  return (
    `None of the ${card.sentences} sentences from ${card.citers} citing papers criticises ` +
    'this paper. They use it, extend it or describe it.'
  )
}

/**
 * One citing paper's line under its quote, with the ways to it.
 *
 * @param props Component props.
 * @param props.paper The citing paper.
 * @param props.drawn Whether this paper's Citation Graph draws it: false when
 *        the graph is built without it, undefined when no graph is built.
 * @param props.onOpen Open it as its own thread.
 * @param props.onShow Show it in this paper's Citation Graph.
 * @returns The line.
 */
function CitingLine({
  paper,
  drawn,
  onOpen,
  onShow,
}: {
  paper: CitingPaper
  drawn: boolean | undefined
  onOpen: (paper: CitingPaper) => void
  onShow: (paper: CitingPaper) => void
}) {
  const meta = [
    paper.year,
    paper.citation_count != null && `${paper.citation_count.toLocaleString()} citations`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <p className="criticism-citer">
      <span className="criticism-citer-title">{paper.title}</span>
      {meta && <span className="criticism-citer-meta"> · {meta}</span>}
      <span className="criticism-citer-actions">
        <button
          type="button"
          onClick={() => onOpen(paper)}
          title="Open this paper as its own thread, on its card home"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => onShow(paper)}
          title={
            drawn === false
              ? 'Add this paper to this paper’s Citation Graph, among the papers citing it, and show it there'
              : 'Show this paper in this paper’s Citation Graph'
          }
        >
          Show in Citation Graph
        </button>
      </span>
    </p>
  )
}

/**
 * One criticism, numbered, with its summary and its quotes.
 *
 * @param props Component props.
 * @param props.criticism The concern.
 * @param props.number Its number, from 1.
 * @param props.drawn Whether this paper's Citation Graph draws a citing paper
 *        (undefined while no graph is built).
 * @param props.onOpen Open a citing paper as its own thread.
 * @param props.onShow Show a node in the Citation Graph.
 * @param props.all Whether every quote shows, not just the first few.
 * @param props.onToggle Show all its quotes, or the first few again.
 * @returns The criticism.
 */
function CriticismSection({
  criticism,
  number,
  drawn,
  onOpen,
  onShow,
  all,
  onToggle,
}: {
  criticism: Criticism
  number: number
  drawn: (paper: CitingPaper) => boolean | undefined
  onOpen: (paper: CitingPaper) => void
  onShow: (paper: CitingPaper) => void
  all: boolean
  onToggle: () => void
}) {
  const quotes = all ? criticism.quotes : criticism.quotes.slice(0, QUOTES_SHOWN)
  const hidden = criticism.quotes.length - QUOTES_SHOWN
  return (
    <section className="criticism" id={criticismDomId(number)}>
      <h2>
        <span className="criticism-number">{number}</span>
        {criticism.name}
      </h2>
      <p className="criticism-count">
        Raised by {criticism.papers} {criticism.papers === 1 ? 'paper' : 'papers'}
      </p>
      <p className="criticism-summary">{criticism.summary}</p>
      <ul className="criticism-quotes">
        {quotes.map((quote, index) => (
          <li key={`${quote.paper.id}:${index}`}>
            <blockquote>“{quote.text}”</blockquote>
            <CitingLine
              paper={quote.paper}
              drawn={drawn(quote.paper)}
              onOpen={onOpen}
              onShow={onShow}
            />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="criticism-more" onClick={onToggle}>
          {all ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  )
}

/**
 * Render a paper thread's Criticisms card.
 *
 * @param props Component props.
 * @param props.thread The active paper thread.
 * @param props.children The shell's floating overlays (loading, errors).
 * @returns The card.
 */
export default function Criticisms({
  thread,
  children,
}: {
  thread: ThreadRecord
  children?: ReactNode
}) {
  const dispatch = useAppDispatch()
  const graph = useAppSelector((state) => state.workspace.graph)
  const discovered = useAppSelector((state) => state.workspace.discoveredNodes)
  const seed = thread.data.graph_ref?.seed
  const details = thread.paper
  const provider = thread.data.provider
  // The thread's hydrated paper, else its graph's seed: what the server reads.
  const id = details?.id ?? seed?.id
  const arxivId = details?.arxiv_id ?? seed?.arxiv_id ?? null
  const title = details?.title ?? seed?.title ?? null
  const authors = details?.authors ?? null
  const year = details?.year ?? null
  const url = details?.url ?? null
  const paper = useMemo<CriticisedPaper | null>(
    () => (id ? { id, arxiv_id: arxivId, title, authors, year, url } : null),
    [id, arxivId, title, authors, year, url],
  )
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; card: CriticismsCard }
    | { status: 'error'; message: string }
  >({ status: 'loading' })
  const surface = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<string[]>(() => (id && PLACES.get(id)?.expanded) || [])
  const remember = useCallback(
    (place: Partial<{ scrollTop: number; expanded: string[] }>) => {
      if (!id) return
      const known = PLACES.get(id) ?? { scrollTop: 0, expanded: [] }
      PLACES.set(id, { ...known, ...place })
    },
    [id],
  )
  const toggle = useCallback(
    (name: string) =>
      setExpanded((names) => {
        const next = names.includes(name)
          ? names.filter((known) => known !== name)
          : [...names, name]
        remember({ expanded: next })
        return next
      }),
    [remember],
  )
  // Back where the reader left off, once the card is on the page.
  const ready = state.status === 'ready'
  const atTop = useAtTop(surface)
  useLayoutEffect(() => {
    const top = id ? PLACES.get(id)?.scrollTop : undefined
    if (ready && top && surface.current) surface.current.scrollTop = top
  }, [ready, id])

  // The contents rail: every criticism by its number, the one being read lit.
  const rail = useContentsRail(CONTENTS_KEY, CONTENTS_WIDTH_KEY)
  const criticisms = state.status === 'ready' ? state.card.themes : null
  const entries = useMemo(
    () =>
      (criticisms ?? []).map(
        (criticism, index): ContentsEntry => ({
          id: criticismDomId(index + 1),
          level: 1,
          number: String(index + 1),
          title: criticism.name,
          label: criticism.name,
        }),
      ),
    [criticisms],
  )
  const [pinnedId, setPinnedId] = usePinnedEntry(surface)
  const [activeId, setActiveId] = useState<string | null>(null)
  // The active entry is the last criticism whose top has scrolled past the
  // top third of the page, as in the Reader.
  useEffect(() => {
    const page = surface.current
    if (!page || entries.length === 0) return
    const update = () => {
      const line = page.getBoundingClientRect().top + page.clientHeight / 3
      let current: string | null = entries[0].id
      for (const entry of entries) {
        const section = document.getElementById(entry.id)
        if (section && section.getBoundingClientRect().top <= line) current = entry.id
        else if (section) break
      }
      setActiveId(current)
    }
    update()
    page.addEventListener('scroll', update, { passive: true })
    return () => page.removeEventListener('scroll', update)
  }, [entries])
  const jump = useCallback(
    (target: string) => {
      setPinnedId(target)
      const page = surface.current
      const section = document.getElementById(target)
      if (!page || !section) return
      const offset = section.getBoundingClientRect().top - page.getBoundingClientRect().top
      const top = page.scrollTop + offset - HEADING_ROOM
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (typeof page.scrollTo === 'function')
        page.scrollTo({ top, behavior: still ? 'auto' : 'smooth' })
      else page.scrollTop = top
    },
    [setPinnedId],
  )
  // Opened from a Reader note's card ("Read in Criticisms"): at that
  // criticism, once the criticisms are on the page.
  useEffect(() => {
    if (!ready || !id) return
    const number = takeFocus(id)
    if (number) jump(criticismDomId(number))
  }, [ready, id, jump])

  const load = useCallback(
    (fresh: boolean) => {
      if (!paper) return () => {}
      let cancelled = false
      setState({ status: 'loading' })
      gather(paper, fresh)
        .then((card) => !cancelled && setState({ status: 'ready', card }))
        .catch(
          (error: Error) => !cancelled && setState({ status: 'error', message: error.message }),
        )
      return () => {
        cancelled = true
      }
    },
    [paper],
  )
  useEffect(() => load(false), [load])

  const drawn = useCallback(
    (citer: CitingPaper) =>
      graph
        ? [...graph.nodes, ...discovered].some(
            (node) =>
              node.id === citer.id || (!!citer.arxiv_id && node.arxiv_id === citer.arxiv_id),
          )
        : undefined,
    [graph, discovered],
  )
  const onOpen = useCallback(
    (citer: CitingPaper) => {
      // A citer is a Semantic Scholar paper: an arXiv id opens under any
      // provider, a corpus id only under S2's.
      void dispatch(
        citer.arxiv_id
          ? openPaper({ seed: citer.arxiv_id, provider })
          : openPaper({ seed: citer.id, provider: 's2' }),
      )
    },
    [dispatch, provider],
  )
  const onShow = useCallback(
    (citer: CitingPaper) => {
      // The Citation Graph then offers the way back here, in the ↑'s place.
      dispatch(threadReturnSet({ id: thread.id, returnTo: { tool: 'reviews', from: 'graph' } }))
      void dispatch(
        showCiterInGraph({
          ...citer,
          title: citer.title || '(untitled)',
          abstract: null,
          rels: ['citation'],
          is_seed: false,
        }),
      )
    },
    [dispatch, thread.id],
  )

  return (
    <div
      className="criticisms"
      data-tour="criticisms"
      style={{ '--contents-width': `${rail.panel.width}px` } as CSSProperties}
    >
      {entries.length > 0 && (
        <ContentsRail
          rail={rail}
          entries={entries}
          activeId={pinnedId ?? activeId}
          onPick={jump}
          id="criticisms-contents"
          tour="criticisms-contents"
        />
      )}
      {/* The overlays and the button over the page go over the page, not
          the whole card, so the ↑ centres over the criticisms, not the
          contents. */}
      <div
        className={`criticisms-main${rail.glide ? ` glide-${rail.glide}` : ''}`}
        onAnimationEnd={(event) => rail.onGlideEnd(event.animationName)}
      >
        {/* The page scrolls inside a frame that doesn't, so the overlays and
            the button over the page (the ↑, or Back to top) stay put. */}
        <div
          className="criticisms-page"
          ref={surface}
          onScroll={(event) => remember({ scrollTop: event.currentTarget.scrollTop })}
        >
          <div className="criticisms-inner">
            <header className="criticisms-head">
              <p className="criticisms-kicker">Criticisms</p>
              <h1>What the field objected to</h1>
              <p className="criticisms-paper">{paper?.title ?? thread.title}</p>
              <p className="criticisms-hint">
                Not conference reviews: the later literature’s objections, each quoted from the
                paper that raised it.
              </p>
            </header>
            {state.status === 'loading' && (
              <p className="criticisms-loading">
                <span className="spin" /> Reading what later papers said about it… this takes about
                half a minute. Feel free to explore elsewhere and come back: it keeps going without
                you.
              </p>
            )}
            {state.status === 'error' && (
              <p className="criticisms-error">
                {state.message}{' '}
                <button type="button" onClick={() => load(true)}>
                  Try again
                </button>
              </p>
            )}
            {state.status === 'ready' && (
              <>
                {state.card.themes.length > 0 ? (
                  <>
                    <p className="criticisms-source" data-tour="criticisms-source">
                      {provenance(state.card)}
                    </p>
                    <div className="criticisms-list" data-tour="criticisms-list">
                      {state.card.themes.map((criticism, index) => (
                        <CriticismSection
                          key={criticism.name}
                          criticism={criticism}
                          number={index + 1}
                          drawn={drawn}
                          onOpen={onOpen}
                          onShow={onShow}
                          all={expanded.includes(criticism.name)}
                          onToggle={() => toggle(criticism.name)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="criticisms-empty">{emptyReason(state.card)}</p>
                )}
                {state.card.source !== null && (
                  <button
                    type="button"
                    className="criticisms-again"
                    onClick={() => load(true)}
                    title="Read the citing sentences again and regroup them, replacing this card"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="M2.75 8a5.25 5.25 0 1 0 1.6-3.77M2.5 2.25v2.5H5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Gather again
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {children}
        <ScrollNav
          atTop={atTop}
          thread={thread}
          tool="reviews"
          paperTitle={thread.title}
          topTitle="Back to the top of the criticisms"
          onTop={() => {
            setPinnedId(null)
            const page = surface.current
            if (!page) return
            if (typeof page.scrollTo === 'function') page.scrollTo({ top: 0, behavior: 'smooth' })
            else page.scrollTop = 0
          }}
        />
      </div>
    </div>
  )
}
