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
                          (the find bar, bottom-right, is ../graph/controls/FindBar)
  KnowledgePanel.tsx    — the side panel: why it's needed, what it needs, the lesson
  SelectionMenu.tsx     — Explain · Expand over a passage highlighted in a lesson (v8.25.0)
  useLessonSelection.ts — reads that selection and places the menu
  look.ts               — shared by both views: colours, sizes, labels, stable data, clicks
  useLessons.ts         — lesson streaming that outlives the tool's mount
  model.ts              — the graph and the pure rules over it (no React, no store)
  assistant/            — the course assistant, docked beside the course (v8.25.0)
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

## Syntheses: combining concepts (v8.23.0)

Patrick's picture was a pyramid: the paper on top, foundations at the
bottom, and between them a layer that **puts the knowledge together**. A
**synthesis** is that layer, one group at a time: several concepts brought
together toward the item they build toward, with a lesson on how they
combine. The design was parked in the OnePager on 2026-10-13 and settled on
2026-10-14. The code uses the reader's word throughout (`kind:
'synthesis'`, `synthesis:` ids, `/api/knowledge/synthesis`,
`withSynthesis` …). It was Patrick's pick at the first browser round over
"big picture", "keystone" and "connection" ("bridge" was out: the OnePager
has a "Bridge two topics" phase).

- **Made by choice, then part of the plan.** A synthesis is **not an
  edge**: it holds its `members` and its `toward` target, and
  `synthesisLinks` draws its lines (to each member, and from the target), so
  `tutorPath` and the breakdowns never see it. But once made it **is a
  lesson in the plan** (Patrick, at the last round: Next lesson should land
  on them): `courseOrder` teaches it after everything it combines and just
  before the item it builds toward, an inner synthesis before one holding
  it, and it counts in `progress`; one building toward a known item is
  pruned with what that item needs. Until then syntheses stayed out of the
  order entirely (Patrick: "we are way too strict about the teaching order
  here … it's not required or anything"), which left Next lesson walking
  past them. It can't be broken down; its panel's kicker says "Synthesis"
  (it said "· optional" too for one round, which Patrick dropped). **It
  checks off like a concept** (Patrick, the second round): the panel's
  Known button and "✓ I know these" both reach it, it turns green, the
  kicker animates to "Known Synthesis" as it does to "Known Concept", and
  the course skips it.
- **Overlap is fine.** A concept can be in several syntheses, the way a
  shared prerequisite already has several edges in. Calculus under both
  supervised learning and deep learning is a shared prerequisite, not a
  cycle; it was only the stacked-boxes picture that had to draw it twice.
- **Made by the reader** (this release): select two or more concepts
  (shift-click, alt-drag) and **◆ Synthesize** on the selection bar.
  The target is `synthesisTarget`, the deepest item that needs every member,
  directly or not (concepts meeting under Q-learning build toward
  Q-learning, not the paper). The tutor names the group
  (`POST /api/knowledge/synthesis`), the synthesis is added (`knowledgeSynthesized`,
  `withSynthesis`) and opens, and its lesson streams from
  `POST /api/knowledge/synthesis/lesson` (`useLessons`). Synthesizing the same concepts
  again opens the one already made (`findSynthesis`).
- **Syntheses build on each other** (Patrick, at the first browser round): a
  member can be a concept or another synthesis, never the paper (`synthesizable`),
  so the middle layer can stack the way the pyramid's does. A synthesis among
  the members counts as the concepts underneath it for the target
  (`conceptsOf`), and `withSynthesis` drops any member that already holds the
  new synthesis, so none ever contains itself (only reusing a name could try).
- **No redundant groups** (Patrick): a pick already inside another pick,
  however deep (a synthesis with one of its own concepts, or with a
  synthesis it holds), or one another pick already builds on through the
  course's own "needs" edges (stochastic gradient descent with the sample
  averages it needs, the browser case that showed the first rule was too
  narrow; for a synthesis, through the concepts underneath it), says
  nothing new and muddles the tutor's brief. `redundancy` finds such a pair
  (`how`: `includes` or `needs`); **◆ Synthesize** is then disabled, its
  tooltip saying "already includes" or "already builds on", and
  `withSynthesis` drops the inner one anyway. A concept two picks merely share
  doesn't count: overlapping syntheses can still be synthesized.
- **Deletable**, like any item (see "Deleting, and bringing back" below):
  one that held it loses that member, and one left with fewer than two goes
  too, and so on up, since a synthesis of one thing says nothing. No
  confirmation: remaking one is a cached call, so it costs nothing to undo
  by hand.
- **The course keeps a tree** (`hierarchyForce`, `look.ts`, both views).
  Patrick asked for "a more hierarchical tree-like structure", with the
  more abstract syntheses nearer their parent, without waiting for the
  pyramid view. Two pulls on top of the charge and links. **Rings:** each
  item is drawn to the ring at its depth around the paper (`courseDepths`,
  the fewest "needs" steps; `LEVEL_GAP` 70 apart, `LEVEL_STRENGTH` 0.25), so
  what an item needs sits outside it. **Syntheses beside their parent:** a
  synthesis is drawn (`SYNTHESIS_STRENGTH` 0.3) to a spot just outside the
  item it builds toward, on its members' side, `SYNTHESIS_REACH` (0.6)
  level gaps out divided by its height (`synthesisHeight`: 1 for plain
  concepts, one more per level of synthesis inside), so the more abstract,
  the nearer its parent, be that the paper, a concept or a synthesis. The
  spot alone was too soft: the charge of the items around a synthesis
  pushed it about two ring gaps out (Patrick: "the diamond isn't close to
  the parent"). So its line to its parent is also a short, full-strength
  spring of that same length (`useHierarchyForce` sets every link's length
  and pull). The spring holds the distance and the spot picks the side. Its
  lines to its members pull at `MEMBER_LINK_STRENGTH` 0.03, so they don't drag
  it back out among them; every other link keeps d3's own strength at
  `LINK_DISTANCE` 48. In a headless run of a three-level course, the gap
  between a synthesis and its parent went from 92 to 53 against a 42
  target. **A 2D node never gets a z** (`useGraphData`): a new item once
  started beside its anchor with one, d3's centring force then averaged z
  over the course and turned every other node's missing z into NaN, and the
  hierarchy force (which reads z in 3D) spread it to x and y. Every synthesis
  blanked the graph down to the paper until a reload; the force now reads z
  only when it's finite (`hasZ`). The first
  cut (a spot 60% of the way from the members to the target) left a
  synthesis of deep concepts far out among them, and nothing ordered the
  concepts at all. The constants are eyeballed layout, not fitted: tune
  them in the browser.
- **The tutor's suggested syntheses** were planned as this feature's second
  half and moved to the Knowledge Graph assistant ticket instead (the
  OnePager, Phase 5's follow-ups): an assistant needs a synthesis-making
  tool anyway, so a separate button would be a second path to one thing.
  The assistant shipped in v8.25.0 without that tool (`assistant/`); it is
  still to come.
- **Its id carries `SYNTHESIS_PREFIX`** (`synthesis:`), so a synthesis named like a concept
  never collides with it, and `courseNames` leaves syntheses out so the tutor
  doesn't reuse their names for concepts. The saved shape stays `version: 3`:
  the new fields are optional, and a course without syntheses is unchanged.
- **The look:** a teal diamond (`KNOWLEDGE_COLOR.synthesis`, a hue nothing else
  uses; green once known) with dashed teal lines in
  2D (`SYNTHESIS_EDGE`), and in 3D a camera-facing ◆ sprite in place of the
  sphere (`nodeThreeObjectExtend` is false for it alone), so it is the same
  diamond from any angle; a legend entry once the course has one.

## Hiding, deleting, and bringing back (v8.23.0, split in v8.26.0)

Patrick: a delete for every node, never the paper, with a breakdown able to
bring a deleted concept back. Since v8.26.0 that undoable delete is called
**Hide** (Patrick; "Remove" for one round), and **Delete permanently** is
the one that forgets: unhiding is all-or-nothing, so without it a junk
concept came back with every unhide. The rule for asking first: **confirm
only what can't be undone** (Delete permanently, Break it down again, both
red in the menu), never Hide, so a confirmation means something when it
appears.

- **What goes** (`withoutItems`, `knowledgeDeleted`): the picked items, then
  every concept the paper no longer reaches by "needs" edges, then each
  synthesis left with fewer than two members or without the item it builds
  toward, until nothing changes. "Its children go too" means *what only it
  needed*: the course is a graph, so a prerequisite another item still needs
  stays. Deleted items leave the known list, and an open one's panel closes.
- **Where**: the panel's ⋮ **Hide** (any item but the paper), and the
  selection bar's **Hide** for several at once (shift-click, alt-drag or
  the find's Enter), with the **Delete**/Backspace key as its shortcut
  outside a text field: a shortcut does the undoable thing. It is disabled
  with only the paper picked, and the paper is skipped otherwise. A note
  where the bar was says how many went ("Hid 2 items and 3 more with
  them") and how to bring them back. No confirmation, since nothing is lost.
- **Delete permanently** (`withForgotten`, `knowledgeForgotten`, v8.26.0):
  the panel's ⋮ only, one item at a time, after a confirmation. It hides
  the item as above, then forgets it: it leaves every remembered
  `breakdown` naming it, on the course and in the archive, and its own
  archived copy goes, which takes the way back for what went with it too.
  A later breakdown that names it again brings it back new, with no lesson.
  A synthesis is never archived, so its removal was already for good: it
  has only **Delete…**, behind the same confirmation.
- **Bringing it back costs nothing, and it comes back as it was.** A
  broken-down item keeps what its breakdown gave (`breakdown`, the tutor's
  `{name, why}` list), so the prerequisites since deleted are known
  (`missingChildren`). While there are any, its **node wears a red count**
  on its top-right, like a notification's on its icon (`hiddenCounts`,
  `badgeText`, "9+" past nine; on the sphere's crown in 3D, since a
  sprite's child sits in world axes and a sideways offset swings behind
  the sphere as the camera orbits), and its ⋮ menu offers **"Unhide
  *n* children"** (v8.26.0; "+ Break it down" with a count badge before), its
  tooltip naming them. That, or a **double-click on the node**, brings them
  back (`withRestored`,
  `knowledgeRestored`) with no call. Deleted concepts wait in the course's
  `archive`, so one that returns, by a restore or by *any* breakdown naming
  it, comes back as it was (`revived`): violet with its lesson if it had one
  (Patrick: an explored one shouldn't come back grey), green if it was
  known, and broken down, linked again to what of its breakdown is still on
  the course, the rest behind its own count. So a deleted subtree comes back
  one level at a time. A course from before v8.23.0 has no `breakdown` yet;
  the first deletion fills it in from the edges still there (`remembered`).
- **"Break it down again"** (`withBreakdownAgain`): a breakdown the reader
  doesn't like gets one fresh try, **a clean slate for its whole branch**
  (Patrick). Everything below the item leaves the course, except what
  something outside the branch still needs (the delete rule), and the new
  breakdown's concepts start new, even ones the tutor names again: not
  revived from the archive, and marked `freshLesson`, so each lesson is
  written past the server's cache when next opened (the item's own at once),
  with its "How it fits in" card. Check-offs survive. Breaking a new concept
  down again uses the server's cached breakdown, so a level the reader liked
  comes back free. The first cut kept the subtree of any concept the new
  breakdown repeated, which left a grey, rewritten parent over violet
  children with lessons written for the old one. That was
  the point of a redo for Patrick, more than new concepts. The tutor isn't
  told to change the concepts: the same breakdown is a fine answer, and a
  redo stays reproducible (one round showed it the previous breakdown and
  asked for a different one; Patrick turned it down). It is the breakdown
  button's third state, once nothing is missing (it was a small link above
  the lesson for one round, which Patrick couldn't find), and since v8.26.0
  it lives in the panel's ⋮ menu with the restore. The request carries `fresh`, so the server
  skips its cached answer and replaces it. The new prerequisites attach
  before the old edges go, so one the new breakdown repeats keeps its lesson,
  check-off and subtree, and whatever only the old one held up leaves. It is
  one call, on purpose. It asks first, in a small
  confirmation dropping from the header's menu (`lesson-confirm`, the settings
  page's danger red): on the **paper** since v8.23.0, since a fresh paper
  breakdown replaces the course's whole top level, and on every item since
  v8.26.0 (Patrick: a concept's redo takes its whole branch with it). The alternative was the settings page's cache clear,
  which wipes every graph, search and lesson to redo one breakdown. **No
  TTL** on breakdowns (Patrick's call): unlike the citation graph's data,
  they don't go stale, and an expiry would only make a restore bill again
  and bring back different concepts.

## The views

- **Click** opens the item's lesson in the side panel and **centres it in
  view** (v8.17.0; so do Next lesson and the panel's links). In 2D that is a
  pan; in 3D the camera slides by the gap between what it looks at and the
  node, keeping its angle and distance, so the node lands in the middle of
  the reader's own view. The request carries a `seq`, so Next lesson or a
  panel link to the open item re-centres it after a pan. **A slower second
  click on the open node closes it** (v8.23.0, Patrick, as on the citation
  graph), letting go of its focus; until then it re-centred the node. To keep
  the double-click breakdown, `useNodeClicks` waits out the 350 ms
  double-click window before closing, so a quick second click still breaks
  the item down. **Double-click**, the
  citation graph's re-seed gesture, breaks it down; so does the panel's
  "+ Break it down" button, in the panel's footer beside "Next lesson ›"
  (v8.17.0; it sat above the lesson before) until the item is broken down,
  then in its ⋮ menu (v8.26.0). A click on empty canvas leaves
  the panel open (v8.23.0, Patrick: it closed the panel until then, which
  lost the lesson to a stray click while panning); ✕ closes it, and so
  does **Esc, in two steps as on the citation graph** (v8.23.0): the first
  press drops a selection or a find, the next closes the panel. It runs
  through the citation graph's `useEscapeClear`, which skips form controls,
  so Esc typed in the find box only clears the box (the window listener it
  replaced also dropped the selection then).
- **Select several to check off at once** (v8.17.0), with the citation
  graph's own gestures: **shift-click** toggles a node, and an **alt-drag**
  box adds every node inside it (`ui/useBoxSelect`, the gesture the citation
  graph's `useMarquee` is built on; an alt-click on empty canvas clears).
  Picked nodes' outlines turn the selection blue. The
  panel's own **Known** toggle sits in its header since v8.26.0 (Patrick:
  the footer's "🤔 Unknown / 💡 Known" button, v8.23.0, said again what the
  kicker says, and a switch in small caps before that): captionless, a
  faded 🤔 that becomes a lit 💡 (`aria-label` "Known" with `aria-pressed`;
  its tooltip states the state, Patrick's words: "Unknown or unfamiliar
  concept; lesson will not be skipped" / "Known or familiar concept; lesson
  will be skipped", the noun following the item's kind). Pressing it pops the bulb in
  with a short glow (`known-bulb`), and taking it back fades the 🤔 in from
  below (`unknown-rise`), each only on the click, not on opening an item,
  and both off under reduced motion. Pressing it
  animates the kicker in CSS alone: "Known" widens to push "Concept" right
  and then rises in, and switching off reverses it (`.kicker-known`). The panel no longer
  lists what an item needs (a "Needs" row of chips until v8.17.0): the
  graph's arrows show that, labelled "Depends on" in the legend. A bar at
  the bottom of the canvas offers **✓ I know these** (`knowledgeKnownSet`),
  or **Not known** when every picked node is already known, and Clear; Esc
  clears too. The selection is component state, never saved: it's a gesture,
  not part of the course. Each view hands the box a `KnowledgeEngine`
  (`engineRef`) that hit-tests its own nodes on screen.
- **The panel scrolls inside itself** (`.knowledge-panel-scroll`, v8.23.0).
  The panel element used to be the scroller, and the resize handle, sized
  and placed against it, scrolled away with the lesson, so it could only be
  grabbed in the first screenful (Patrick). Now the handle and the ✕ sit on
  the still panel, and the lesson and its sticky footer scroll inside.
- **Header and footer** (v8.26.0, Patrick). The header's top-right holds
  three captionless tools in a row (`.lesson-tools`): Known, a **⋮ menu**
  and ✕. The menu (the rail's session-menu styles and scrim, closed when
  another item opens) holds the occasional actions: Rewrite this lesson,
  then what shows, "Hide this node" and "Unhide *n* children", then
  what can't be undone, "Break it down again…" and "Delete
  permanently…", with a rule between the three groups (Patrick's grouping),
  each entry led by a line icon of one size and weight in a fixed column
  (`MenuIcon`; mixed glyphs and emoji before, which sat at different sizes
  and pushed the words out of line).
  A "…" marks an entry that asks first, and those two are red; Unhide and
  Break it down again are separate entries since v8.26.0 (one button's
  states before, so a redo was out of reach while anything was hidden). The footer is one row (two rows of four equal
  pills before, which cost the lesson about 180px and gave Delete Known's
  weight): what an Expand just did on the left (`.lesson-note`), then a
  first "+ Break it down" and **Next lesson ›**, wrapping only when the
  panel is too narrow for both. The old 2×2 grid below 440px went with it.
  On the dark theme a lesson image's white ground is dimmed a little
  (`brightness(0.86)`, full on hover) so a diagram doesn't glare.
- **Connections** (v8.23.0, Patrick; "Where it fits" for a round, and a
  bordered list of reasons before that): the item's *immediate* links, in a
  card whose caret header folds it away with `ui/Fold`. Folded, it is only
  its header, a line of counts ("Builds toward 1 · Combines 3") with no
  card around it (v8.26.0; a full-width card reading "CONNECTIONS" before). It starts open,
  and the choice is remembered per browser (`ca.knowledgeFitOpen`, the old
  name kept so the choice survives). "Taxonomy" was Patrick's first name
  for it, passed over because a taxonomy sorts things into kinds, and these
  are dependencies. Its sections (`connectionsOf`, empty ones left out),
  their counts in the header line:
  **Builds toward** and **Combines**, the same two for every kind
  (Patrick; "Required for" and "Depends on" for a concept, for one round):
  for a concept or the paper, what needs it and what it needs; for a
  synthesis, its parent and its members.

  Each row is one line: a dot in the node's own colour (`nodeLook`, a
  diamond for a synthesis), its name as a link that opens it, and a ✓ when
  known. No reasons: a tutor reason folded under each row's caret for one
  round, but the lesson's "How it fits in" card (see Lessons) says it
  better. Hovering a row lights its node on the 2D graph like a hover
  (`pointedId`), everything else dimming, but only that node and the open
  item, with the edge between them: a hover on the canvas lights the
  hovered item's whole neighbourhood, which from the card buried the one
  item being pointed at (Patrick). A selection-blue ring stood in for one
  round, and Patrick preferred the hover's own look.
  A section scrolls past about five rows, so a concept many items share
  can't push the lesson off screen. A tree to explore in place (Patrick's
  sketch) was left to the pyramid view's ticket: the card stays one level
  deep.
- **Colours:** gold for the paper, violet for a concept. **States**
  (`nodeLook`, v8.17.0): **green** once known, and a concept is **grey**
  until it has been explored (its lesson opened, or broken down), violet
  after, and grey again while its lesson waits to be rewritten after a
  "Break it down again" (`freshLesson`, v8.23.0, Patrick), even when the
  tutor landed on the same breakdown, until it is opened. **Outlines follow the citation graph**, on the node's own edge: a
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
- **Focus, as on the citation graph** (v8.23.0, Patrick: "the same
  hover/focus/dim logic and functionality"). `KnowledgeNetwork` works out
  the lit items with the citation graph's own `focusOf` and `focusAnchor`
  (`graph/model`), over `neighbourhood` (`model.ts`: what an item needs,
  what needs it, and the syntheses joined to it). **Hovering** an item
  lights it and its links; **the open item holds its links lit** while its
  panel is open; **hovering one of those** shows that one's links until
  the pointer leaves, and hovering a dimmed item changes nothing; **a find
  outranks** both. Everything else dims **in a trace of its own colour**
  (`dimLook`, the citation graph's `dimColor`: known, explored and new still
  read), only the focused item's edges stay lit (`linkLit`, the citation
  graph's `edgeLit` rule), and the focus names what it lights at any zoom.
  **Edges are a neutral slate** (`edgeColor` in `look.ts`, the one rule both
  views paint by; `--knowledge-edge*` per theme, v8.24.0, Patrick): a hue no
  node uses, since violet read as a concept and teal is a synthesis's. Plain
  with no focus, fainter where a focus dims them (the citation graph's grey
  `DIM_EDGE` all but vanished here), brighter where a focus that isn't their
  own lights them (a hovered neighbour, a find), and the selection blue on
  the open item's own edges. A synthesis's line keeps its teal, faint when
  dimmed. **3D** paints every undimmed edge the brighter slate: it has no
  hover, and draws its lines at reduced opacity, so the plain slate read as
  permanently dark there. Lines run centre to centre beneath the nodes, so each node is
  painted on the background first: a dimmed node's fill is see-through, and
  its edges once showed running into its middle.
  The alt-drag box picks only lit items. **3D** takes the open item's focus
  and the find but not hover, which would rebuild every sprite on each move
  (the lag v8.17.0 fixed); `lit` is memoised for the same reason. Not
  carried over: the citation graph's second click to close, since a quick
  second click here is the double-click that breaks an item down.
- **Find a concept by name** (v8.20.0) with the citation graph's own find
  bar (`graph/controls/FindBar`), in the same bottom-right corner, in its
  own wording (`FIND_COPY` in `KnowledgeNetwork`) and with its own tour
  anchor (`knowledge-find`). `findItems` (`model.ts`) is a plain,
  case-insensitive substring match over **names only**: lesson text would
  match nearly any word. While a query is live, every item that doesn't
  match dims (the citation graph's `DIM_NODE`, edges the faint slate unless
  they touch a match) and only the matches are named, at any zoom; in 3D the
  other spheres dim and their labels hide. **"select", or Enter, adds the
  matches to the check-off selection** and clears the find, so the
  selection's blue rings and its "✓ I know these" bar take over: find →
  select → check off. The query is component state like the selection,
  never saved, and a new course starts with it empty.
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
  when the switch is flipped. The 2D/3D choice is remembered per browser. In 3D, the legend and find
  control sit 14px higher on graph panels at least 640px wide, with a single
  navigation hint below. Narrower panels replace the hint with an ⓘ beside
  search: hover or focus to read it, click to pin it open, Escape to close.
  The footer returns to its normal bottom margin in that compact view.
  They share a single footer row: the legend stays on the left, starting as
  one long line when space allows. As space tightens it wraps into a rounded
  bubble, then a vertical list, then truncates labels with ellipses. Search
  stays beside it on the right.
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

A lesson is written **the first time its item is opened**, shown in the
panel with its images once both are ready (v8.24.0; see below), and kept on
the node. Moving on never aborts it (`useLessons`), and
in-flight lessons are tracked at module level, so remounting the tool doesn't
start the same lesson twice. The paper's own lesson is grounded in its
abstract.

**"How it fits in" has its own card** (v8.23.0, Patrick). Every lesson ends
with a section under that exact heading on how its subject serves each item
that needs it, the tutor being handed all of them with their reasons
(`needed_by`); the paper's own lesson has none. `splitLesson` cuts the
lesson there (loosely: any heading level or case) and the panel shows the
closing part in a card with the accent stripe (`.lesson-fit`), a lesson
without the heading (from before, or a model that skipped it) showing as one
piece. This replaced the per-row reasons under a caret in Connections:
Patrick found the caret easy to miss and the reason repeated by the lesson
anyway. **When what needs an item changes, only that section is rewritten.**
A lesson keeps the ids its section was written for (`fitFor`); once
`fitNeeds` differs (another breakdown made it a shared prerequisite, or a
parent was deleted), opening it, or the change itself while it's open, asks
`POST /api/knowledge/fit` for the section alone (`refit` in `useLessons`,
`fitIsStale`), and `joinLesson` puts it back on the kept lesson. A failed
rewrite keeps the old section and tries again on the next open.

**Lessons don't cite papers** (Patrick, v8.17.0). From v8.14.0 they cited the
paper's real references as `[n]` links that opened the cited paper's thread.
It was grounded but felt off ("bare numbers read as footnotes", and every
lesson cited the *root* paper's list however deep it sat), so citations are
out for now; a suggestions section of vetted resources is the planned
replacement. A course saved before then still holds lessons with markers and
their `refs`: `lessonText` (`model.ts`) hides just the markers those `refs`
resolved, so a bracketed range like `[0, 1]` in the prose survives.

**A lesson comes with a few real images** (v8.24.0, Patrick), inline after
the paragraphs they illustrate, each credited (a link to the web page, the
paper, or the reader's own book at the page) and described in the tutor's
words. The prose is still the tutor's own knowledge; only the pictures are
found. Not interactive: a fresh start beside the parked `feature/visuals`
branch, the way the assistant shows figures in its answers.

- **A lead image opens the lesson** (v8.32.0): the tutor's first search is
  for a picture of the subject itself (its best-known diagram), and one it
  places with `lead` is marked so. `KnowledgePanel` takes it out
  (`figures/split`'s `splitLead`) and shows it above the first paragraph,
  wherever the tutor put its marker, so the opening never depends on the
  model's placement. When nothing shows the subject itself the lesson
  opens on prose, and its other images sit after their paragraphs as ever.
- **Found first, then streamed** (Patrick, after trying text first and
  images after, then all at once: images popping in under a lesson already
  being read felt worse, and the text should still stream). The tutor
  searches your library, Wikipedia and the web, and papers for the pictures
  it wants and places them before it writes (see
  `agents/orchestrators/tutor/README.md`). `useLessons` streams the lesson
  with `paper` and `provider` (where the course paper's figures are),
  collecting `image` frames into the draft, so when the text streams its
  images are already in place; text and `images` land on the course
  together when it's done. While streaming, an image whose marker hasn't
  arrived yet waits for it instead of flashing at the end.
- **One status line until the text starts** (`StepLine`, the draft's
  `step`: each search as the tutor asks for it, "Looking at 4 images…",
  "Placing an image from …"), whose words rise in from below as each step
  replaces the last, like a chat app's thinking line (ported from the
  parked `feature/visuals`, slowed to 520ms in review). A search's line can
  run long (the tutor's whole picture description), so it is cut to one
  line with an ellipsis (Patrick: it read awkwardly over six), and a click
  unfolds every step so far (`steps`) as plain lines, the researcher's
  trace without its chips. Its caret follows the words (v8.26.0): in front
  of them it sat against the spinner, two odd marks side by side. It
  unfolds from the first step, the one on the line included (v8.32.1):
  listing only the earlier steps left it disabled until a second arrived,
  and the first, the opening image search, is the longest wait.
- **The lesson follows its own writing**: while the text streams, the
  panel scrolls with it, but only while the reader is at the bottom, so
  scrolling up to re-read stops the chase (the assistant transcript's rule,
  instant rather than smooth so it keeps up with the stream).
- **Quick response**, a link at the line's end behind an outline bolt
  that lights up on hover (`--bolt`: the title's blue in dark mode, the
  gold accent in light; `ui/QuickResponse` since v8.30.0, shared with
  every chat's working answer): `quick` stops the run
  (an `AbortController` kept per lesson at module level, beside
  `IN_FLIGHT`) and writes the lesson from the tutor's own knowledge alone,
  `quick: true`, with no image search. The stopped run's failure is
  ignored, and a quick draft offers no link. It looks like any other
  lesson once written.
- **Rewrite this lesson** (v8.24.0): in the panel's ⋮ menu since
  v8.26.0 (a ↻ beside the ✕ before, easy to confuse with Break it down
  again's ↻), there only once the lesson is finished.
  `knowledgeLessonCleared` drops the lesson, its images and `fitFor` and
  marks it `freshLesson`, so the open-lesson effect writes it again past
  the server's cache (`fresh: true`; a synthesis's route honours it too).
- **Markers in the lesson, like an answer's.** The tutor writes a
  `<<FIG n>>` line after each image's paragraph, the slot-tagged `images`
  sit on the node, and the panel splits it with the shared `figures/split`
  exactly as the chat splits an answer. A rewrite of the closing section
  reads the lesson without its markers (`withoutImageMarks`) and keeps
  them where they were; "Break it down again" clears `images` with the
  lesson. A lesson written before images keeps none, and gets them only if
  it is written again.

## A highlighted passage: Explain and Expand (v8.25.0)

Select a word or passage in a **finished** lesson and a small pill appears
over it (`SelectionMenu`, after SpatialRead's, which Patrick pointed at):
**Explain | Expand | Chat**, words rather than icons so the pill reads at
a glance, and Chat last so the first two kept their places. `useLessonSelection` is the
frontend's first reader of a text selection: it opens the pill when the
reader lets go (not mid-drag), places it above the passage in fixed
coordinates (below it near the top of the window), kept inside the
window's sides (v8.26.0: a passage at the edge squeezed it into a column
of letters, and its buttons don't wrap now either), follows a scroll, and
closes it when the selection collapses or leaves the lesson.

- **Explain** asks the course assistant (`assistant/`) about the passage:
  the shell opens the panel (`onAssistant`) and `askCourse` sends "Explain
  this passage from the lesson on *X*: “…”", with the whole course, the open
  lesson whole, as context. **Nothing is added to the graph.**
- **Expand** asks the tutor to name the one concept the passage is about
  (`POST /api/knowledge/phrase`, `tutor.name_phrase`, cached), then hangs it
  under the lesson's item with `withPrerequisite`, which uses the same
  linking as a breakdown. That settles the ticket's open question in favour
  of a node (Patrick): a term two lessons use stays one node with two edges,
  one deleted before comes back as it was, and an edge that would close a
  loop is refused. The item is not marked broken down (double-clicking still
  breaks it down), and the concept joins its remembered `breakdown`, which a
  later breakdown keeps, so deleting it can be undone like any other.
  While the tutor names it, the item wears the breakdown's dashed ring
  (v8.26.0, Patrick: `ringed`, the `expanding` set plus the item). A note
  in the footer's left (above the lesson until v8.26.0) says what happened
  and links the concept: "Added *X* as something this needs", "Already in
  the course: *X*", or why nothing was added (the passage names the
  lesson's own subject, or *X* already builds on this item). It is cut to
  one line with an ellipsis, the whole sentence its tooltip
  (`phraseSentence`), so it never pushes the buttons onto a second row.

- **Chat** (v8.26.0, Patrick: "just like Claude Code, where I can paste a
  text reference and then talk about whatever") opens the assistant with
  the passage **attached to its bar** as a quote card (accent stripe, three
  lines at most, its lesson under it, a ✕; Backspace in an empty bar lets
  it go too), and the bar takes focus. Nothing is asked until the reader
  types a question; the message then carries the passage and its lesson
  first and the question after (`quotedMessage`), so the transcript reads
  on its own. The quote lives in `App` beside the assistant's open state,
  for the thread it came from, since the lesson and the assistant are
  siblings there; a new Chat replaces it.

## Not yet (later Phase 5 stages, see the OnePager)

There is no challenger agent, no memory of known concepts across papers, no
verified external resources, and no interactive visuals (lesson images, since
v8.24.0, are real figures shown as they are). The course assistant
(`assistant/`) doesn't propose syntheses yet: that half of its ticket is
still open.

## Verified by

`test/knowledge/model.test.ts` covers identity, node kinds, shared concepts,
loops, routes, course order, pruning, next-lesson, `lessonText` and
`findItems`, syntheses (their target, their place in the teaching plan, their
lines, and being found again by their members), and deleting: what only the
deleted item needed going with it, a shared prerequisite staying, syntheses
left short, the paper refused, an unhide from the remembered breakdown (and
one filled in for an old course), a concept coming back as it was (lesson,
check-off, breakdown) by a restore or another breakdown, a permanent
delete that no unhide undoes (forgotten in archived breakdowns too), the
hidden counts behind the badges, and a fresh
breakdown keeping what it repeats; a lesson's image markers coming out for the
tutor, and a fresh breakdown clearing its images.
`test/knowledge/KnowledgeGraph.test.tsx` covers the 2D view's first fit,
that a shift-click selects without opening, and a find dimming the edges
away from its matches.
`test/knowledge/KnowledgeNetwork.test.tsx` runs the tool over a real store,
with the canvas swapped for a list of node buttons (jsdom can't draw). It
covers the first expansion and its grounding, an old-shape course being
replaced, a lesson streamed into the panel and kept, visiting, a check-off,
checking off a selection (and taking it back, and Esc), a find whose
Enter selects its matches, synthesizing two concepts that opens with
no check-off or breakdown (and synthesizing them again reopening it),
removing a selection with the Delete key (the paper refused) and bringing
it back with no call, a fresh breakdown, hiding from the panel without a
prompt against deleting for good behind one,
the next lesson, a shared prerequisite becoming one node with two edges, a
retry, the course surviving a save round-trip, and a lesson's images: one
status line with Quick response beside it until the text starts, then the
text streaming with its image already in place, the image landing right after its paragraph with its
description and linked credit, a closing-section rewrite reading the lesson
without its markers, and a quick response stopping the slow run and writing
the lesson at once, the menu's rewrite of a finished lesson past the cache, and
the status line unfolding into every step so far, and a highlighted
passage: Expand adding its concept under the lesson's item (and the note
opening it), Explain asking the course assistant with the graph untouched,
and Chat attaching the passage to the assistant's bar and sending it with
the question.
`model.test.ts` covers `withPrerequisite`: a new concept, an existing one
linked, an edge already there or closing a loop refused, and a later
breakdown keeping it. The 3D view, the canvas
painting, the folding controls and the legend are checked in the browser.
