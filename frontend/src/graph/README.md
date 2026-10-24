# `src/graph`

The graph explorer's engine room: the composition root, the view-model
types, the visual constants, and three nested sub-packages — the canvas,
the DOM chrome, and the simulation hooks — each with its own README.

```
graph/
  GraphExplorer.tsx — the composition root of the graph area (see below)
  model.ts          — view-model types (VNode/VLink/Base) + pure helpers
  theme.ts          — the relation color scheme + layout geometry constants
  buildShape.ts     — the user's graph-sizing preference (adaptive on/off + the
                      band shape), a localStorage-backed module store
  clusterForce.ts   — the Force layout's clustering (custom d3 force over one
                      plan, `layoutPlan`, a home per node: sector anchors
                      around the seed, √population orbits, expansion groups
                      out past the formation with their references west and
                      citers east, bridges between a group and the
                      formation, connected mode; wired by hooks/useTimeline's
                      applyLayoutPhysics)
  streamForce.ts    — Timeline's parallel streams: each expansion group in a
                      band of its own above the seed's timeline (y only)
  expansions.ts     — which of a paper's Expand hops have run (read off the
                      saved discovery lists, so the ✓ survives a reload) and
                      what undoing one takes away (pure)
  graph.css         — styles for the whole graph area (ported light-touch)
  canvas/           ← sub-package: the ForceGraph2D wrapper, every canvas painter
  controls/         ← sub-package: the declutter panel + the color legend
  hooks/            ← sub-package: useDiscovery / useMarquee / usePinning / useTimeline
```

All three sub-packages are single-parent clusters under `GraphExplorer` —
the hybrid structure rule's nesting case. Their components are purely
presentational: every set, id, and count arrives as a prop, and every
interaction fires a callback upward. The canvas paints, the shell decides.

(`model.ts`/`theme.ts` stay at the root: the sub-packages AND outside
consumers — `teacher/transcript` uses `formatPubDate`, `Teacher` uses `ID_RE`,
`detail/` uses both — all import them. `graph.css` also stays at the root:
it styles the whole area, and both `controls/` components import it.)

## `GraphExplorer` — where the mutable world lives

