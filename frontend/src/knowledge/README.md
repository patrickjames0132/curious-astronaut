# `src/knowledge`

The **knowledge network** (Phase 5b, v8.14.0), the second tool on a paper's
card home. It is a short course on what a reader needs to know before the
paper makes sense, drawn as an interactive **graph of ideas**. The paper sits
in the middle. Breaking any item down adds the **concepts** it needs as new
nodes. Papers are never nodes, and since v8.17.0 lessons don't cite them
either. The goal, in Patrick's words, is that the reader feels they are
*taking a short course on the paper's dependencies and prerequisites*.

```
knowledge/
  KnowledgeNetwork.tsx  — the tool: starts the course, expands items, wires it all
  KnowledgeGraph.tsx    — the 2D canvas (react-force-graph-2d, as the paper graph)
  KnowledgeGraph3D.tsx  — the 3D scene (react-force-graph-3d), lazy-loaded
  KnowledgeControls.tsx — the folding course controls (sliders button, top-left)
  KnowledgeLegend.tsx   — node kinds, the edge, and node states (bottom-left)
  KnowledgePanel.tsx    — the side panel: why it's needed, what it needs, the lesson
  look.ts               — shared by both views: colours, sizes, labels, stable data, clicks
  useLessons.ts         — lesson streaming that outlives the tool's mount
  model.ts              — the graph and the pure rules over it (no React, no store)
  knowledge.css
```

## How it got this shape (5b's browser reviews)

1. **A syllabus tree first**: an indented outline with a lesson pane, where a
   prerequisite reached twice showed as a "covered above" stub. Patrick: *a
   more visual and interactive knowledge graph network instead of a tree …
   there would be no hierarchy … all edges would simply point to that node.*
2. **A graph with paper and concept nodes**, plus 3D "just for kicks". It
   was cluttered: a course bar over the canvas, labels everywhere, and a long
   title pill to get back to the cards.
3. **Concepts only, cleaned up** (2026-10-09). A paper bundles several ideas
   and sits at a different level from "Bellman equations", and the reader
   needs the ideas. So the graph holds the paper and concepts, and the paper's
   real references moved into the lessons as citations (removed again in
   v8.17.0: see Lessons). The controls fold
   into a sliders button like the paper graph's, a legend explains the
   colours, labels default to the neighbourhood in focus, and the way back to
   the cards is an ↑.

## The graph

- **One node per idea.** A node's id is its `nameKey` (the name with case,
  spacing and punctuation removed). When an expansion names something already
  on the map, it gets **another edge, not another node**. The tutor is sent
  the course's names so that it reuses them, which is what makes the keys
  match in practice.
- **One edge type, "`from` needs `to`"**, carrying the tutor's `why`, because
  the reason belongs to the pair: MDPs are needed by Q-learning for one reason
  and by policy iteration for another. The panel opens with where the
  item fits: each item that needs it, its name heading the reason. Until
  v8.17.0 each line read "*X* needs it: …", which Patrick found clunky.
- **No loops.** An edge whose prerequisite already (transitively) needs the
  item is dropped, so the course always has an order.
- **Context is the shortest route.** An item reachable several ways is
  explained to the tutor (`tutorPath`, `routeWhy`) along its most direct
  route from the paper.
- **Teaching order is a post-order walk** from the paper: each item after
  everything it needs, a shared concept once, the paper last. A known item
  counts as done and **prunes what it needs**. "Next lesson" is the next
  unchecked item in that order, wrapping round.
- **The saved shape is versioned** (`version: 3`). A course saved in any
  other shape (the tree, or the graph with paper nodes, both from early in
  5b) is started over rather than migrated: neither shipped.

## The views

