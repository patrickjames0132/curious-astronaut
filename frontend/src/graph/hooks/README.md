# `src/graph/hooks`

The hooks that manage a live force simulation without fighting it.
They cluster here purely to keep `graph/` scannable (the original nesting
precedent the hybrid structure rule cites); all are consumed only by
`graph/GraphExplorer.tsx`. Everything below is shaped by the core
constraint documented in `../README.md`: react-force-graph MUTATES the
node objects, so these hooks mutate in place and signal by version, never
by identity.

```
hooks/
  useCameraChase.ts — the camera follows a layout switch instead of waiting it out
  useDiscovery.ts   — the sim-side discovery merge, in place
  useEscapeClear.ts — Esc = one "unhighlight everything" gesture
  useMarquee.ts     — alt-drag node selection (the teacher's scope)
  usePaperLinks.ts  — the "Links between papers" lookup, re-asked as the graph grows
  usePinning.ts     — user pins (drag / toggle / release), timeline-aware
  useTimeline.ts    — BOTH layouts' physics (the one owner of the d3 force
                      slots): Timeline's year pinning/collide/axis painting
                      and expansion streams (../streamForce.ts), and Force's
                      clustering (../clusterForce.ts), connected or not
```

## `useDiscovery` — the graph grows mid-conversation

Merges the papers a workflow pulls in (the researcher's expand/search
tools) into the live graph:

- **In-place append** with id/edge-key dedupe (an edge key is
  `source|target|type`) — the store re-feeds full discovery arrays, and the
  dedupe makes that safe.
- **Anchored spawning:** a new paper starts near the paper it was
  discovered from, so it doesn't fly in from the canvas origin when the sim
  reheats; ungrounded topic-search hits (no edge) anchor on the seed with a
  wider scatter so they settle into a loose cluster instead of stacking.
- **Year-range widening:** a discovery older/newer than anything visible
  widens both the base range and the active year filter — a discovered
  paper must never arrive invisible.
- **Reheat without camera yank:** `d3ReheatSimulation`, never `zoomToFit` —
  the user may be reading the chat, not watching the graph.
- **Changes signal by version:** the hook bumps a `graphVersion` counter
  whenever it appends to `base.nodes`/`links`, so React dependents recompute
  even though `base` is the same object. Deliberate, load-bearing, and the
  opposite of idiomatic-React immutability — RFG's ownership of the objects
  rules the immutable-copy style out.
- **Prune, the other way round (v8.18.0):** `onPrune(keepNodeIds,
  keepLinkKeys)` splices out, in place, whatever the store's lists no longer
  hold: what undoing an Expand hop took away. It decrements the counts, drops
  an `_origin` whose paper went, bumps `graphVersion` and reheats.
  `GraphExplorer` runs it before every merge, over the graph's own papers
  and edges plus the discovery lists.
- `discoveredNodes` mirrors what was merged, kept separately so follow-up
  questions can extend the researcher's grounding without rebuilding
  `base`; on a restored session it's re-collected from the saved nodes'
  `discovered` flags.

**The reader's Expand buttons use the same merge (v8.18.0).** The detail
panel's Expand row calls `/api/graph/expand`, and `GraphExplorer` dispatches
what comes back as `discoveryMerged`, just as a researcher discovery would.
So an expanded paper is drawn, anchored, saved with the thread, and in the
assistant's scope like any other, and it wears the same faint halo. The
legend now says *"Added by expanding"*, since the reader expands too.

## `usePaperLinks` — the citations among the papers on screen

