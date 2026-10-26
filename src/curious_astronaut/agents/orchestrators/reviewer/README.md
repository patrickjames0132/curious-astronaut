# `agents.reviewer`

The Peer Reviews card's themes: **what the field objected to in a paper**,
grouped from the sentences in which later papers cite it, every quote a real
sentence from a real citing paper.

`review(target, sentences)` takes the paper (title, authors, year) and every
citing sentence to read, each with an id, and returns verified themes. Which
sentences, from which citers, is the caller's business
(`services/reviews`); this package only judges, groups and checks.

## Two passes, then a check

1. **Judge** (the summarizer's model). Batches of `JUDGE_BATCH` sentences,
   `JUDGE_CONCURRENCY` in flight: each sentence is a critique *of this
   paper* or not, plus the weakness in a few words. Critique is rare —
   about 4% of sentences on the prototype's landmarks; most citations are
   background ("we use Adam [23]").
2. **Group** (the researcher's model). The critiques, with the judge's
   points, become at most `MAX_THEMES` themes, each citing sentence ids.
3. **Verify** (code). A theme keeps only ids the judge called critiques; a
   theme left with none is dropped, and the loss logged. So **the models
   choose and group, they never write a quote**: the card shows the
   sentence the id names, word for word.

A verdict for an id the judge wasn't given is dropped, and an id it skipped
counts as not a critique. No sentences means no model call; no critiques
means no grouping call. Model failures propagate, and the route answers 502.

## No agent id of its own

It borrows two: `summarizer` for the judge (the crew's cheapest, and the
judge reads a few hundred sentences a paper) and `researcher` for the
grouping (the strongest writer of grounded prose). The summarizer's titler
set the precedent: a seventh entry in Agent Settings would be one more model
to choose for a job two existing entries already describe. The cost is that
changing the researcher's model changes the card's grouping too.

## The prompts' known weaknesses

From the 2026-10-24 prototype, on Attention and DDPM:

- A criticism of a **whole family** the paper belongs to ("autoregressive
  models are slow (Vaswani et al.; …)") can slip through as a criticism of
  the paper. The judge's prompt names the case; it still happens.
- A long tail of **single-paper themes that are barely critiques** (an
  implementation note). The grouper is told to leave those out.

## Where it came from

Prototyped 2026-10-24 (filed from `docs/brainstorm.md` as the Criticism
card); named Peer Reviews and scoped with Patrick 2026-10-25. The full
decision record, including why OpenReview's reviews wait for v2, is the
card's entry in `docs/history.md` (until it ships, `OnePager.md`).

## Verified by

`test/curious_astronaut/agents/orchestrators/reviewer/test_main.py`, with
scripted models: the judge's batches and its byline, an invented verdict
dropped, the grouper seeing critiques only, ids that aren't critiques
removed from a theme and a theme left empty dropped, and no call when there
is nothing to judge or nothing to group.