- **Click** opens the item's lesson in the side panel and **centres it in
  view** (v8.17.0; so do Next lesson and the panel's links). In 2D that is a
  pan; in 3D the camera slides by the gap between what it looks at and the
  node, keeping its angle and distance, so the node lands in the middle of
  the reader's own view. The request carries a `seq`, so re-clicking the
  open node re-centres it after a pan. **Double-click**, the
  citation graph's re-seed gesture, breaks it down; so does the panel's
  "+ Break it down" button, in the panel's footer beside "Next lesson ›"
  (v8.17.0; it sat above the lesson before). A click on empty canvas closes the panel.
- **Select several to check off at once** (v8.17.0), with the citation
  graph's own gestures: **shift-click** toggles a node, and an **alt-drag**
  box adds every node inside it (`ui/useBoxSelect`, the gesture the citation
  graph's `useMarquee` is built on; an alt-click on empty canvas clears).
  Picked nodes' outlines turn the selection blue. The
  panel's own **"I know this"** is a switch (`ui/Switch`), green when on,
  labelled "Known" to its right (small caps, muted
  off and green on), with "I know this" as its tooltip. Switching it
  animates the kicker in CSS alone: "Known" widens to push "Concept" right
  and then rises in, and switching off reverses it (`.kicker-known`). The panel no longer
  lists what an item needs (a "Needs" row of chips until v8.17.0): the
  graph's arrows show that, labelled "Depends on" in the legend. A bar at
  the bottom of the canvas offers **✓ I know these** (`knowledgeKnownSet`),
  or **Not known** when every picked node is already known, and Clear; Esc
  clears too. The selection is component state, never saved: it's a gesture,
  not part of the course. Each view hands the box a `KnowledgeEngine`
  (`engineRef`) that hit-tests its own nodes on screen.
- **Colours:** gold for the paper, violet for a concept. **States**
  (`nodeLook`, v8.17.0): **green** once known, and a concept is **grey**
  until it has been explored (its lesson opened, or broken down), violet
  after. **Outlines follow the citation graph**, on the node's own edge: a
  thin black line on every node (`--node-outline`), the canvas's hard ink on
  the open one (white on dark, near-black on light), and the selection blue
  on picked ones. While a breakdown is in flight that edge turns into moving
  blue dashes. In 3D the outline is a camera-facing ring on the sphere's
  silhouette (an empty `SpriteText` whose rounded border is the ring). Mind
  the texture size: three-spritetext draws at `fontSize / textHeight` canvas
  pixels per world unit, so the ring's text height is half its diameter (a
  ~180 px canvas). A first cut used 0.01 and gave every node a texture tens
  of thousands of pixels wide; that, plus rebuilding every node's sprites on
  each hover, made 3D crawl. 3D keeps no hover state now. On
  the way here v8.17.0 tried, and dropped, a grey/black "explored" outline,
  a cyan halo round picked nodes, and a separate blue ring for the open one.
  Before it, an opened item was grey and a known one grey with a ✓; and a
  dashed ring meant "more to break down", dropped because it was nearly
  always true: the tutor can keep breaking anything down. The legend
  (`KnowledgeLegend`) lists Paper, Concept, Depends on, Known and New; the
  outlines need no entry. The panel's kicker takes its node's colour ("Paper"
  gold, "Concept" violet, and "Known concept" / "Known paper" green once
  known), through theme tokens deepened for the light panel.
- **Labels follow the citation graph's rule** (`labelled` in `look.ts`,
  v8.17.0) with a lower threshold: zoomed in past `LABEL_ZOOM` (0.6, against
  the citation graph's 1.6, since a course is smaller and sparser) every
  node is named; zoomed out, only the paper, the open item, picked
  items and the node under the pointer. 3D names everything, since its
  labels shrink with distance. Until v8.17.0 a Nearby / All toggle in the
  controls chose between naming the neighbourhood in focus and every node.
- **The controls** (`KnowledgeControls`) fold into a sliders button in the
  top-left corner. It is the shared `ui/SlidersGlyph`, on the paper graph's
  own `.ctrl-icon` / `.controls` styles, so the two canvases have one corner
  button. Folded by default. Inside are 2D/3D, the citation
  graph's action row **Release · Fit · Clear** (no Refresh: nothing here is
  refetched), and the gesture hints. Since v8.17.0 a **drag pins** a node
  where it's dropped, as on the citation graph, and Release unpins them all
  (through each view's `KnowledgeEngine`); pins live on the view's own node
  objects, so a 2D/3D switch starts unpinned. Clear drops the selection.
  Until v8.17.0 the panel opened with the course's progress and a Next
  lesson button; Next lesson lives in the lesson panel's footer now.
- **3D**, added "just for kicks" (Patrick), uses the same data, colours,
  labels and gestures through `look.ts`. three.js is several hundred
  kilobytes, so `KnowledgeGraph3D` is behind `React.lazy` and only downloads
  when the switch is flipped. The 2D/3D choice is remembered per browser.
- **Fitting the view.** Each view fits itself once when its layout first
  settles, but never around the lone paper a new course starts with. The
  Fit button's counter lives in `KnowledgeNetwork` and survives a 2D/3D
  switch, so `useFitButton` (`look.ts`) acts only on a press made while the
  view is showing. Fitting on mount framed nodes still bunched at their
  starting positions, and the 3D view came up blank (v8.17.0).
- `useGraphData` keeps node objects **stable** across updates, because the
  force engine writes positions onto them. A new concept starts beside the
  item that needs it, rather than flying in from the origin.

## The course lives on the thread

`ThreadRecord.knowledge` (`store/explorations.ts`) holds the map: nodes,
edges, the checked-off ids and the open item. It saves with the exploration.
The `knowledge*` reducers take an explicit `threadId`, so an expansion or a
lesson that finishes after the reader has moved on still lands on its own
course. This component holds only what is in flight.

## Lessons

A lesson is written **the first time its item is opened**, streamed into the
panel, and kept on the node. Moving on never aborts it (`useLessons`), and
in-flight lessons are tracked at module level, so remounting the tool doesn't
start the same lesson twice. The paper's own lesson is grounded in its
abstract.

**Lessons don't cite papers** (Patrick, v8.17.0). From v8.14.0 they cited the
paper's real references as `[n]` links that opened the cited paper's thread.
It was grounded but felt off ("bare numbers read as footnotes", and every
lesson cited the *root* paper's list however deep it sat), so citations are
out for now; a suggestions section of vetted resources is the planned
replacement. A course saved before then still holds lessons with markers and
their `refs`: `lessonText` (`model.ts`) hides just the markers those `refs`
resolved, so a bracketed range like `[0, 1]` in the prose survives.

## Not yet (later Phase 5 stages, see the OnePager)

There is no challenger agent, no memory of known concepts across papers, no
verified external resources, and no interactive visuals. There is no
assistant docked here: since v8.15.0 it lives on the Citation Graph alone (see
`teacher/README.md`).

## Verified by

`test/knowledge/model.test.ts` covers identity, node kinds, shared concepts,
loops, routes, course order, pruning, next-lesson and `lessonText`.
`test/knowledge/KnowledgeGraph.test.tsx` covers the 2D view's first fit and
that a shift-click selects without opening.
`test/knowledge/KnowledgeNetwork.test.tsx` runs the tool over a real store,
with the canvas swapped for a list of node buttons (jsdom can't draw). It
covers the first expansion and its grounding, an old-shape course being
replaced, a lesson streamed into the panel and kept, visiting, a check-off,
checking off a selection (and taking it back, and Esc),
the next lesson, a shared prerequisite becoming one node with two edges, a
retry, and the course surviving a save round-trip. The 3D view, the canvas
painting, the folding controls and the legend are checked in the browser.
