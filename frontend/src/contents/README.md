# `contents/`

The **contents rail**: a page's sections down its left edge, following the
reading, one click to any of them. Born in the Reader (v8.37.0) and pulled
out here when the Criticisms card wanted the same one (2026-10-27, Patrick:
"a table of contents just like the Reader"), so the two read as one control
and can't drift apart.

```
ContentsRail.tsx — the rail (open, or folded to its line) and its hooks:
                   useContentsRail (open/folded, width, slide, the host's
                   glide) and usePinnedEntry (a clicked entry stays lit)
contents.css     — its look, the slide, and the contents-glide-* keyframes
                   a host's page plays
```

## What the host owns, and what the rail does

The rail knows nothing about papers. A host hands it its **entries** (id,
level 1–3, a number for the number column, the title as shown and as plain
text for the tooltip) and **which one is active**, and gets a click back as
`onPick(id)`. Working out what's being read stays with the host, because only
it knows its page: the Reader follows headings in the text and places in the
PDF; Criticisms follows its numbered sections. Both use the same rule, the
last section whose top has passed the top third of the page.

The rail owns the panel, through `useContentsRail(openKey, widthKey)`:
whether it's open, its width, the slide, and the glide. Each host passes its
own localStorage keys, so folding the Criticisms contents leaves the Reader's
open (`ca.readerContentsOpen` / `Width`, `ca.criticismsContentsOpen` /
`Width`). The host sets **`--contents-ink`**, its accent (the Reader's coral,
the Criticisms sage), and **`--contents-width`** (the rail's width, for the
glide) on an ancestor.

`usePinnedEntry(pane)` keeps a clicked entry lit until the reader scrolls by
hand (wheel, touch, pointer or key on the page): two sections close together
would otherwise light the later one, both having passed the top third once
the jump lands.

## How it looks and moves

- **Open and folded mirror each other.** Open, the panel's right edge is a
  thin line in the host's accent (`--contents-line`) with a bump on its
  inside at mid-height holding a `‹` that folds the panel (with the slide);
  folded, the line moves to the left edge and its bump's `›` brings the
  panel back. The open bump sits on the non-scrolling frame, above the drag
  handle that covers the rest of the edge.
- **It resizes and folds by dragging, and reopens by the bump.** Its right
  edge is a drag handle (`ui/useResizablePanel`, the side panels' hook,
  `side: 'left'`), and dragging well past the 180px floor folds it away to
  the line. Unlike the explorer rail, **a drag never reopens it**
  (`openAt: Infinity`, and the folded line has no handle): only a click on
  the line or bump does. Both left-hand panels opening by a drag on
  neighbouring edges would fight over one pointer (Patrick, 2026-10-23). The
  line sits 4px in from the explorer rail's edge to clear that rail's own
  handle. The handle lives on a frame that doesn't scroll, with the list
  scrolling inside it; the Reader's first version had a `|←` button in the
  scrolling list, gone once you scrolled down, which is what the drag
  replaced.
- **It all moves by transform.** Folded by a drag, the panel snaps away
  (`.snap`) since it's already at its floor; otherwise it slides like the
  docked panels (`--motion-panel`, their keyframes mirrored, `ui/usePresence`
  holding it through an exit), and only after a toggle, so arriving at a page
  doesn't replay it. The layout changes once at the start (a closing panel
  leaves the flow, an opening one takes its width) and the host's page
  glides from where it was: `useContentsRail` returns `glide`, the host puts
  `.glide-open`/`.glide-close` on its page and applies the shared
  `contents-glide-*` keyframes (half the panel's width, since pages are
  centred) to its children, and wires `onAnimationEnd` back to
  `onGlideEnd`, with a fallback timer for an end that never comes. The
  Reader's first version animated the panel's margin, which resized the pane
  every frame and re-laid out the whole paper each time; the fold lagged
  (Patrick, 2026-10-24). No glide under reduced motion.
- The look is deliberately unlike the sidebar's 56px icon rail, and the
  panel stays at every window width (Patrick, 2026-10-23: hiding it took the
  choice away, and folding is one click).

## Who uses it

- `reader/Reader.tsx` — the paper's sections (to subsubsections) or its
  PDF's outline.
- `criticisms/Criticisms.tsx` — the card's criticisms, by number; drawn
  only when there are some.

## Help surfaces

Each host's tour has its own Contents step (`tour/steps.ts`, on
`data-tour="reader-contents"` and `"criticisms-contents"`, passed in as
`tour`). Change what the rail does and update both.

## Verified by

`test/contents/ContentsRail.test.tsx`: entries by number, the active one, a
pick, and folding under its own key. The hosts' tests cover it in place:
`test/reader/Reader.test.tsx` (the drag resize and fold, the bump, the PDF
outline's numbers) and `test/criticisms/Criticisms.test.tsx` (numbered
entries, a click lighting one, its keys apart from the Reader's, no rail on
an empty card).
