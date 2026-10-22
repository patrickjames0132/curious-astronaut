# `src/graph/canvas`

The ForceGraph2D wrapper — every canvas painter for the explorer: node
fills by relation (and pink, `EXPANDED_COLOR`, for a paper an Expand hop has
run on: `GraphExplorer` reads `expandedIds` off the discovery lists, the same
way the Expand buttons read their ✓; v8.18.0; `model.nodeFill`), the
outline (black, or a 2px orange `SURVEY_COLOR` ring for a survey while the
Surveys chip is on, so its fill still says reference or citation), the ring/glow vocabulary, zoom-gated labels, edge
colors/widths/arrows, and the enlarged pointer areas. One component
(`GraphCanvas.tsx`), nested here per the hybrid structure rule: its only
parent is `graph/GraphExplorer.tsx`.

## Purely presentational, by design

`GraphCanvas` owns NO state — the live node/link objects, the `fgRef`, and
every piece of interaction state (focus, pins, selection, highlights) live
in `GraphExplorer` and arrive as props; every interaction fires a callback
upward. That's the Phase 6 state directive in its oldest corner: the canvas
paints, the shell decides.

## The ring vocabulary

Every disc has a **thin black outline** (`--node-outline` via
`useCanvasInk`, 1px on screen at any zoom; faded on a dimmed disc), so papers
read as separate shapes (v8.16.0). It is black in both themes: a light-only
version was tried and Patrick preferred it on dark too. The colour stays a
theme variable so either theme can change it. The rings below stroke the same
arc on top of it.

- **Gold glow + gold ring** — the teacher is talking about this paper
  (`highlightIds`).
