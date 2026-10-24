# Feature brainstorm — ideas not yet filed

A holding pen for feature ideas that **haven't earned a Backlog slot yet**
(started 2026-10-21). Nothing here is committed work: when an idea is ready,
file it into [OnePager.md](../OnePager.md)'s Backlog under its theme section
and delete it from here, the same way the `todos.md` inbox drains. OnePager
wins; this file is a staging area, not a second roadmap.

The ideas are weighed against the OnePager's own rule. Curious Astronaut exists
for access, not as a business, so the real risks are **cost, installability
and discoverability**, and every answer should stay grounded in real papers.
Ideas that are already shipped, already in the Backlog (Slides, Bridge two
topics, the startup discovery feed) or deliberately retired (audio lectures,
polished media) are left out, except where they fit the new card idea below.

---

## New homepage cards

Four new cards would each answer a different question about the paper, as
independent tools beside the two that exist. Today the **Paper Graph** answers
*where does this paper sit in the literature?* and the **Knowledge Graph**
answers *what do I need to know before I read it?* Still unanswered: reading
the paper, trying its idea, judging it, and what comes after it.

- **Reader — how do I read it?** A section-by-section guided read. Citations
  like `[23]` link to Paper Graph nodes, terms link to Knowledge Graph
  concepts, equations get an "explain this line" button, and the teacher
  answers questions about the current paragraph. *Builds on:* the figure
  miner's PDF/ar5iv fetching; the KaTeX `notation/` package. It would also
  absorb the Backlog's "Show the paper inline on the card home".
- **Lab — can I try it?** The agent writes a small runnable toy of the paper's
  key mechanism (attention on a sentence, a Q-learning gridworld, a diffusion
  step). It runs in the browser via Pyodide, with sliders and plots, so
  there's nothing to install. Can also hold a problem set with worked
  solutions. *Builds on:* the interactive visuals planned for Knowledge Graph
  lessons.
- **Reviews — what did experts object to?** Pulls OpenReview's public
  reviews, rebuttals and decisions (ICLR, NeurIPS, TMLR, …). Summarises the
  objections, the authors' answers, and which concerns later papers proved
  right or wrong. Can add citing papers that challenge the work or fail to
  replicate it. *Builds on:* OpenReview's open API; S2 citation intents.
- **Frontier — what's still unsolved?** Mines the future-work and limitations
  sections of recent citing papers and clusters them into open questions.
  Each one shows who is working on it and how recently. *Builds on:* Latest
  Publications; the agent crew.

**Already card-shaped:**

- **Slides** (Phase 6) fits as a card: open it and the deck builds from the
  lecture beats and mined figures.
- **Bridge two topics** takes *two* seeds, so it may belong on the homepage
  rather than inside one paper's thread. Decide that before building it.

### Reader — workshop notes (2026-10-21)