The graph area's composition root (canvas + controls + legend + the detail
panel), moved here from the old shell because it's a graph concern. It owns
everything sim-side and canvas-local: the `base` dataset (derived from the
store's raw `GraphResponse`), declutter filters, hover, selection wiring,
canvas size, and the filtered `view`. From the store it reads the graph,
the discovery arrays (fed into `useDiscovery`'s in-place merge — the hook
dedupes, so re-feeding full arrays is safe), the layout, and the highlight
ids. The shell passes its overlays (hit list, loading/error/hint) as
`children`, rendered inside the canvas wrap without this component knowing
them. Note the discovery data flow is one-way: teacher → store → explorer
→ `base` — the discovery *lists* live in the workspace slice (grounding,
Save, and the legend read them there); this folder owns only the sim merge.

**Focus** dims everything but one set of papers (`model.focusOf`). In
priority order: an active find, then a **held focus**, then hover, then the
teacher's highlights. The held focus is **the paper open in the detail
panel** (v8.21.0): the click that opens the panel keeps it and everything
linked to it lit until the panel closes (a second click on the paper, ✕, or
Esc, which first clears any selection, highlight or find and lets go on the
press after), and pans the paper to the middle of the view, as the
Knowledge Graph does (no zoom change). The held focus wins over hover in
general: it exists so the pointer can travel to the linked papers, and hover
focus dimmed them the moment the pointer left the paper. **Except over one
of its own lit papers**: pointing at a neighbour shows *that* paper's
neighbourhood until the pointer leaves it, so the reader can explore a step
further out without letting go; hover over a dimmed paper changes nothing.
How it got here: v8.18.0's polish made the focus a double-click for one
round (which cost the double-click re-seed), then a ⌘-click, an extra
modifier to learn (Patrick, v8.21.0: "it doesn't need a cmd-click"). In the
same change the double-click re-seed went too: once a second click closed
the panel, the two fought over one gesture, and "Explore in a thread" in the
panel re-seeded alone. It came back in v8.33.0, sharing the gesture the
Knowledge Graph's way: a click on the open paper waits out the double-click
window before closing (`detail/useSelection`). The find moved above the held focus as well: with a panel
open most of the time, a held focus outranking the find would hide every
find behind it.

**Edges are coloured from the focus's point of view** (v8.22.0): blue where
the focused paper cites, green where it's cited, so the colours always
describe the relation to the paper the light is on (`model.focusAnchor`
picks it with the same priority as the dimming; `model.edgeTypeFrom` colours
the edge). See `canvas/README.md`.

**Switching layout chases the camera** (v8.21.0). The one-shot
`zoomToFit` waits for the sim to settle, a full 300-tick cool-down
(`GraphCanvas`'s `cooldownTicks`, which expansions need), so after a
Force ↔ Timeline switch the camera sat still for about three seconds while
the papers flew to their new places. `setLayoutMode` now starts
`hooks/useCameraChase`: a short fit every `CHASE_STEP_MS` (250 ms, each fit
animated over the same 250 ms so the moves join into one glide) until the
engine stops or `CHASE_MAX_MS` (2.5 s) passes; the settle's own fit then
makes the last correction.

The `view` separates **eligibility from drawing** (v7.24.0). `eligible` is
what the chips, sliders and caps admit, and it is what gets published as
`visibleNodeIds` — the default scope. On top of it the canvas also draws
every *scoped* paper the filters would hide (`ghosts`: a selected paper after
a slider change, "the references" with the references chip off), because the
scope outranks the filters (`scope/README.md`) and the reader should see
what the agent is reasoning over. A ghost keeps its edges even when their
chip is off, or it would float unattached, and wears a dotted outer ring the
legend names *"In scope, hidden by your filters"*. Kept apart on purpose: if
the drawn set were published, a paper shown only because it was asked for
would leak into the default scope of the next, unscoped question. The chips
deliberately stay as the reader set them — the scope overrode the view for
these papers, it did not edit the controls. (v7.23.0 did this with a stored
`revealedNodeIds`; it is derived now.)

**The Surveys chip** (`surveyRings`, off by default, saved with the other
view filters) rings the surveys and reviews orange on the canvas. It **marks,
it never hides**: a survey is drawn whether the chip is on or off, so it isn't
a member of `enabled` (whose chips decide what's drawn), it plays no part in
`nodeOk`, and it never changes the default scope. The legend's survey entry
shows only while a ring is drawn. Which papers are surveys is the backend's
call (`services/graph/README.md`, "Which papers are surveys").

## The core constraint: react-force-graph MUTATES your objects

Everything in this folder is shaped by one fact. The simulation writes
`x`/`y` onto every node object each tick; pins are `fx`/`fy` fields on those
same objects; and RFG even **replaces a link's `source`/`target` ids with
node object references** once the simulation binds them. Three consequences:

- **`VNode` / `VLink` make the mutation typed.** `VNode` is a `GraphNode`
  plus the sim fields; `VLink` carries `_s`/`_t` copies of the raw endpoint
  ids, because after binding, `source`/`target` no longer *are* ids —
  filtering and persistence read `_s`/`_t`. `x`/`y` are optional on `VNode`
  (the sim hasn't run yet on a freshly merged node), so `canvas/`'s paint
  callbacks — which only ever see placed nodes — take **`PositionedVNode`**,
  the one-line `Required<Pick<VNode, 'x' | 'y'>>` narrowing, instead of
  re-stating `& { x: number; y: number }` at each call site.
- **`Base` must keep object identity.** The per-graph dataset (nodes, links,
  year range, per-relation counts, the citation-count ceiling) is built once
  per graph and then only ever *mutated in place* — rebuild it (or `.map()`
  it) and every position and pin evaporates,
  because the state lives ON the objects. Filtered views derive from `Base`
  without cloning its nodes.
- **Changes signal by version, not identity.** `useDiscovery` bumps a
  `graphVersion` counter whenever it appends to `base.nodes`/`links`, so
  React dependents recompute even though `base` is the same object. This is
  deliberate, load-bearing, and the opposite of idiomatic-React immutability
  — the immutable-copy style is exactly what RFG's ownership of the objects
  rules out.

**A state-directive note (Phase 6 rule):** simulation state is inherently
canvas-local *mutable object* state — it must never move into Redux. The
store question applies to app-level state (selection, chat, filters), not
to anything in this folder.

## `model.ts` helpers & `theme.ts`

- `primaryRel`: the one relation that colors a node — seed wins, then
  reference/citation in priority order (`REL_TYPES`), then topic-search
  hits get their own color, falling back to `similar` (which now only appears on
  researcher-discovered papers — the seed-graph *Similar* relation was retired in
  v5.0.0).
- `nodeRadius`: seed fixed-large; others scale with √citations, capped so
  megahits don't swallow the canvas.
- `citationThreshold`: maps a citation-slider knob position to its citation
  count on a log scale spanning the graph's min…max (`log1p`/`expm1` anchor
  the ends), so the filter's travel matches how citation counts actually fan
  out and neither knob idles outside the real range.
- `formatPubDate`: parsed by hand, not `new Date` — date-only strings parse
  as UTC and can render a day off in western timezones.
- `cleanNode`: strips a live node back to persistable fields — sim x/y,
  pins, and the researcher's per-conversation `idx` all deliberately dropped.
- `ID_RE`: the client-side twin of the backend's arXiv-id regex — a pasted
  id/URL jumps straight to a graph, skipping a search round-trip. Deliberate
  duplication; the backend stays authoritative.
- `theme.ts` is the single source of visual truth (node/edge colors, dim
  states, `YEAR_SPACING`, `REL_TYPES` vs `CHIP_TYPES`, filter labels) so the
  canvas painting and the DOM
  chrome can never disagree about what "a reference" looks like. `REL_COLOR`
  drives the graph, chips, and legend; `BADGE_COLOR` drives the detail-panel
  badges, in a lighter green that reads better on the panel's surface.
  `SURVEY_COLOR` (orange) is not a relation colour: it is a survey's outline,
  drawn in place of the black one so the fill still shows the relation.
- `nodeFill`: a disc's fill — the expanded pink, else the relation's colour.
  (`BADGE_LABEL` sat beside it to make a `latest` node show a "citation"
  badge — the one place the two citer pools were already presented as one
  relation, years before v7.17.0 made that true everywhere. It went with the
  relation itself.)
- `foldRetiredNodeRels` / `foldRetiredEdgeTypes`: rewrite relation tags this
  build no longer has, for a graph arriving from a **saved session** rather
  than the backend. Only `latest` → `citation` today. It is not cosmetic: the
  filter chips are keyed by relation, so an unfolded `latest` node belongs to
  no chip and is filtered off the canvas — a saved exploration would come back
  missing its recent papers. `similar` and `search` are deliberately *not*
  folded, because they were removed outright rather than merged, and
  `primaryRel` renders them as `unknown`, which is honest.

## `buildShape.ts` — how much graph the backend ships

A module-level store behind `useSyncExternalStore`, the same pattern as
`ui/theme.ts` and for the same reason: the settings modal writes it,
`GraphControls` reads it to decide whether the count sliders exist, and
`api/graph.ts` reads it *outside React* to put it on the request.

- **`adaptive` is the headline.** ON (the default) the backend sizes the graph
  itself — the STOP/SKIP rules pick the landmark band, the fitted tau rule
  places the Latest cluster start — and the other three fields are inert. OFF,
  the build ships everything up to the payload guard and the user sizes the
  bands (`clusterStart`, `numberOfBands`, `nodesPerBand`).
- **It's browser state, not config.** Every other knob lives in `config.json`;
  this one belongs to the person exploring and changes between one build and
  the next, so it rides along as query parameters. The v6.0.0 purge deleted the
  old file toggles deliberately and this doesn't bring them back.
- **It's not a Redux slice either.** `workspace.provider` is the closest
  analogue, but that's part of a *saved session* — reopening a saved graph
  should rebuild it the way *you* currently size graphs, not the way whoever
  saved it did. localStorage, like the theme, is the honest home.
- **`shapeParams` sends nothing while adaptive**, so the common request URL is
  exactly what it was before shapes existed. `sameBuild` likewise treats any
  two adaptive shapes as equal — that's what stops Curious Astronaut rebuilding the graph
  on modal close when nothing that matters changed.

## The per-chip count sliders

With adaptive OFF, each relation chip in `GraphControls` grows a count slider,
and `GraphExplorer` trims the view by it. Worth knowing:

- **They're a display trim, not a rebuild.** Widening one back costs nothing —
  the papers were already shipped. Only the *build shape* triggers a refetch:
  the `adaptive` switch immediately, the band-shape numbers on modal close.
- **The chip is the slider's label.** With automatic sizing off, `GraphControls`
  drops the wrapping pill row and instead renders each relation as its filter
  chip sitting atop its own count slider (`rel-cap-group`). The chip is the same
  toggle it always was — click to hide/show the relation, highlighted while on —
  it just now heads a slider. A slider appears only under a chip that's on and
  holds more than one paper; an off or single-paper relation shows the chip
  alone. The whole block keeps `data-tour="relations"`, and the tour's "How many
  of each" step gates on a `.rel-cap-slider` existing.
- **Ranking is computed over `base`, not the filtered view**, so dragging the
  year slider doesn't silently renumber what "top 20 landmarks" means.
- **A node survives if it ranks inside the cap of at least one of its enabled
  relations** — mirroring the reachability rule, so a paper that's both a top
  reference and a mid-ranked landmark keeps the slot its best relation earns.
- **A full-span slider deletes the cap** rather than storing the total, so a
  later discovery widening the relation isn't clipped to yesterday's count.

## Who uses it, and how/why

- **`App.tsx`** (the shell) — renders `GraphExplorer` and passes its
  overlays as children; uses `ID_RE` for the pasted-id fast path.
- **`detail/`** — `useSelection` types against `Base`/`VNode`;
  `DetailPanel` uses `formatPubDate` + `BADGE_COLOR`.
- **`teacher/Teacher`** — `ID_RE`, for the chat bar's pasted-id fast path
  (v7.6.0: it moved with the search box).
- **`store/workspace`** — `cleanNode`/`countRels` for session save/restore.

## How it's verified

`tsc --noEmit` strict + oxlint (`d3-force-3d` ships no types — its import
keeps a `@ts-expect-error`). The mutation-heavy behavior (pins surviving
filters, discoveries settling near anchors, timeline freezing) is exactly
what the end-of-phase browser milestone exercises by hand. The forces themselves are pure
enough to test one tick at a time: `test/graph/clusterForce.test.ts` (sectors,
expansion groups and their anchors, a group's west/east split, bridges,
connected mode) and
`test/graph/streamForce.test.ts` (streams stacked above the seed's timeline,
fixed heights left alone, the speed cap). `test/graph/expansions.test.ts`
covers reading hops back and undoing one.

## Thread ownership

Each graph belongs to one thread, keyed by provider and resolved seed. Opening
another seed selects or creates its thread. Filter values, selection and layout
are parked with the outgoing workspace and restored on return. The simulation
is still local and rebuilds its positions; mutable force nodes never enter Redux.
Citation inspection can open paper details without changing this graph.

The citation legend and local find share a bottom flex row (`.graph-footer`),
matching the Knowledge Graph’s layout. The legend wraps between entries and
ellipsizes labels that cannot fit; its swatches and the collapsed find button
keep their size. Opening find caps the pill at 65% of the available row and
lets its input shrink, so resizing the browser or opening panels cannot make
the two overlays cover each other. The row passes empty-space pointer events
through to the graph.
