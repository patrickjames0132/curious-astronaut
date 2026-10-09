# `src/tools`

A paper thread's **card home** (Phase 5a, v8.13.0): the page a paper lands on
when it gets a thread of its own. The paper sits at the top (title, authors and
year, then the TL;DR or, failing that, the abstract cut to four lines). Below it
is a grid of cards, one per tool that works on the paper. The layout follows a
gallery of launchers: an icon tile, a title and a one-line description.

```
tools/
  ToolCards.tsx — the home: paper header + cards; fetches a missing paper once
  tools.css     — the home, the cards, `.tool-back` (the ↑ a tool shows to
                  get back here, rendered by App.tsx's overlays), and
                  `.tool-surface`'s scroll between the cards and a tool
```

## The cards

Named **Paper Graph** and **Knowledge Graph** at 5b's review (Patrick,
2026-10-09): papers on one card, ideas on the other. The Paper Graph became
the **Citation Graph** in v8.16.0, which says what its edges are. The code
keeps its internal names (the `'graph'` tool id, `GraphExplorer`,
`knowledge/KnowledgeNetwork`).

- **Citation Graph** opens today's explorer.
- **Knowledge Graph** opens `knowledge/KnowledgeNetwork`, a short course
  on the paper's prerequisites (Phase 5b, v8.14.0). Until then it was shown
  disabled under a "Coming soon" badge; the `soon` flag on `ToolCard` is still
  there for the next tool.

Opening a card dispatches `openTool` (`store/workspace.ts`). **Clicking a
thread in the rail always lands here** (`openThread`, since v8.16.0), even
the thread already on screen; until then a revisit reopened the tool last
used. Opening a paper *for* a tool still lands on that tool: a node's
double-click on the graph, or a citation's graph icon. A thread saved or
reloaded on a tool reopens there too. The ↑ at the top of a tool returns here, and the graph stays built in
memory, so going back to it is free. It was a pill bearing the paper's title
until 5b's review: titles run long, and "up" is where the cards are. **Nothing is built until a card is
opened.** The page exists so that opening a paper costs one lookup, not a graph
build.

## The scroll between the cards and a tool

The cards sit "above" the tools. Going back up, the cards come down from the
top; opening a tool, it comes up from below (`.tool-surface.scroll-up` /
`scroll-down`, `--motion-scroll`). `App.tsx` wraps a paper thread's surface in
a `.tool-surface` keyed by thread and tool. It works out the direction during
render by comparing with the previous surface, so the class is there on the
first frame, and only **within one thread**: arriving at a thread from the
rail keeps the plain fade. The class clears on its own `animationend`, so a
surface that swaps its content later (a graph arriving after its build) doesn't
scroll in twice. `.shell-body` is `overflow: clip` on both axes so the
off-screen half of the move never shows a scrollbar. Only the arriving surface
moves; the leaving one is already unmounted, because keeping a live graph
mounted through the move would cost more than the effect is worth.

## Decisions worth knowing

- **The paper header is free.** `openPaper` resolves the seed with one
  `/api/paper` call to create the thread, and that response is the header.
  Threads made any other way (a graph build, or a save from before v8.13.0)
  have no `paper`. For those, the home fetches it once on mount and stores it
  on the thread with `threadPaperSet`, so it saves with the thread and is not
  fetched again. Until then the thread's own title heads the page.
- **General has no cards.** It has no seed, so there is nothing for a tool to
  work on. It stays the search and chat surface.
- **No assistant on the cards.** Since v8.15.0 the assistant docks beside
  the Citation Graph alone (each tool keeps its own voice; see
  `teacher/README.md`). Until then it docked beside the cards and followed
  into every tool, where it could only answer seedless.

## Verified by

`test/tools/ToolCards.test.tsx` covers the header, both cards and the
one-time fetch. `test/store/threads.test.ts` ("card home") covers the
navigation underneath: opening onto cards without a build, building in place
without a twin thread, resuming on the last tool, opening from the rail onto
the cards without a rebuild, and saving `tool`/`paper`.