Owns the interconnected links' data (v8.18.0). While the links are
wanted, it posts every node id to `/api/graph/links`, and it **asks again
whenever `graphVersion` bumps**: an expansion or a discovery may have
brought in papers that cite each other. The server caches each paper's
reference list, so a re-ask costs only the new papers. It drops any pair the
graph already draws as an edge, either way round, so no line is painted
twice. Its `status` (`off` / `loading` / `ready` / `error`) feeds the
button, and `attempt` (bumped by the button after a failure) re-asks.
**The button stays busy until the graph has settled** (`GraphExplorer`'s
`linksSettling`, cleared on the engine's stop): any change to the drawn
links, shown, hidden or refreshed after an expansion, reheats the graph, and
a switch that flipped at once while nothing seemed to happen, then made
everything appear in one go, felt broken (Patrick).

The links never enter `base.links`, so they are never saved and the
relation chips never count them. `GraphExplorer` adds them to the *view* as
`_between` links whenever both papers are drawn, so they are real links in
the simulation and shape the layout the way Connected Papers' do. Each one is
coloured by the citing paper's relation (`model.ts`'s `betweenLinkType`): a
citer's citations draw green, a reference's blue. Hovering a paper lights
the papers it is linked to.

*(The first cut, before Patrick's browser pass, painted them as dashed
violet lines that never touched the layout. It read as a hairball laid over
the old clusters, not as a map of how the papers connect.)*

## `useMarquee` — hand-pick the teacher's scope

Since v8.17.0 the gesture itself is `ui/useBoxSelect`, shared with the
knowledge graph (which picks concepts to check off with it); `useMarquee`
supplies the hit test over the visible view and the store dispatches. The
design below is the gesture's, wherever it is used.

A **modifier-drag, not a mode**: hold **Alt** and drag a rectangle to pick the
nodes the AI teacher grounds in (its lectures and Q&A). The design choices that
make it coexist with the sim's own drag-to-pan:

- **Arms only while Alt is held.** A window `keydown`/`keyup` (plus a `blur`
  reset, so an alt-tab that swallows the keyup can't leave it stuck) flips an
  `armed` flag; GraphExplorer renders a transparent overlay whose
  `pointer-events` go live only then. Plain drag still reaches ForceGraph2D and
  pans — no interaction is stolen.
- **The overlay captures the drag, so RFG never sees it.** The mousedown lands
  on the arm overlay (above the canvas, below the controls in z-order), and the
  move/up run on `window` so the gesture completes even if Alt is released
  mid-drag.
- **Hit-testing is in screen space.** `fgRef.graph2ScreenCoords` maps each
  *visible* node's sim position to canvas-local pixels, compared against the
  rectangle (measured off the wrap's bounding box — the canvas fills the wrap,
  so their origins coincide). Only what's on screen is eligible, matching the
  `selected ∩ visible` grounding rule.
- **The marquee is additive.** Each alt-drag **unions** the enclosed nodes onto
  the pick, so several sweeps build one scope; a negligible drag (below a few
  pixels) is an alt-click on empty space that **clears** it, as do the
  controls' clear link and **Esc** (both of which also drop the teacher's
  highlight — see `useEscapeClear` below). We deliberately **don't** use Alt+Shift for a
  "replace vs. add" split — that combo is the OS keyboard-layout switch on
  Windows, which steals the modifier and the window focus mid-drag. Single-node
  **shift-click** add/remove lives in GraphExplorer's click handler, not here.

The selected ids live in the **workspace slice** (`selectedNodeIds`) — the one
piece of this hook's state that's genuinely cross-cutting, since
`scope/resolve.ts` reads it to scope the teacher (the selection is the
middle rung of its priority list, above the filters). The rectangle and the
`armed` flag stay local (only the canvas paints them).

## `useCameraChase` — the camera follows a layout switch

Switching Force ↔ Timeline reheats the sim, and the explorer's one-shot
`zoomToFit` waits for it to settle: a full 300-tick cool-down
(`canvas/GraphCanvas`'s `cooldownTicks`, which expansion groups need to get
all the way out), so the camera sat still for about three seconds while the
papers flew to their new places (Patrick, v8.21.0). Shortening the cool-down
would have frozen those groups mid-flight again, so the physics are left
alone and **the camera chases instead**: `start` (from `setLayoutMode`)
fits every `CHASE_STEP_MS` (250 ms), each fit animated over the same 250 ms
so the moves join into one glide, until `stop` (the engine-stop handler) or
`CHASE_MAX_MS` (2.5 s). The settle's own fit then makes the last
correction. An unmount stops a chase still running.

