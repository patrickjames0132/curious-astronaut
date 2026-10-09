# `src/knowledge`

The **knowledge network** (Phase 5b, v8.14.0), the second tool on a paper's
card home. It is a short course on what a reader needs to know before the
paper makes sense, drawn as an interactive **graph of ideas**. The paper sits
in the middle. Breaking any item down adds the **concepts** it needs as new
nodes. Papers appear inside the lessons, as citations of the paper's real
references. The goal, in Patrick's words, is that the reader feels they are
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
   real references moved into the lessons as citations. The controls fold
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
  and by policy iteration for another. The panel lists every item that needs
  the open one, with its reason.
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

- **Click** opens the item's lesson in the side panel. **Double-click**, the
  paper graph's re-seed gesture, breaks it down; so does the panel's
  "+ Break it down" button. A click on empty canvas closes the panel.
- **Colours:** gold for the paper, violet for a concept. **States:** grey
  once its lesson has been opened, grey with a ✓ once known, and a **dashed
  ring** while it hasn't been broken down (turning while that is in flight).
  The open item gets the selection ring and its edges light up. The legend
  (`KnowledgeLegend`) lists all of this.
- **Labels default to "Nearby"** (`labelled` in `look.ts`): the paper, the
  item in focus (the open lesson, else the paper), everything joined to it,
  and whatever is under the pointer. "All" names every node. The choice is
  remembered per browser.
- **The controls** (`KnowledgeControls`) fold into a sliders button in the
  top-left corner. It is the shared `ui/SlidersGlyph`, on the paper graph's
  own `.ctrl-icon` / `.controls` styles, so the two canvases have one corner
  button. Folded by default. Inside are the progress and next lesson, 2D/3D,
  label density, "Fit the course in view", and the gesture hints.
- **3D**, added "just for kicks" (Patrick), uses the same data, colours,
  labels and gestures through `look.ts`. three.js is several hundred
  kilobytes, so `KnowledgeGraph3D` is behind `React.lazy` and only downloads
  when the switch is flipped. The 2D/3D choice is remembered per browser.
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
panel, and kept on the node together with its citations (`refs`). Moving on
never aborts it (`useLessons`), and in-flight lessons are tracked at module
level, so remounting the tool doesn't start the same lesson twice. Every
lesson is sent the paper's provider id, so the server can hand the tutor the
real reference list; its `[n]` markers render through the assistant's
`AnswerMarkdown` (`paperRefs` + `onPaperSeed`) as citations that open the
cited paper in its own thread (`openPaper`, onto its cards). The paper's own
lesson is grounded in its abstract.

## Not yet (later Phase 5 stages, see the OnePager)

There is no challenger agent, no memory of known concepts across papers, no
verified external resources, and no interactive visuals. The assistant
beside the tool still answers seedless (a follow-up).

## Verified by

`test/knowledge/model.test.ts` covers identity, node kinds, shared concepts,
loops, routes, course order, pruning and next-lesson.
`test/knowledge/KnowledgeNetwork.test.tsx` runs the tool over a real store,
with the canvas swapped for a list of node buttons (jsdom can't draw). It
covers the first expansion and its grounding, an old-shape course being
replaced, a lesson streamed into the panel with a working citation and kept,
visiting, a check-off,
the next lesson, a shared prerequisite becoming one node with two edges, a
retry, and the course surviving a save round-trip. The 3D view, the canvas
painting, the folding controls and the legend are checked in the browser.
