# `src/tools`

A paper thread's **card home** (Phase 5a, v8.13.0): the page a paper lands on
when it gets a thread of its own. The paper sits at the top (title, authors and
year, then the TL;DR or, failing that, the abstract cut to four lines). Below it
is a grid of cards, one per tool that works on the paper. The layout follows a
gallery of launchers: an icon tile, a title and a one-line description.

```
tools/
  ToolCards.tsx — the home: paper header + cards; fetches a missing paper once
  tools.css     — the home, the cards, and `.tool-back`, the ‹ pill a tool
                  shows to get back here (rendered by App.tsx's overlays)
```

## The cards

- **Graph** opens today's explorer.
- **Knowledge network** is shown disabled with a "Coming soon" badge until
  Phase 5b lands it: a short course on the paper's prerequisites (see the
  OnePager).

Opening a card dispatches `openTool` (`store/workspace.ts`). The thread then
remembers its tool, so revisiting the thread reopens the tool rather than these
cards. The ‹ pill at the top of a tool returns here, and the graph stays built
in memory, so going back to it is free. **Nothing is built until a card is
opened.** The page exists so that opening a paper costs one lookup, not a graph
build.

## Decisions worth knowing

- **The paper header is free.** `openPaper` resolves the seed with one
  `/api/paper` call to create the thread, and that response is the header.
  Threads made any other way (a graph build, or a save from before v8.13.0)
  have no `paper`. For those, the home fetches it once on mount and stores it
  on the thread with `threadPaperSet`, so it saves with the thread and is not
  fetched again. Until then the thread's own title heads the page.
- **General has no cards.** It has no seed, so there is nothing for a tool to
  work on. It stays the search and chat surface.
- **One conversation per thread.** The assistant docks beside the cards and
  stays docked when a tool opens. It is the same transcript either way.

## Verified by

`test/tools/ToolCards.test.tsx` covers the header, the disabled card and the
one-time fetch. `test/store/threads.test.ts` ("card home") covers the
navigation underneath: opening onto cards without a build, building in place
without a twin thread, resuming on the last tool, and saving `tool`/`paper`.