## `useEscapeClear` — one key drops every highlight

Highlights arrive from four owners (the teacher's beat/answer/ref glow in the
highlight slice, the hand-picked scope in the workspace slice, and their two
panel-side echoes), and each historically cleared only its own way. Esc now
runs GraphExplorer's `onClearAll` — `nodeSelectionCleared()` +
`highlightSet([])` — and the teacher panel's active beat/answer/ref marks
follow the emptied highlight on their own (`useConversation` watches the
global set, which also un-sticks the marks after a graph reload). The hook
itself is deliberately dumb: a window keydown listener that skips form
controls (Esc in the search box means "leave the box" — the Tour's
precedent); GraphExplorer additionally skips it while the lightbox or tour
own the key, since both bind their own Esc-to-close.

**Esc goes in two steps** (v8.22.0, Patrick): while anything is lit (a
selection, the teacher's highlight, a find) a press runs `onClearAll`, and
once nothing is, the next press closes the open paper's panel and lets go of
its focus. In v8.21.0 `onClearAll` closed the panel too, so clearing a
selection also lost the paper it had been picked around; it is back to
clearing light only, which is also all the controls' Clear button does.

## `usePinning` + `useTimeline` — two layouts, one pin vocabulary

Pins are just `fx`/`fy`, but their *semantics* are layout-aware:

- **Force mode:** drag pins where dropped; unpin frees the node entirely.
- **Group drag (v8.18.0's polish):** dragging a paper in the hand-picked
  selection (the cyan rings) carries the rest of it along: `onNodeDrag`
  moves each other selected paper by the step's offset and holds it there,
  and `onNodeDragEnd` pins every one of them where it lands. In Timeline
  only their heights move, and the drop re-pins their date columns.
  Dragging an unselected paper moves just that paper. A selection is the
  set the reader acts on, the way selected shapes move together in a slide
  editor; asking the assistant about it is one action and moving it another.
  **Only the selection moves:** a selected paper outside a held focus is
  dimmed and its ring hidden, so it stays behind (`visibleIds`, a ref, since
  the focus is worked out after the pins it depends on); and every other
  paper is held still (pinned at its position) for the drag **and on until
  the layout settles after the drop**, when `releaseHeld` (the explorer's
  engine stop) gives back its own pins. The first cut did neither, and the
  links, the links between papers above all, towed every paper linked to
  the selection along behind it. Until v8.22.0 the pins went back on the
  drop itself, and since a drag leaves the sim hot, the links still towed
  the bystanders, dimmed ones and all, after the group (Patrick had to pin
  them back out of the way). Released once the sim has stopped, they stay
  put. A drag before that first gives back what the last one held; a paper
  dropped on its own meanwhile keeps its new pin.
- **Timeline mode:** a node's x is ALWAYS its date column — dragging only
  sets height, unpinning restores the column pin, and `releaseAll` keeps
  the date structure. `nodeTimelineX` maps year + month fraction to x, so
  papers sit *between* year gridlines by publication month (an unknown
  month means the year's own gridline; there's no day-level precision
  anywhere in this system, only year+month).
- **Undated papers are not on the Timeline at all** (v5.5.0). They used to
  sit at the **seed's own exact x**, reasoning that S2 not knowing a date
  isn't evidence a paper is old, and a citer tends to be contemporaneous
  with its seed anyway. That reasoning holds, but the rendering didn't:
  every undated paper landed on that one x, so they drew as a vertical bar
  skewered through the seed (visible on QMIX, ~12 of them). Placing a paper
  on a time axis *is* a claim about when it came out, and an undated paper
  gives us none to make — so **`GraphExplorer`'s `nodeOk` filters them out
  of the Timeline view**, while Force (where x carries no date meaning)
  still shows them. Only an undated *seed* survives the filter, since the
  seed always renders; it anchors at the earliest year. The backend also
  stopped shipping undated *citers* among the most-cited pool (a landmark is
  "top-cited citer of year Y" — a claim an undated paper can't make; see
  `services/graph/budget.py`), so in practice little reaches this filter.
- **Timeline physics:** pin every x, add a radius-sized collide force so a
  year column spreads out instead of clumping; `freezeSettledY` freezes
  heights once the sim settles so dragging one node can't re-relax the
  rest. The axis painter draws year gridlines/labels in graph coordinates,
  thinning labels when zoom would crowd them (≥28px apart on screen).
- **Force physics (v5.23.0):** the neighborhood clusters by relation —
  `applyLayoutPhysics`'s force branch registers `../clusterForce.ts`
  (sector anchors around the seed's live position, orbits growing with
  √population), a radius collide for in-cluster spacing, and stretches
  each link to its relation cluster's orbit at low strength (the default
  distance-30/leaf-strength-1 link force yanked every neighbor into one
  clump — most of the old clutter). The default link accessors are
  captured once and restored on the switch to Timeline, and the cluster
  force is removed there (sector pulls would fight the year columns).
  `useTimeline` is deliberately the ONE owner of the 'collide'/'link'/
  'cluster'/'stream' force slots — a second hook writing them would fight
  it on every layout switch. A new graph re-applies whichever layout is
  active (one shared effect); discoveries re-balance the orbits for free via
  the force's own `initialize`, and the link accessors recompute their
  groups and degrees at each link initialization (d3 asks for link 0 first).
- **Connected Force (v8.18.0):** while the interconnected-links button is
  on, `clusterForce(true)` drops the sectors and holds the seed at the
  centre (unless the user pinned it), and the links between papers do the
  clustering, with d3's own degree-scaled strength so a hub doesn't collapse
  its neighbourhood. The seed's own edges go soft (0.05) at
  `connectedRadius`, so the papers form a loose shell the links pull into
  filaments, the burst around the seed Patrick asked for. **The spacing is
  measured, not eyeballed** (Atari's 290 papers and 281 links, simulated
  offline): the gap between linked papers tracks the collision margin,
  about twice it, so the first cut's margin of 4 packed them 8 units apart
  (median) against 44 for unlinked papers, a knot. A margin of 20
  (`CONNECTED_COLLIDE_MARGIN`), links resting 80 past both papers' radii
  (`BETWEEN_LINK_GAP`) and a charge of -60 open that to 40 against 54,
  while linked papers still sit about a third as far apart as random pairs
  and the graph grows ~10%. **Lone papers** (no link between papers reaches
  them) have nothing to place them but their seed edge, and 194 of them on
  Atari rang the whole graph. Each relation's lone papers now share a home
  (`clusterForce`'s `layoutPlan`: citers east, references west, out past the
  core by √count), pulled firmer (0.28), with a charge of -15 and a margin
  of 8 (`LONE_CHARGE`, `LONE_COLLIDE_MARGIN`): at the linked papers' -60
  and 20 the cluster repelled itself into a ring again; at these it holds a
  wedge about ±30° wide (measured the same way). Who is lone depends on the
  links, which reach the sim after its nodes, so the cluster force plans on
  its first tick, and the link force's refresh re-sizes the collide and the
  charge once the plan knows. The button re-registers the forces through
  `configureForces` alone, never `applyLayoutPhysics`, so showing or hiding keeps
  every pin. **Force only:** in Timeline the switch isn't offered and no
  links are fetched or drawn (`GraphExplorer`'s `linksActive`); x is the
  date there, so there's no room to pull linked papers together without
  breaking the time series. The links keep their setting for the trip back.
- **Expansion groups (v8.18.0; satellites since v5.24.0):** a discovery
  anchored on a non-seed node gets `_origin` stamped by `useDiscovery`'s
  merge. `clusterForce.expansionGroups` gathers each origin and its
  satellites into a group. In **Force**, the group, **the expanded paper
  included**, leaves the formation for an anchor of its own
  (`groupAnchors`): past the formation's outer edge, on its origin's side,
  angled off the relation axis so it never lands on a sector, a second
  group on the same side at the next heading. Inside the group the layout
  repeats the seed's at a smaller scale: the expanded paper at the anchor,
  its references to the west, its citers to the east
  (`groupSideRadius`). A paper the expansion only linked to, already on the
  graph, is no member but a **bridge** (`bridgesOf`): it leaves its sector
  for the midpoint between its sector and the group (the centroid, when it
  links to several groups), so the papers the two neighbourhoods share sit
  visibly between them. All of it is one plan, `layoutPlan`, a home per node
  as an offset from the seed; the cluster force pulls to the homes, and the
  link force measures every link that touches a group or a bridge as the
  distance between its two homes (at least 40), so the links never fight the
  clusters. (Holding the seed at the centre with the sectors on was tried
  and reverted: the seed has to slide out of its citers to the apex of their
  cone, and held, they set into a ring all the way round it.) After an expansion
  the reader asked for (the detail panel's buttons, not the researcher's),
  the camera refits once the sim settles. In **Timeline**, `../streamForce.ts` gives each
  group a band of its own **above** the seed's timeline, stacked upward in
  the order the groups formed, so an expansion reads as a parallel stream.
  The merge starts new papers at their paper's height (they glide up into
  the stream; until v8.18.0 they appeared above everything at once). A
  group forming, or an Expand hop undone (`onPrune`), **thaws the whole
  timeline** (`thawTimeline`): Timeline freezes every height once the sim
  stops (`freezeSettledY`), and only the expanded paper used to be released,
  so a new group wedged into the frozen seed's stream on its way up and an
  undone paper stayed where its group had been. Everything but the reader's
  own pins re-settles, as the Release button does. And in Timeline **no link
  pulls across streams**: one from a group to the seed's stream dragged the
  papers the expansion shared with the seed halfway up, a third row, and
  tugged the expanded paper down; each stream holds its own. **Every move is a glide:** the cluster force caps each node's
  speed after the other forces have pushed (`capSpeed`: at most `GLIDE`,
  4%, of the distance left to its home a tick, never below `MAX_SPEED`, 12),
  and the stream force caps its vertical pull the same way, so every trip
  is an ease-out of about two seconds. A flat cap of 12 was tried first: it
  glided, but stranded a Timeline → Force switch, whose papers start
  thousands of units out along the year axis, with the references still
  strung out in a line when the sim cooled.
  Until v8.18.0 the satellites gathered just beyond an origin that stayed in
  its sector (Force) or banded outward from its side of the mass
  (Timeline), which read as a clump stuck to the formation. `_origin` is
  sim-side only — `cleanNode` never persists it, and a restored session
  (whose discoveries arrive folded into the graph, not through this merge)
  re-derives it in `GraphExplorer`'s base build via
  `clusterForce.deriveOrigins`: same rule, the first edge's other endpoint
  when it isn't the seed.

## How it's verified

`tsc --noEmit` strict + oxlint. `test/graph/hooks/useCameraChase.test.tsx`
covers the chase: a fit every step from the start, a restart, `stop`, the
time cap, and unmount. `test/graph/hooks/usePaperLinks.test.tsx`
covers the links hook: no request while off, a re-ask on a version bump,
already-drawn pairs dropped, and the error status. The mutation-heavy behavior (pins surviving
filters, discoveries settling near anchors, timeline freezing) is exactly
what the end-of-phase browser milestone exercises by hand.
