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

Three new cards would each answer a different question about the paper, as
independent tools beside the two that exist. Today the **Paper Graph** answers
*where does this paper sit in the literature?* and the **Knowledge Graph**
answers *what do I need to know before I read it?* The **Reader** (filed to
the OnePager's Larger phases, 2026-10-23) will answer *how do I read it?*
Still unanswered: trying its idea, judging it, and what comes after it.

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
2. **Reader card.** Filed to the OnePager 2026-10-23, in progress.
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
