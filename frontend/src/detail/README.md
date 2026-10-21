# `src/detail`

The selected paper: the right-hand detail panel and the selection state
behind it.

```
detail/
  useSelection.ts — selection id, lazy hydration/figures/code/categories, click gesture
  DetailPanel.tsx — the panel (badges, meta incl. the publication venue,
                    summary, category tags, actions, the Expand row, code
                    links, figures)
  detail.css      — styles (ported light-touch)
```

Figures are click-to-enlarge via `../figures/Lightbox.tsx` — a root-level,
multi-consumer component (also used by the teacher's answer figures), not
nested here; see `figures/README.md`. `DetailPanel` takes an `onEnlarge`
callback rather than owning the lightbox itself — `GraphExplorer.tsx` (its
parent) holds that state, same pattern as `Teacher.tsx` does for its own
figures.

## Design decisions worth knowing

- **One summary section, TL;DR first, the abstract a click away.** The
  `SummarySection` (in-file, single-parent) puts the TL;DR tab first and
  opens on it **when one already exists** — S2's own, or one generated
  earlier; otherwise it opens on the abstract, because the TL;DR tab then
  wears a ✦ and opening on it would bill on every selection. Until the
  reader picks a tab, that default follows the node, so a TL;DR arriving
  with hydration takes over. The ✦ tab's first click generates one via the
  backend's
  `summarizer` micro-agent (`onGenerateTldr` → `api.generateTldr` →
  `POST /api/paper/tldr`). **That click is the only surface that can
  trigger a Claude call** — Patrick's billing rule — and the server caches
  the result by node id forever, so each paper bills at most once; a
  cached summary rides ordinary hydration for free afterwards. Failure
  shows in place and the abstract stays a tab away.
- **Everything about a paper loads lazily, and each thing exactly once.**
  Graph neighbors arrive summary-light; opening one hydrates its
  abstract/TL;DR on first click (cached per paper). Figures fetch on first
  open — keyed by `arxiv_id ?? id`, since a paper off arXiv gets its
  figures mined server-side from its open-access PDF — with failures cached
  as `unavailable` so a flaky upstream isn't re-hit; code links (HF Papers)
  and category tags (arXiv's own metadata) each use a requested-set for the
  same guarantee. A new graph invalidates all four caches and clears the
  selection.
- **A new graph opens with the panel CLOSED** (v7.9.0). It used to select
  the seed, so every build landed with the panel already covering the
  canvas — chrome in front of the thing the reader had just asked to see.
  Nothing is selected now; a click opens a paper, which is what the click
  is for. One path still opens it without one: the guided tour's
  `'details'` stops, which select the seed if nothing is open so the walk
  has a panel to spotlight — an effect registered *after* `useSelection`'s,
  so it sets the seed back after the per-graph clear runs on the same
  change. (The sibling half of the same call: `graph/controls`' panel now
  starts collapsed.)
  The **chat-citation** re-seed was the other exception (`revealSeedDetail`,
  a `fromChat` load consumed in `GraphExplorer`), on the theory that such a
  click *asked* for a paper rather than a map. It asked for both, and the
  panel covered the map at the exact moment it appeared, so it went the same
  way as the seed-select in **v7.11.0** — flag, action and all.
- **The loadable sections reveal together, behind one joint gate.** While
  ANY of the node's fetches is in flight — summary hydration (reported by
  `useSelection`'s `detailLoading` id), arXiv tags, code links, figures —
  every loadable section holds its place with an anonymous shimmer block
  (`Skeleton`, in-file; `.skel-*` variants shaped like the content to
  come), *including one whose answer already landed*, and the whole set
  reveals in a single paint when the last answer arrives (Patrick's call:
  figures beating the abstract in read as jank; the first per-section
  version let each resolve independently). Empty sections simply don't
  appear at the reveal. The arXiv-keyed trio infers "in flight" from
  `arxiv_id && response === undefined` — those fetches always fire on
  first open and cache their failures, so undefined can only mean
  pending. Non-arXiv papers gate only on hydration: their figures fetch
  (OA-PDF mining, potentially a whole download) is deliberately OUTSIDE
  the joint gate, revealing when it lands rather than holding the panel
  hostage. The node-local parts (badges, title, meta, actions) render
  instantly — they never load, so they never pop. Skeletons are
  **headless on purpose**: a section may resolve to "nothing", and a named
  header that then vanishes would be its own jank. Purely decorative —
  `aria-hidden`, with the shimmer disabled under `prefers-reduced-motion`.
- **Hydration works for non-arXiv papers** (fixed in this port): the fetch
  uses `arxiv_id ?? id` — the old code's arXiv gate left journal papers
  abstract-less forever, the client half of the hydration bug fixed
  server-side in Phase 5. Figures now use the same `arxiv_id ?? id` key
  (the backend mines a journal paper's OA PDF). Code links and category
  tags stay arXiv-gated on purpose: HF Papers and arXiv's own metadata are
  arXiv-keyed — a journal paper's node just never requests them.
- **The click gesture** (v8.21.0): a click opens a paper, **centres it** and
  **holds its links in focus** while its panel is open (`GraphExplorer`
  derives the held focus from `selectedId`; it was a ⌘-click before), and a
  **click on the open paper closes it**, letting go of the focus. Until
  v8.21.0 a quick (<350 ms) second click was a double-click that re-seeded
  the graph on the paper; with a second click also closing the panel, the
  two fought over one gesture (Patrick found the double-click hard to land),
  so the double-click went and re-seeding is the panel's **"Explore in a
  thread"** alone, by node id so journal papers work as seeds too.
- **`DetailPanel` is purely presentational**, and its `CodeRow`/
  `CodeSection`/`CategoryTags` children are single-parent — nested in the
  parent's file per the hybrid structure rule. The HF section caps rows
  (3 models / 2 datasets / 2 Spaces) with the totals linking out to HF
  Papers; the PDF link rewrites `/abs/` → `/pdf/` for arXiv papers, and for
  papers off arXiv it points at the hydrated `oa_pdf` URL (the same
  open-access PDF the backend mines for figures) — absent both, no link.
  Category tags render as read-only pills (unlike the search
  filter's clickable `.cat-chip` — nothing to toggle here) between the
  meta line and the TL;DR.

- **"Expand on this graph" (v8.18.0).** Every paper but the seed gets two
  buttons, **+ References** and **+ Citations**. Each pulls that paper's
  references (all of them) or citers (the tau rule's pick over its whole
  history, as the seed's are, by your build shape) onto the graph you're on, with no new
  thread and no agent run, and the paper moves out with them: in Force, a
  cluster of its own laid out like the seed's (references west, citers
  east), with the papers it shares with the seed between the two; in
  Timeline, a stream above the seed's. The view refits once it settles. The seed has
  none, because the build already drew its neighbourhood. A status line says what the last hop did ("Added 8 of
  its citers.", or that its top ones were on the graph already). **A hop in
  flight spins inside its button** (the app's shared `.spin`); **one that
  has run wears a green ✓** (`--done-ink`; the buttons are `.btn-marked`
  grids from `app.css`, the label centred and the mark centred in the space
  to its left), faded in when it just finished
  in front of the reader (`fresh`) and simply shown when read back after a
  reload. **Reclicking the ✓ undoes the hop** (on hover it turns to ✕ to
  say so): its papers leave the graph unless something else still links
  them, and the line says how many went. `aria-pressed` carries the state,
  since the icons are hidden from the accessible name. Until v8.18.0's
  polish the ✓ was disabled and forgotten on reload. The panel stays
  presentational: `GraphExplorer` derives each hop's ✓ from the discovery
  lists (`graph/expansions.ts`, saved with the thread, so it persists) and
  keeps only what's in flight, failed or just undone in its own
  `ExpansionStatus` record (cleared with each new graph).
  See `graph/hooks/README.md` for how the result merges.
- **It slides in and out, and the graph glides with it (v8.9.0).** The
  panel keeps its full width and a negative `margin-right` pulls it past the
  edge (`panel-in` / `panel-out` in `index.css`), so its text never reflows
  mid-motion while the canvas resizes frame by frame. `GraphExplorer` mounts
  it through `ui/usePresence` and passes the **last** selected paper while it
  slides out — the selection is already null by then. Switching papers keeps
  the same element, so nothing replays.

## Who uses it, and how/why (traced from the old app)

`graph/GraphExplorer.tsx` owns the `useSelection` instance, hands its
`onNodeClick` to `GraphCanvas`, renders `DetailPanel` when `selected` is
non-null (passing it `onEnlarge={setLightbox}` for its own lightbox
instance), and passes `selectedId` back to the canvas for the selection
ring. The teacher's "papers I cited" chips also drive `setSelectedId`.

## How it's verified

`tsc --noEmit` strict + oxlint; `test/detail/useSelection.test.tsx` covers
a new graph opening nothing and a click on the open paper closing it; the
lazy-load/caching behavior is a browser-milestone item (click a journal paper —
its abstract should now appear).

## Citation navigation

Inline paper citations highlight nodes on the current canvas. Graph icons open
or resume that paper's thread directly. From the graph they land on its graph;
from anywhere else they land on its cards, after one `/api/paper` lookup that
resolves the thread's id (`store/workspace.ts`'s `seedPaper`). The
canvas's existing detail panel remains available by selecting a graph node.

Author lists longer than 160 characters use the shared `ui/AuthorList` disclosure:
a preview ending at a comma or word boundary with an ellipsis, then “Show all
authors” / “Show fewer”. The accent-colored, semibold text button uses a disclosure chevron instead of an underline.
A normal word space separates it from the authors, so a wrapped control aligns
with the start of the text rather than retaining an inline margin. The full provider text is preserved, and the
publication year stays visible when the author list is collapsed.
