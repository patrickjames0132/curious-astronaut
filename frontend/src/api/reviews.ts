/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Criticisms card's call: what the field objected to in a paper, each
 * concern quoted from the later paper that raised it. The route keeps its
 * first name, `/api/reviews`, as the server's cache does. One JSON request,
 * cached server-side for a month, so reopening the card costs nothing.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** The paper a card is about, as the thread holds it. */
export interface CriticisedPaper {
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
export interface CriticismQuote {
  text: string
  paper: CitingPaper
}

/** One concern the field raised. */
export interface Criticism {
  name: string
  summary: string
  /** How many distinct papers raise it. */
  papers: number
  /** Its sentences, the most-cited paper's first. */
  quotes: CriticismQuote[]
}

/**
 * The card. `source` says where the sentences came from: the offline
 * corpus's most-cited citers (`corpus`), S2's newest ~1,000 (`live`), or
 * nowhere, because Semantic Scholar couldn't find the paper (null).
 */
export interface CriticismsCard {
  source: 'corpus' | 'live' | null
  /** Citing papers whose sentences were read. */
  citers: number
  /** Sentences judged. */
  sentences: number
  /** Sentences judged critiques of this paper. */
  critiques: number
  themes: Criticism[]
}

/**
 * Gather a paper's Criticisms card.
 *
 * @param paper The thread's paper.
 * @param fresh Skip the server's cached card and replace it.
 * @param signal Abort the request.
 * @returns The card.
 * @throws With the server's message when Semantic Scholar or the model fails.
 */
export async function fetchCriticisms(
  paper: CriticisedPaper,
  fresh = false,
  signal?: AbortSignal,
): Promise<CriticismsCard> {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paper, fresh }),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Could not gather the criticisms (${res.status})`)
  return data as CriticismsCard
}