**The prior art is SpatialRead, and it changes what v1 leads with.**
[SpatialRead](https://www.producthunt.com/products/spatialread) is a desktop
paper reader: a PDF viewer where you highlight text and run Explain, Simplify
or Expand on it, with your own API key or local Ollama, documents kept on your
machine, and screenshot analysis of figures. Its graph is built from *your own
reading* (each AI explanation becomes a node on a canvas). It's closed source
and, depending on the listing, paid ($49 on
[AlternativeTo](https://alternativeto.net/software/spatialread/?p=3), $99 on
[Capterra](https://www.capterra.in/software/1082446/SpatialRead); not
confirmed on its own site). It also reportedly ships a "critical peer
reviewer" agent ([AISO](https://aisotools.com/tool/spatialread)), which means
*generated* critique.

So **highlight-and-explain alone would be a free SpatialRead with less
polish.** By the OnePager's rule that's still worth something (reach, not
uniqueness, is the test, and a free, open-source version serves people a paid
app doesn't). But it means v1 should **lead with what only Curious Astronaut
can do**, which is connecting the text to structure the app already has:

- `[23]` resolves to the **actual cited paper**, a real node in the Paper
  Graph, via S2. SpatialRead links to nothing outside the PDF.
- Terms and per-section notes come from the paper's **Knowledge Graph**
  prerequisites, including what the reader has already ticked off.
- A guided read reuses the **lecturer**: the teacher walks you through, the
  current paragraph highlighted the way Paper Graph nodes light up today.

The same split applies to the **Reviews** card: real OpenReview reviews and
rebuttals, not a generated reviewer. Grounded rather than invented is the
project's line.

**The main technical fact: the full text we have today is flat.**
`integrations/arxiv/fulltext.py` reduces ar5iv's HTML to plain text blocks.
Math survives as LaTeX, but `<cite>` and `<figure>` are dropped and section
structure isn't kept. That's right for its job (model context), but a Reader
needs sections, figures in place, and citation markers still tied to their
bibliography entries. So the Reader's core is a **new structured parse beside
the flat one**, not a reuse of it. `services/pdf/text.py` is flatter still.

**Sketch:**

```
┌ Reader: Attention Is All You Need ─────────────────────────┐
│ Contents     │ 3.2 Scaled Dot-Product Attention            │ Teacher        │
│ 1 Intro      │ We call our particular attention "Scaled    │ ▸ Before this  │
│ 2 Background │ Dot-Product Attention" [Figure 2]…          │   section: you │
│ 3 Model    ◂ │                                             │   need softmax │
│   3.1        │   Attention(Q,K,V) = softmax(QKᵀ/√dₖ)V  [?] │   ✓ known      │
│   3.2 ◂      │                                             │                │
│ 4 Why self-  │ …additive attention [2] ← hover: Bahdanau   │ Ask about the  │
│   attention  │   2014 · open in Paper Graph                │ selection…     │
└──────────────┴─────────────────────────────────────────────┴────────────────┘
```

**Decisions (proposed, not settled):**

1. **Text source: ar5iv first, PDF viewer as fallback.** Structured ar5iv
   HTML gives real math, figures and citation links, but only for arXiv
   papers. A pdf.js viewer covers every open-access paper but can't
   practically link citations or terms. The fallback viewer is also exactly
   what blocks the Backlog's "click a library citation to open the source at
   that page", so building it here unblocks that item too.
2. **Citation resolution:** ar5iv ties each marker to a bibliography entry;
   match that entry to S2's reference list by arXiv id or DOI first and by
   title as a fallback. Leave markers unlinked in the PDF fallback for v1.
   Proper PDF reference parsing needs something like GROBID (a heavy Java
   service), which is wrong for an app meant to be easy to install.
3. **Reading at your own pace before a guided read.** A margin teacher that
   responds when you act ships first; the guided read (reusing the lecturer's
   beat format) comes later.

**Reordered v1** — the differentiating parts first:

1. Structured ar5iv parse, reading view and table of contents.
2. Citation hover card, plus a jump into the Paper Graph.
3. Knowledge Graph notes in the margin (when a Knowledge Graph exists for the
   paper).
4. Highlight-and-explain and "explain this equation" — table stakes, not the
   headline.

**v2:** the PDF fallback viewer (shipping the library page viewer with it),
then the guided read.

**Links run both ways.** v1 links the text out to the graphs; the reverse is
"show me where the paper uses this" — from a Knowledge Graph concept, jump to
the passages that rely on it; from a Paper Graph node, jump to the sentences
that cite it. The same structured parse serves both directions, so it belongs
to this card. *(Absorbed the earlier standalone "Read alongside the graph"
idea, which v1 made redundant — 2026-10-21.)*

**Open questions:**

- [ ] What share of the papers you actually read are on arXiv? That decides
      how much the PDF fallback matters.
- [ ] Should the Reader replace the vague "Show the paper inline on the card
      home" Backlog item?
- [ ] Note for the **shareable snapshot** idea: showing arXiv text inside a
      local app is like viewing it in a browser, but putting it in an
      exported snapshot is redistribution, and arXiv licenses vary by paper.

### Reviews — workshop notes (2026-10-22)

**Coverage decides how useful it is: public reviews exist mostly for recent
ML papers.**

- **ICLR** (on OpenReview since 2013) and **TMLR** publish reviews for
  essentially every submission, rejected ones included.
- **NeurIPS** publishes reviews for **accepted papers only**; rejected papers
  are public only if their authors opt in
  ([NeurIPS 2021 policy](https://blog.neurips.cc/2021/04/09/neurips-2021-changes-to-the-review-process/),
  still in the
  [2025 reviewer guidelines](https://neurips.cc/Conferences/2025/ReviewerGuidelines)).
  Few do: about 17 public accepted reviews for every 1 rejected one at
  NeurIPS 2024 ([arXiv 2511.23439](https://arxiv.org/pdf/2511.23439)).
- **ICML** and **ACL** also run on OpenReview, but their reviews mostly stay
  private.

So the usual examples (Attention, DQN) don't qualify: Attention was NeurIPS
2017, before NeurIPS moved to OpenReview. Most journal papers have nothing.
The card needs a good answer for "no public reviews", or it is empty for much
of what people read.

**What the card shows:**

1. **Header** — venue, decision (oral / poster / reject), and a link to the
   OpenReview forum.
2. **What reviewers worried about** — concerns grouped across all the
   reviews, not review by review ("Baselines too weak — raised by 3 of 4
   reviewers"). Each concern quotes and links the review it came from.
3. **How the authors answered** — the rebuttal for each concern, and whether
   the reviewer said they were convinced.
4. **What happened next** — the part only this app can do. For each concern,
   look at later citing papers: did someone fix it, confirm it, or show it
   didn't matter? This joins the reviews to the Paper Graph. It is also the
   hard, agent-driven part and the one most at risk of the model inventing a
   verdict, so every claim needs a quoted citing sentence behind it.

**Scores, but low-key.** Show them without leading with them. The arguments
teach more than the numbers; reviewer scores aren't comparable across
research areas ([arXiv 2607.27209](https://arxiv.org/pdf/2607.27209)); and
**ICLR 2026's public scores aren't the real final scores**: after the
November 2025 OpenReview leak of reviewer identities, ICLR reset every score
to its pre-rebuttal value
([ICLR response](https://blog.iclr.cc/?p=1063),
[retrospective](https://blog.iclr.cc/2026/03/31/a-retrospective-on-the)).

**For papers with no public reviews: "Challenges from the literature".**
Citing sentences that dispute the paper, fail to replicate it, or point out a
limitation. S2 can return each citation's **context** (the sentence where the
citation appears); we don't fetch it today — `traversal.py` reads only
`isInfluential`. S2's intent labels (background / method / result) have no
"disagrees" label, so the model sorts the sentences, quoting each one. That
makes it more a **"Criticism" card with peer review as its best source**, so
the name may need to change.

Later, outside ML: some journals publish their reviews (eLife, F1000, PeerJ,
Nature's transparent peer review files). A messier set of sources; v2 at the
earliest.

**Engineering notes:**

- **Matching a paper to its OpenReview page.** As far as we know, S2's
  `externalIds` has no OpenReview id, so it's a title search through
  OpenReview's API, checked against the author list and year. Expect some
  misses.
- **Access.** OpenReview allows guest (no-login) reads
  ([client docs](https://openreview-py.readthedocs.io/en/latest/)). Not
  confirmed whether that changed after the November 2025 incident
  ([OpenReview's analysis](https://openreview.net/forum/user%7Cinitial_analysis_of_openreview_api_security_incident))
  — check before relying on it. Read only public notes, slowly, and cache
  them: that incident was caused by scraping its API.
- **No reviewer identities, ever.** Reviews are anonymous; the card never
  tries to work out who wrote one.

**Making it a lesson: review it yourself first.** Before showing the real
reviews, the card asks *"What would you criticise about this paper?"*, then
compares your points with the real reviewers': what you caught, what you
missed, what you raised that they didn't. Practice in reading critically,
which suits the teaching mission. Optional — you can always skip straight to
the reviews.

**Proposed v1:** OpenReview only — matching, the header, grouped concerns
with quotes, rebuttals — plus the "review it yourself first" exercise, and an
honest "no public reviews" state.

**v2:** "What happened next", the "Challenges from the literature" fallback,
and journals that publish their reviews.

**Open questions:**

- [ ] Does the card appear only when reviews exist, or always, with the
      fallback?
- [ ] Does "review it yourself first" appeal, or is it friction?
- [ ] Do the recent ML papers you read mostly come from ICLR / NeurIPS /
      TMLR? That is what v1 can actually cover.

## Building on what exists

These three extend tools that have already shipped, so none of them needs a
new data source.

- **Quiz before check-off.** Today a Knowledge Graph check-off is just a
  claim. Instead, the teacher asks 2–3 questions grounded in the lesson, and
  passing them ticks the node. Optional spaced-repetition review brings old
  concepts back later. This makes "a short course" one you actually learn
  from.
- **A "what I know" record across papers.** Right now "Bellman equations"
  gets ticked again in every Knowledge Graph. One shared list of known
  concepts would carry over to every new graph, so each course gets shorter
  the more you use the app.
- **Lectures in the reader's language.** Mostly prompt work plus a setting.
  Probably the most new readers for the least effort, which is the Reach &
  access argument.

## Making the graph say more

- **Show how a paper cites another.** Semantic Scholar reports why one paper
  cites another (background, method, result) and whether the citation was
  influential. Edges could show this, so "papers this built on" becomes
  "papers whose methods it used", and the teacher can say "X borrowed Y's
  method, not just its framing".
- **Open problems on the frontier.** Pull the future-work and limitations
  sections from Latest Publications and group them into "what the field is
  still stuck on". *(This grew into the Frontier card above.)*
- **Compare two papers side by side.** Select two nodes and get a structured
  breakdown: same problem? different assumptions? which results beat which?
  A sharper version of the "how does this node differ" question.

## Getting things out of the app

- **A shareable read-only snapshot.** Export a graph plus its lecture as one
  static HTML file anyone can open without installing anything. This answers
  the Backlog's "Nowhere to try it": every user becomes a way for someone new
  to see what the app does.
- **Export a reading list.** BibTeX, Zotero, or a printable syllabus of the
  course in prerequisite order. Cheap, and useful to people whose workflow
  lives in other tools.

## Smaller ideas

- **Explain it back to me.** You explain a concept and the teacher critiques
  your explanation.
- **What's new since you last looked.** Reopening a saved session shows the
  citing papers added since your last visit. It's the useful part of the old
  digest without the scheduled pulling.
- **A text outline of the graph for screen readers**, for accessibility.

## Suggested order and open questions

A suggested order, not a commitment:

1. **Quiz before check-off + the "what I know" record.** They finish the
   Knowledge Graph story rather than starting a new one.
2. **Reader card.** The other cards point back at passages of the paper, so
   it's their foundation.
3. **Shareable snapshot.** The biggest reach win.
4. **Lectures in the reader's language.** Cheap and wide.
5. **Reviews card.** The most distinctive; OpenReview's API keeps the cost
   low.
6. **Lab card.** The most ambitious.

To decide before filing:

- [ ] Does Bridge two topics live on the homepage or inside a paper thread?
- [ ] Does Reviews stay limited to OpenReview venues, or fall back to citing
      papers that challenge the work?
- [ ] Does Lab run code in the browser (Pyodide), or produce a notebook to
      download?
- [ ] How many cards can the card home hold before it needs a new layout?