- **Cyan ring** — in the teacher's scope (`selectedIds`: the alt-drag
  marquee / shift-click selection, or the papers a message asked for, which
  `send` makes the selection). While a scope is active, everything
  outside it **dims** like a focus set, so the scoped cluster stands out,
  **unless a focus is held** (the paper open in the detail panel, since
  v8.21.0; a ⌘-click from v8.18.0's polish): then the
  focus owns the dimming and the selection shows as rings alone
  (`selectionDims`), so a reader can pick papers out of a focused
  neighbourhood without the rest of it going dark. Dimming means one thing
  at a time. The ring is cyan to stay distinct from the gold, pale-white, and bright-white
  rings it can coexist with.
- **Dotted outer ring** — a scoped paper the view filters would hide, drawn
  anyway (`ghostIds`, always a subset of `selectedIds`; v7.24.0). The scope
  outranks the filters, and this is what keeps "the filters are a lens"
  honest: the reader can see which papers the lens would have dropped. The
  legend names it *"In scope, hidden by your filters"* while any is drawn.
- **No expansion halo** (retired with the survey ring): a faint hairline once
  marked a paper added by expanding (`node.discovered`), and it crowded the
  orange survey ring. Nothing was lost: an expansion's papers sit with the pink
  paper they came from (Force) or in its band (Timeline). It was a bold
  dashed ring until v8.18.0, before that.
- **Survey ring** — while the Surveys chip is on (`surveyRings`), a survey's
  outline is orange (`SURVEY_COLOR`, 2px on screen) in place of the black
  one, so its fill still says reference or citation.
- **Pale ring** — user-pinned.
- **Bright ring** — the open detail-panel node (`selectedId`).

Labels are zoom-gated: seed / detail-selected / highlighted / hand-picked
always; everyone else past 1.6× zoom, truncated at 42 chars, run through
`latexToUnicode` (canvas `fillText` can't render KaTeX). Influential citations
draw heavier (1.6 vs 0.6); `similar` edges get no arrowhead — they aren't
citations, mirroring the backend's `influential=null` semantics.

**Arrowheads point from the citing paper to the one it cites** (every edge's
`source` is the citing end, seed edges and links between papers alike), and
since v8.22.0 they can actually be seen. Until then every one was hidden:
the canvas draws its own discs (`nodeCanvasObject`) and never told the
engine their size, so the engine took each node for radius 1 and ended the
arrow 1 unit from the target's centre, under a disc 3–18 units across.
`nodeVal` now returns the drawn radius squared (the engine's radius is
`sqrt(nodeVal) * nodeRelSize`), so each head lands on the disc's edge. The
heads are 4.5 units on a seed edge and 3 on a link between papers, in
`ARROW_COLOR`: the relation colours at 0.8 against the line's 0.30, so the
direction reads where a translucent head blurred into the web.

**Edge colours are seen from the paper in focus** (v8.22.0, Patrick). An
edge touching it draws **blue when that paper cites the other end** (the
other end is its reference) and **green when the other end cites it** (a
citer): `model.edgeTypeFrom`, by which end of `_s` → `_t` the paper sits on.
The paper is `anchorId` (`model.focusAnchor`): the open paper, or the lit
paper hovered inside its focus, else the hovered one; with none, or under a
find, it's the seed, which is how the seed's own edges have always read.
An edge not touching it keeps its own build-time type. Before v8.22.0 every
edge had one fixed colour, so a focused citer's edge to an older paper drew
green, the citer's colour, where the reader saw that older paper as the
citer's reference. Arrowheads take the same colour, a step bolder.

**Under a focused paper only its own edges stay lit** (`model.edgeLit`,
v8.22.0): every other line and arrowhead dims, those between two of its
neighbours and those running out of the neighbourhood alike. Until then an
edge stayed lit while either end was lit, so every lit neighbour kept all of
its edges and the relations being read drowned in the rest. Under a find or
the teacher's highlights, which centre on no one paper, that older rule
still holds.

**A dimmed paper keeps a trace of its own colour** (`theme.dimColor`,
v8.22.0, Patrick): its relation's fill (or the expanded pink) at
`DIM_ALPHA` 0.22, where it was a flat grey (`DIM_NODE`) until then. Behind a
focused neighbourhood, references still read faintly blue and citers
faintly green, so the background keeps saying who's who.

## Links between papers: just finer edges (v8.18.0)

The "Links between papers" arrive in `data.links` like any edge, flagged
`_between`, and draw in the relation colours (`EDGE_COLOR`) with the usual
arrows and dimming. Seen from the seed they take the citing paper's relation
(`model.betweenLinkType`); seen from a focused paper they follow the
perspective rule above, like every edge. The one difference is width: 0.35 against a seed edge's
0.6, because there can be hundreds and they are the web, not the story. They
were painted separately (dashed violet, outside the simulation) in the
first cut; see `../hooks/README.md`'s `usePaperLinks` for why that went.

## The one rule: never copy `data`

The nodes handed in are the live objects the simulation mutates
(`x`/`y`/`fx`/`fy` — see the identity contract in `../README.md`), so
nothing here may copy or recreate them. Relatedly, the lib's generic prop
typings fight our accessor signatures, so the component renders through an
untyped `ForceGraph2D` alias (kept, with its comment and lint suppression).

## Who uses it

`graph/GraphExplorer.tsx` only — it supplies the filtered `view` as `data`,
the sets/ids, and the handlers (`onNodeClick` select-vs-reseed,
`onNodeDragEnd` pinning, `onEngineStop` timeline y-freeze + one-shot
zoomToFit, `onRenderFramePre` the timeline year axis painter).

## How it's verified

`tsc --noEmit` strict + oxlint; the painting itself (rings, labels,
dimming) is exactly what the end-of-phase browser milestone eyeballs.

## Labels: why the always-on exemptions are size-capped

A node wears its title when it is the seed, the detail selection, part of a
*small* pick or highlight, or the canvas is zoomed past `LABEL_ZOOM` (1.6).

The pick/highlight exemptions exist so a deliberate selection of a few papers
stays identifiable while zoomed out — you alt-dragged three papers and want to
see which. They were unconditional until v7.17.0, and a marquee over a hundred
nodes then drew a hundred labels at every zoom level: a solid block of
overlapping white text covering the graph, including the very papers it was
meant to name. `LABEL_ALL_MAX` (12) caps both, so a large selection falls back
to the zoom gate like any other node.

The highlight half of that cap matters more than it used to: a lecture beat now
lights **every** paper it discusses, not just the handful the model listed, so a
single beat can legitimately light a dozen or more.
