/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Peer Reviews card: what the field objected to in a paper. Each theme is
 * a concern later papers raised, with the sentences that raise it quoted word
 * for word and the citing paper one click away (its own thread, or its node
 * in this paper's Citation Graph). Not conference reviews: v1 reads the
 * literature, so the card says where its critiques come from.
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
  type ReactNode,
} from 'react'
import {
  fetchPeerReviews,
  type CitingPaper,
  type PeerReviewsCard,
  type ReviewedPaper,
  type ReviewTheme,
} from '../api'
import { useAppDispatch, useAppSelector } from '../store'
import { threadReturnSet, type ThreadRecord } from '../store/explorations'
import { openPaper, showCiterInGraph } from '../store/workspace'
import ScrollNav, { useAtTop } from '../tools/ScrollNav'
import './reviews.css'

/** Quotes a theme shows before "Show all". */
const QUOTES_SHOWN = 3

/**
 * Cards gathered (or being gathered) this session, by paper id. Module-level so
 * leaving the card mid-gather and coming back joins the same request instead
 * of starting a second one; the server caches the finished card for a month.
 */
const GATHERED = new Map<string, Promise<PeerReviewsCard>>()

/**
 * Gather a paper's card once per session (or again, when asked fresh).
 *
 * @param paper The paper.
 * @param fresh Skip both caches.
 * @returns The card.
 */
function gather(paper: ReviewedPaper, fresh: boolean) {
  const known = GATHERED.get(paper.id)
  if (known && !fresh) return known
  const request = fetchPeerReviews(paper, fresh)
  GATHERED.set(paper.id, request)
  // A failure isn't remembered, so "Try again" asks again.
  request.catch(() => GATHERED.delete(paper.id))
  return request
}

/**
 * Where the reader was in each paper's card this session: how far down, and
 * which themes showed all their quotes. "Show in Citation Graph" offers a
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
export function provenance(card: PeerReviewsCard): string {
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
 * Why a card has no themes, in a sentence.
 *
 * @param card A card with no themes.
 * @returns The empty state's text.
 */
export function emptyReason(card: PeerReviewsCard): string {
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
    <p className="review-citer">
      <span className="review-citer-title">{paper.title}</span>
      {meta && <span className="review-citer-meta"> · {meta}</span>}
      <span className="review-citer-actions">
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
 * One concern, its summary and its quotes.
 *
 * @param props Component props.
 * @param props.theme The concern.
 * @param props.drawn Whether this paper's Citation Graph draws a citing paper
 *        (undefined while no graph is built).
 * @param props.onOpen Open a citing paper as its own thread.
 * @param props.onShow Show a node in the Citation Graph.
 * @param props.all Whether every quote shows, not just the first few.
 * @param props.onToggle Show all its quotes, or the first few again.
 * @returns The theme.
 */
function Theme({
  theme,
  drawn,
  onOpen,
  onShow,
  all,
  onToggle,
}: {
  theme: ReviewTheme
  drawn: (paper: CitingPaper) => boolean | undefined
  onOpen: (paper: CitingPaper) => void
  onShow: (paper: CitingPaper) => void
  all: boolean
  onToggle: () => void
}) {
  const quotes = all ? theme.quotes : theme.quotes.slice(0, QUOTES_SHOWN)
  const hidden = theme.quotes.length - QUOTES_SHOWN
  return (
    <section className="review-theme">
      <h2>{theme.name}</h2>
      <p className="review-theme-count">
        Raised by {theme.papers} {theme.papers === 1 ? 'paper' : 'papers'}
      </p>
      <p className="review-theme-summary">{theme.summary}</p>
      <ul className="review-quotes">
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
        <button type="button" className="review-more" onClick={onToggle}>
          {all ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </section>
  )
}

/**
 * Render a paper thread's Peer Reviews card.
 *
 * @param props Component props.
 * @param props.thread The active paper thread.
 * @param props.children The shell's floating overlays (loading, errors).
 * @returns The card.
 */
export default function PeerReviews({
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
  const paper = useMemo<ReviewedPaper | null>(
    () => (id ? { id, arxiv_id: arxivId, title, authors, year, url } : null),
    [id, arxivId, title, authors, year, url],
  )
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; card: PeerReviewsCard }
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
    <div className="reviews" data-tour="reviews">
      {/* The page scrolls inside a frame that doesn't, so the overlays and
          the button over the page (the ↑, or Back to top) stay put. */}
      <div
        className="reviews-page"
        ref={surface}
        onScroll={(event) => remember({ scrollTop: event.currentTarget.scrollTop })}
      >
        <div className="reviews-inner">
          <header className="reviews-head">
            <p className="reviews-kicker">Peer Reviews</p>
            <h1>What the field objected to</h1>
            <p className="reviews-paper">{paper?.title ?? thread.title}</p>
            <p className="reviews-hint">
              Not conference reviews: the later literature’s objections, each quoted from the paper
              that raised it.
            </p>
          </header>
          {state.status === 'loading' && (
            <p className="reviews-loading">
              <span className="spin" /> Reading what later papers said about it… this takes about
              half a minute. Feel free to explore elsewhere and come back: it keeps going without
              you.
            </p>
          )}
          {state.status === 'error' && (
            <p className="reviews-error">
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
                  <p className="reviews-source" data-tour="reviews-source">
                    {provenance(state.card)}
                  </p>
                  <div className="review-themes" data-tour="reviews-themes">
                    {state.card.themes.map((theme) => (
                      <Theme
                        key={theme.name}
                        theme={theme}
                        drawn={drawn}
                        onOpen={onOpen}
                        onShow={onShow}
                        all={expanded.includes(theme.name)}
                        onToggle={() => toggle(theme.name)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p className="reviews-empty">{emptyReason(state.card)}</p>
              )}
              {state.card.source !== null && (
                <button
                  type="button"
                  className="reviews-again"
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
        paperTitle={thread.title}
        topTitle="Back to the top of the reviews"
        onTop={() => {
          const page = surface.current
          if (!page) return
          if (typeof page.scrollTo === 'function') page.scrollTo({ top: 0, behavior: 'smooth' })
          else page.scrollTop = 0
        }}
      />
    </div>
  )
}
