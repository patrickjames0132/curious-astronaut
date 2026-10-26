# `services.reviews`

The Peer Reviews card: what the field objected to in a paper, each concern
quoted from the later paper that raised it. `peer_reviews(paper)` is what
`POST /api/reviews` calls.

## Which citers, from where

The sentences are Semantic Scholar's **citation contexts**: the sentence in
which a citing paper cites this one. The prototype's finding that shaped
everything: **which citers matters more than how many.** S2's live endpoint
returns citers newest-first and can't sort, and for Attention 99% of the
citers it would page through were from 2026, mostly uncited, and the card
they made was this month's passing mentions. The **top 200 citers by their
own citation count** produced the field's real answers (the quadratic cost
quoted from *Linformer* and *FlashAttention-2*; DDPM's slow sampling from
*Latent Diffusion*).

So there are two sources, tried in order:

| source | what it reads | when |
|---|---|---|
| `corpus` | the `CITERS` most-cited citers with a sentence, ranked across all history (the corpus's contexts table) | the corpus is on, has a complete contexts table, and resolves the paper |
| `live` | one page of S2's newest ~1,000 citers, ranked locally | otherwise |

The payload's `source` says which answered, and the card words its
provenance line to match: a `live` card is the recent conversation, not the
field's verdict. `source: null` means S2 couldn't find the paper at all.

The paper is named to S2 by `s2_ref`: its arXiv id, else a `CorpusId:` or
raw S2 paperId, else a DOI read off its URL. An OpenAlex paper with none of
those can't be looked up, and gets the `null` card.

## No themes is an answer

`build` reports how much it read (`citers`, `sentences`, `critiques`)
alongside the themes, so an empty card can say why: no citer cited widely
enough yet (a young paper), or sentences that only use the paper. There is
no minimum below which the reviewer isn't asked: with no sentences it makes
no call, and otherwise judging a handful costs little and answers honestly.

## Quotes

The reviewer returns verified sentence ids per theme. This module numbered
the sentences, so it maps each id back to its text and its citing paper's
node, orders a theme's quotes by that paper's citation count, and counts the
distinct papers raising it. A quote's paper is a trimmed node (`id`,
`arxiv_id`, `title`, `year`, `authors`, `citation_count`, `url`): enough to
show the line and open the paper.

## The cache

Each card is cached for `CACHE_SECONDS` (a month) under the paper's S2 ref.
A paper's critiques settle slowly but not never: the corpus refreshes weekly
and a young paper gathers citers fast. **A live card is a stopgap**: it's
kept for `LIVE_CACHE_SECONDS` (a day) at most, and is gathered again as soon
as the corpus can answer for the paper. Found at the card's review: SAC's
card was gathered while the contexts table was still being built, fell back
to live, and would have quoted that week's 4-citation papers for a month. `fresh` (the card's "Gather again")
replaces the entry. Bump `_CACHE_VERSION` when the payload or the reviewer's
prompts change.

## The one service that imports an agent at the top

`services/search/naming` reaches into `agents/` through a function-local
import, so the search service's other consumers don't construct an agent.
This package imports the reviewer at the top: building the card *is* the
reviewer's job, and its only consumer is the route that needs it.

## Verified by

`test/curious_astronaut/services/reviews/test_reviews.py`, with both sources
and the reviewer stubbed: `s2_ref`'s order, ids becoming quotes from real
citers ordered by citation count, the live fallback, a paper S2 can't name
(and a 404) answered without a model call, and the cache with `fresh`. The
route's own tests are in `test/curious_astronaut/routes/test_reviews.py`.
