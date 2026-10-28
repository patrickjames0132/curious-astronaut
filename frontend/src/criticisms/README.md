# `criticisms/`

The **Criticisms** card (tool id `'reviews'`): what the field objected to
in a paper. Each criticism is a numbered section: its number and headline,
how many papers raise it, a short summary, and the sentences that raise it,
quoted word for word from the citing papers, most-cited first. A contents
rail on the left lists them by number. The server does the gathering
(`POST /api/reviews`, `services/reviews` and the `reviewer` agent); this
folder shows it.

```
Criticisms.tsx — the card: loading, error, empty and listed states, in a
                 still frame whose page scrolls under tools/ScrollNav, the
                 contents rail beside it
criticisms.css — its reading column, the numbers, the glide after the rail,
                 and the sage (--criticisms-ink) accents
focus.ts       — which criticism to open at, handed over by the Reader's
                 criticism card
```

## From the Reader (v8.54.0)

The Reader notes each criticism beside the passage it is about, once this
card has been gathered (`reader/README.md`, "The criticism notes"). A
note's card has **Read in Criticisms**: it hands this card the criticism's
number (`focusCriticism`), sets `returnTo: { tool: 'reader', from:
'reviews' }` and opens it. Here, once the criticisms are on the page, the
card takes the number (`takeFocus`, once) and goes to it as a contents click
would, lit until the reader scrolls; and `ScrollNav` shows **Back to
reading** in the ↑'s place, to the same place in the paper.

## The name

Shipped as **Peer Reviews** (v8.52.0; it was "Criticism" before that),
renamed **Criticisms** 2026-10-27 (Patrick). The rename stops at what people
see and the frontend's own names: the tool id `'reviews'`, the
`/api/reviews` route, the server's `services/reviews` and `reviewer` agent,
its month-long card cache and the tour's seen-flag
(`curious_astronaut.tour.reviews`) keep the first name, so saved threads,
cached cards and a tour already seen all carry over. When OpenReview's
conference reviews come (v2), they join this card: they're criticisms too.

## Numbers and contents

Each criticism carries its number (1, 2, …, in the card's order, the most
raised first), in sage before its headline, so one can be named by it. The
**contents rail** is the Reader's (`contents/ContentsRail`, shared): each
criticism by its number, the one being read lit (the last whose top has
passed the top third of the page), a click going straight to it and staying
lit until the reader scrolls by hand. It folds, drags and slides as the
Reader's does, remembered apart from it (`ca.criticismsContentsOpen` /
`ca.criticismsContentsWidth`), and the page glides after it
(`.criticisms-main.glide-*`). It's drawn only once there are criticisms: no
rail while loading, on an error or on an empty card.

## Not conference reviews

v1 reads the **literature**, not OpenReview: the weaknesses later papers
found, from the sentences in which they cite this one. OpenReview's reviews
are meant to join it later, so the card says plainly where its critiques come from: the hint
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
- **Criticisms**, numbered, three quotes each, then "Show N more". "Gather again" at the
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
  'graph' }`, so the graph shows **Back to Criticisms** in its ↑'s place,
  and back means the same place: the card remembers, per paper for the
  session, how far down it was scrolled and which criticisms showed all
  their quotes.

Often the paper naming a weakness is the one that fixed it (*Linformer*,
*FlashAttention*), which is why the graph is one click away.

## Help surfaces

The card home's card (`tools/ToolCards.tsx`), the CARDS tour's "Pick a tool"
step, and the CRITICISMS tour phase (`tour/steps.ts`), which anchors on
`data-tour="criticisms"`, `"criticisms-source"`, `"criticisms-list"` and
`"criticisms-contents"`, and the Citation Graph tour's "Back to Criticisms"
step (on the pill's `data-return="reviews"`, the tool id). Change what the
card does and update those with it.

## Verified by

`test/criticisms/Criticisms.test.tsx`: the request for the thread's paper, a
criticism's number, first quotes and "Show N more", the provenance line, the
error's retry (asked fresh) landing on an honest empty state, Open by arXiv
id, Show in Citation Graph setting the way back (and the card reopening with
its criticisms still expanded), each source's and each empty card's wording,
and the contents: numbered entries, a click lighting one and scrolling to
it, folding remembered apart from the Reader's, and no rail on an empty card.
`test/App.test.tsx` covers the pill itself.
