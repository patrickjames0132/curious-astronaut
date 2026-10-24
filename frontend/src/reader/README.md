# `src/reader`

The **Reader card** (v8.37.0): the third card on a paper thread's home,
beside the Citation Graph and the Knowledge Graph. It shows the paper itself,
parsed from its ar5iv render, with a contents rail that follows the reading.

```
reader/
  Reader.tsx      — the surface: fetches the document, the loading and
                    "nothing to read" states, the contents rail, the page
  ReaderBody.tsx  — the text: blocks (paragraph, equation, figure, table,
                    list) and the inline runs inside them
  links.ts        — what runs share with the page: the jump context, the
                    DOM-id prefix, plain text for tooltips
  reader.css      — the layout, the reading column, `--reader-ink` accents
```

## Where it's going

This is the first slice of the OnePager's **Reader card** item, whose
v1 leads with what only this app can do: (1) the structured parse, the
reading view and the contents (this slice); (2) a citation hover card that
resolves `[23]` to the real cited paper via S2, with a jump into the
Citation Graph; (3) Knowledge Graph notes in the margin; (4)
highlight-and-explain. The PDF fallback viewer and the guided read are v2.
Read the OnePager entry before extending it; the decisions behind that
order are settled there.

## Design decisions worth knowing

- **The backend parses, the frontend renders.** The route
  (`/api/paper/<ref>/document`, parsed by `integrations/arxiv/document.py`)
  sends a JSON tree, not ar5iv's HTML. Nothing third-party is ever passed to
  `dangerouslySetInnerHTML` (KaTeX's own output is the only HTML injected),
  and every run the later stages need, citations above all, is already a
  value with an id rather than markup to dig through. The types in
  `api/reader.ts` mirror the module's docstring.
- **Math is typeset from bare LaTeX** with `notation`'s `<TeX>`: ar5iv hands
  over each formula's `alttext`, so there's no `$` to find and none of
  `splitMath`'s currency rules to apply. The backend makes it KaTeX-safe
  first (box wrappers unwrapped, `\nicefrac` swapped; see
  `integrations/arxiv/README.md`).
- **Paper ids are prefixed in the DOM** (`readerDomId`: `S3.F1` →
  `reader-S3.F1`). ar5iv's ids are unique only within the paper.
- **Jumps are in-page.** A citation goes to its reference entry, a ref to its
  figure, equation or section, and the landing spot is marked for 1.6s
  (`.landed`). The browser's hash is left alone, so a jump never fights the
  app's own navigation. A citation's `title` already shows the entry; the
  hover card replaces that in the next slice.
- **Figures enlarge in the shared lightbox** (`figures/Lightbox`, the same
  one the assistants use): each panel is a button, and the caption goes in
  as a `MathText` string (`mathTextOf`, math fenced in `$…$`).
- **Algorithms keep their shape.** An `ltx_listing` arrives as a `listing`
  block of numbered lines, each with its `indent` in em, applied as left
  padding. Until then every line rendered as a flat paragraph.
- **Footnotes open in place** under their mark instead of a tooltip: they
  carry math and links, which a `title` can't show.
- **Figures sit on a white mat.** They're drawn for white paper; on the dark
  theme their black ink and transparent backgrounds would vanish. SVG panels
  are shown through `<img>`, where their scripts never run, and the figure
  proxy sandboxes them if opened directly (`routes/README.md`).
- **Open and folded mirror each other.** Open, the panel's right edge is the
  same thin coral line (`--contents-line`) with a bump on its inside at
  mid-height holding a `‹` that folds the panel (with the slide); folded,
  the line moves to the left edge and its bump's `›` brings the panel back.
  The open bump sits on the non-scrolling frame, above the drag handle that
  covers the rest of the edge.
- **The contents resize and fold by dragging, and reopen by the bump.**
  Their right edge is a drag handle (`ui/useResizablePanel`, the side
  panels' hook, `side: 'left'`; width remembered in `ca.readerContentsWidth`),
  and dragging well past the 180px floor folds them away to a thin coral
  line down the left edge with a bump at mid-height holding a `›`. Unlike the
  explorer rail, **a drag never reopens them** (`openAt: Infinity`, and the
  folded line has no handle): only a click on the line or bump does. Both
  left-hand panels opening by a drag on neighbouring edges would fight over
  one pointer (Patrick, 2026-10-23). The line sits 4px in from the rail's
  edge to clear the rail's own handle. The handle lives on a frame that
  doesn't scroll, with the list scrolling inside it; the first version's
  `|←` button sat in the scrolling list and was gone once you scrolled down,
  which is what the drag replaced. Folded by a drag, the panel snaps away
  (`.snap`) since it's already at its floor; reopening slides it in like the
  docked panels (`--motion-panel`, their keyframes mirrored, `ui/usePresence`
  holding it through an exit). The look is deliberately unlike the
  sidebar's 56px icon rail. Open or folded is remembered
  (`ca.readerContentsOpen`), and the panel stays at every window width.
- **The shell's overlays sit over the reading pane** (`.reader-main`), not
  the whole Reader, so the ↑ back to the cards centres over the text, not
  over text and contents together, and stays put as the text scrolls. (A ←
  was tried and dropped; `tools/README.md` has the story.) The top-right
  corner is kept free on purpose: it's where the app's assistants dock and
  reopen (`.pane-assistant`), and where the Reader's will.
- **The contents stop at subsubsections.** Paragraph headings ("Encoder:")
  are LaTeXML sections too, but listing them makes the rail a second copy of
  the text. The active entry is the last heading above the top third of the
  page, updated on scroll.
- **Three ways to have nothing to read**, each said plainly: the paper isn't
  on arXiv (`not_arxiv`), ar5iv couldn't convert it (`no_render`, with a link
  to the PDF), or ar5iv didn't answer (`error`, with Try again). It's often
  slow.
- **The source is credited** at the end of the text, with a link to the
  ar5iv page. Showing it in a local app is like viewing it in a browser;
  exporting it would be redistribution, which the OnePager entry flags.

## Verified by

`test/reader/Reader.test.tsx` renders the Reader over a stubbed document:
the text with its math and figure, the contents (paragraph headings left
out) and its jumps, a citation's tooltip and landing, a footnote opening,
a figure enlarging, an algorithm's numbers and indents, the contents
resizing and folding by a drag and coming back only by the bump, and each
unavailable state, including the retry. The parse itself is
covered by `test/curious_astronaut/integrations/arxiv/test_document.py`.
