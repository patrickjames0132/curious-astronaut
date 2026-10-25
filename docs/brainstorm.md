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

New cards would each answer a different question about the paper, as
independent tools beside the ones that exist. Today the **Citation Graph**
answers *where does this paper sit in the literature?*, the **Knowledge Graph**
*what do I need to know before I read it?*, and the **Reader** (v8.37.0)
*how do I read it?* The **Criticism card** (filed to the OnePager's Larger
phases 2026-10-24, the former "Reviews" idea) will answer *what did the field
object to?* Still unanswered: trying its idea, and what comes after it.

- **Lab — can I try it?** The agent writes a small runnable toy of the paper's
  key mechanism (attention on a sentence, a Q-learning gridworld, a diffusion
  step). It runs in the browser via Pyodide, with sliders and plots, so
  there's nothing to install. Can also hold a problem set with worked
  solutions. *Builds on:* the interactive visuals planned for Knowledge Graph
  lessons.
- **Frontier — what's still unsolved?** Mines the future-work and limitations
  sections of recent citing papers and clusters them into open questions.
  Each one shows who is working on it and how recently. *Builds on:* Latest
  Publications; the agent crew; and the Criticism card's citation-contexts
  table, since citing sentences that say "remains open" are the same data.

**Already card-shaped:**

- **Slides** (Phase 6) fits as a card: open it and the deck builds from the
  lecture beats and mined figures.
- **Bridge two topics** takes *two* seeds, so it may belong on the homepage
  rather than inside one paper's thread. Decide that before building it.

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
2. **Reader card.** Filed to the OnePager 2026-10-23; shipping in stages since v8.37.0.
3. **Shareable snapshot.** The biggest reach win.
4. **Lectures in the reader's language.** Cheap and wide.
5. **Criticism card** (ex "Reviews"). Filed to the OnePager 2026-10-24.
6. **Lab card.** The most ambitious.

To decide before filing:

- [ ] Does Bridge two topics live on the homepage or inside a paper thread?
- [ ] Does Lab run code in the browser (Pyodide), or produce a notebook to
      download?
- [ ] How many cards can the card home hold before it needs a new layout?
