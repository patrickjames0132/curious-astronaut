/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Peer Reviews card's call: what the field objected to in a paper, each
 * concern quoted from the later paper that raised it. One JSON request,
 * cached server-side for a month, so reopening the card costs nothing.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** The paper a card is about, as the thread holds it. */
export interface ReviewedPaper {
  id: string
  arxiv_id?: string | null
  title?: string | null
  authors?: string | null
  year?: number | null
  url?: string | null
}

/** A later paper that raised a concern. */
export interface CitingPaper {
  id: string
  arxiv_id: string | null
  title: string
  year: number | null
  authors: string | null
  citation_count: number | null
  url: string | null
}

/** One sentence from a citing paper, word for word. */
export interface ReviewQuote {
  text: string
  paper: CitingPaper
}

/** One concern the field raised. */
export interface ReviewTheme {
  name: string
  summary: string
  /** How many distinct papers raise it. */
  papers: number
  /** Its sentences, the most-cited paper's first. */
  quotes: ReviewQuote[]
}

/**
 * The card. `source` says where the sentences came from: the offline
 * corpus's most-cited citers (`corpus`), S2's newest ~1,000 (`live`), or
 * nowhere, because Semantic Scholar couldn't find the paper (null).
 */
export interface PeerReviewsCard {
  source: 'corpus' | 'live' | null
  /** Citing papers whose sentences were read. */
  citers: number
  /** Sentences judged. */
  sentences: number
  /** Sentences judged critiques of this paper. */
  critiques: number
  themes: ReviewTheme[]
}

/**
 * Gather a paper's Peer Reviews card.
 *
 * @param paper The thread's paper.
 * @param fresh Skip the server's cached card and replace it.
 * @param signal Abort the request.
 * @returns The card.
 * @throws With the server's message when Semantic Scholar or the model fails.
 */
export async function fetchPeerReviews(
  paper: ReviewedPaper,
  fresh = false,
  signal?: AbortSignal,
): Promise<PeerReviewsCard> {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper, fresh }),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not gather the reviews (${res.status})`)
  return data as PeerReviewsCard
}
