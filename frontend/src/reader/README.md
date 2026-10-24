# `src/reader`

The **Reader card** (v8.37.0): the third card on a paper thread's home,
beside the Citation Graph and the Knowledge Graph. It shows the paper itself,
parsed from its HTML render (arXiv's own, else ar5iv's), with a contents rail
that follows the reading.

```
reader/
  Reader.tsx      — the surface: fetches the document, the loading and
                    "nothing to read" states, the contents rail, the page
  ReaderBody.tsx  — the text: blocks (paragraph, equation, figure, table,
                    list) and the inline runs inside them
  links.ts        — what runs share with the page: the jump context, the
                    DOM-id prefix, plain text for tooltips
  selectionText.ts — what a highlight says (formulas as LaTeX) and where it's from
  askReader.ts    — the Reader Assistant's asking: what it sends, the
                    section in view, how a highlight's action is worded
  ReaderAssistant.tsx — the docked assistant: the shared panel with the Reader's words
  reader.css      — the layout, the reading column, `--reader-ink` accents
```

## Where it's going

The OnePager's **Reader card** item holds the plan, in the order Patrick set
after the first browser round (2026-10-23): (1) the structured parse, the
reading view and the contents (v8.37.0); (2) the highlight menu and the
Reader Assistant (v8.38.0, below); (3) the PDF fallback viewer with the same
AI tools; (4) a citation hover card that resolves `[23]` to the real cited
paper via S2; (5) Knowledge Graph notes in the margin. Read the OnePager
entry before extending it.

## The highlight menu and the Reader Assistant (v8.38.0)

Select text and the shared highlight menu (`../selection/`) offers
**Explain · Simplify · Chat**. Explain and Simplify ask the **Reader
Assistant** about the passage, opening it ("Explain this passage from
section 3.2, Attention: “…”"); Chat opens it with the passage attached to
its bar, for a question of the reader's own. There's no Expand: in the
Knowledge Graph it adds a concept, and the Reader has no graph to add to
(Patrick, 2026-10-24).

- **The assistant is the Knowledge Graph's, generalized.** The panel and
  stream engine are `../assistant/`, shared; `ReaderAssistant.tsx` and
  `askReader.ts` give it the Reader's words and what to send. It keeps its
  own chat (`<thread>:reader`, saved as `ThreadRecord.readerChat`) and docks
  in the top-right corner kept free for it, behind a 🎓 when closed.
- **It reads the paper, not a summary.** `askReader` sends only the arXiv id
  and the section in view; the server lays the paper out from the document
  it cached for the Reader (`routes/agents.py`, `_reading_context`): the
  section in view whole, then the rest of the paper as it fits. It searches
  the library and the web only when a question reaches past the paper, and
  never the literature (Patrick's choice: paper + library + web).
- **The section in view** is the contents' active entry, or the section a
  highlighted passage is in. The Reader writes it to `askReader`'s own map
  (`setReadingSection`) rather than the store, since it changes on every
  scroll and is needed only when asking.
- **A highlight is read as the paper writes it.** The shared
  `../selection/formulas` reads a selected formula back as LaTeX, and part
  of one as its glyphs with the whole formula for context (the browser's
  own reading doubles every formula); `selectionText.ts` adds the Reader's
  breaks and drops footnote marks, and finds where the passage is from through the
  `data-passage-from` each section carries ("section 3.2, Attention", "the
  abstract", "the part on Encoder" for an unnumbered paragraph heading).

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
- **The text comes from arXiv's own HTML render first, ar5iv as the
  fallback** (v8.39.0, `integrations/arxiv/client.py`): about 0.05s against
  ar5iv's 30s+ timeouts, old papers included. The credit at the end of the
  text names whichever rendered it (`source` on the document).
- **Three ways to have nothing to read**, each said plainly: the paper isn't
  on arXiv (`not_arxiv`), neither renderer could convert it (`no_render`,
  with a link to the PDF), or neither answered (`error`, with Try again).
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
