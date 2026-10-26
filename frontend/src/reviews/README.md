# `reviews/`

The **Peer Reviews** card (tool id `'reviews'`): what the field objected to
in a paper. Each concern is a section: its headline, how many papers raise
it, a short summary, and the sentences that raise it, quoted word for word
from the citing papers, most-cited first. The server does the gathering
(`POST /api/reviews`, `services/reviews` and the `reviewer` agent); this
folder shows it.

```
PeerReviews.tsx — the card: loading, error, empty and themed states, in a
                  still frame whose page scrolls under tools/ScrollNav
reviews.css     — its reading column and the sage (--reviews-ink) accents
```

## Not conference reviews

v1 reads the **literature**, not OpenReview: the weaknesses later papers
found, from the sentences in which they cite this one. The name covers both
(the field reviewing a paper), and OpenReview's reviews are meant to join it
later, so the card says plainly where its critiques come from: the hint
under the heading, and the provenance line above the themes. That line
differs by source: the most-cited citers (the offline corpus), or the most
recent ones (S2 live, for a paper outside the corpus), which it calls the
recent conversation rather than the field's verdict.

## States

- **Loading**, with "this takes about half a minute" and an
  invitation to explore elsewhere meanwhile (Patrick): the server judges a
  few hundred sentences and groups the critiques on a first open, then
  caches the card for a month, and the gather survives leaving the card
  (below).
- **Error**, with "Try again", which asks fresh.
- **Empty**, saying why (`emptyReason`): Semantic Scholar doesn't know the
  paper, no widely cited paper cites it yet, or none of the sentences read
  criticises it. Always shown: the card never hides itself.
- **Themes**, three quotes each, then "Show N more". "Gather again" at the
  foot, a pill with a replay arrow, replaces the cached card.

Gathered cards live in a module-level map for the session, by paper id, so
leaving the card mid-gather and coming back joins the same request.

## The ways to a citing paper

Under each quote, the citing paper's title, year and citations, and:

- **Open** — the paper as its own thread, on its card home (`openPaper`). By
  arXiv id when it has one, which opens under either provider; otherwise by
  its S2 corpus id, which only S2 resolves, so that open uses S2.
- **Show in Citation Graph** — `showCiterInGraph` (`store/workspace.ts`):
  build the graph if it isn't, add the citer if the graph lacks it, select
  and centre it, its detail panel open and its links lit, as the Reader's
  citation card does. **The graph keeps only a cut of a paper's citers** (on
  Attention, 6 of a card's 13 quoted papers), and the button first greyed out
  for the rest, which read as a bug (Patrick, at the card's review: it worked
  before the graph was built, then went dead). Every quoted paper cites this
  one by construction, so it's added as a discovery with that citation edge,
  the way an expansion adds a paper, and saved with the thread. A citer
  matches a drawn paper by id or arXiv id; the tooltip says when it will be
  added. Before switching, it sets `returnTo: { tool: 'reviews', from:
  'graph' }`, so the graph shows **Back to Peer Reviews** in its ↑'s place,
  and back means the same place: the card remembers, per paper for the
  session, how far down it was scrolled and which themes showed all their
  quotes.

Often the paper naming a weakness is the one that fixed it (*Linformer*,
*FlashAttention*), which is why the graph is one click away.

## Help surfaces

The card home's card (`tools/ToolCards.tsx`), the CARDS tour's "Pick a tool"
step, and the REVIEWS tour phase (`tour/steps.ts`), which anchors on
`data-tour="reviews"`, `"reviews-source"` and `"reviews-themes"`, and the
Citation Graph tour's "Back to Peer Reviews" step (on the pill's
`data-return="reviews"`). Change
what the card does and update those with it.

## Verified by

`test/reviews/PeerReviews.test.tsx`: the request for the thread's paper, a
theme's first quotes and "Show N more", the provenance line, the error's
retry (asked fresh) landing on an honest empty state, Open by arXiv id,
Show in Citation Graph setting the way back (and the card reopening with
its themes still expanded), and each source's and each empty card's wording.
`test/App.test.tsx` covers the pill itself.
