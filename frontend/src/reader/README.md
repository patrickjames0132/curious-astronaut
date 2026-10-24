# `src/reader`

The **Reader card** (v8.37.0): the third card on a paper thread's home,
beside the Citation Graph and the Knowledge Graph. It shows the paper itself,
parsed from its HTML render (arXiv's own, else ar5iv's), with a contents rail
that follows the reading, or as its PDF (v8.40.0).

```
reader/
  Reader.tsx      — the surface: fetches the document, the loading and
                    "nothing to read" states, the contents rail, the page
  ReaderBody.tsx  — the text: blocks (paragraph, equation, figure, table,
                    list) and the inline runs inside them
  links.ts        — what runs share with the page: the jump and citation-card
                    context, the DOM-id prefix, plain text
  CitationCard.tsx — the card a citation opens: the paper it cites, and ways on
  useCitationCard.ts — when the card shows, stays and goes, and where it sits
  selectionText.ts — what a highlight says (formulas as LaTeX) and where it's from
  askReader.ts    — the Reader Assistant's asking: what it sends, the
                    section in view, how a highlight's action is worded
  ReaderAssistant.tsx — the docked assistant: the shared panel with the Reader's words
  PdfView.tsx     — the PDF view: pages sized up front, drawn near the view
  pdf.ts          — pdf.js, loaded on first use, and a PDF's outline as pages
  reader.css      — the layout, the reading column, the PDF's pages, `--reader-ink` accents
```

## Where it's going

The OnePager's **Reader card** item holds the plan, in the order Patrick set
after the first browser round (2026-10-23): (1) the structured parse, the
reading view and the contents (v8.37.0); (2) the highlight menu and the
Reader Assistant (v8.38.0, below); (3) the PDF view with the same
AI tools (v8.40.0, below); (4) the citation cards, resolving `[23]` to the
real cited paper (v8.43.0, below); (5) Knowledge Graph notes in the margin;
(6) an answer lighting up the passage it's about. Read the OnePager entry
before extending it.

## The citation cards (v8.43.0)

- **Hover previews, a click pins** (Patrick, 2026-10-24). The card shows
  after the pointer rests 250ms on a citation, so passing over the text
  doesn't flash cards, and stays while the pointer is on the citation or the
  card. A click pins it (the citation's second click unpins); a pinned card
  stays through hovering other citations, until its ×, Esc or a click
  elsewhere (`useCitationCard`). It sits in the pane's scrolled content,
  under the citation or above it when there's no room, so it scrolls with
  the text.
- **The paper it cites**, from `GET /api/paper/<id>/cited`
  (`services/reader/citations.py`): each bibliography entry matched to the
  thread provider's reference list, by arXiv id, then title. Matched: title,
  authors · year · venue, citations, TL;DR (hydrated in the same request
  on S2). Unmatched, or while matching: the entry's own text, and once
  matching is done, a line saying the provider's list hasn't got it.
- **Four ways on** (Patrick): **Open** it as its own thread on its card home
  (`openPaper`, by the thread's provider, as papers open elsewhere);
  **Read** it, the same and then its Reader; **Show in Citation Graph**,
  switching this thread to its graph, which selects and centres the paper
  (`workspace.focusRequest`, acted on by `GraphExplorer`; greyed out when
  the graph is built and hasn't got it, and building it when it isn't);
  **Reference ↓**, the old click, to the entry in the reference list.
- **Not in the PDF view.** A PDF's citations are drawn text; see
  `services/reader/README.md`.

## The PDF view (v8.40.0)

The paper as its PDF, drawn by pdf.js (`pdfjs-dist`, pinned). **When:** on
its own for a paper with no HTML render (a failed conversion like Adam, or an
open-access paper not on arXiv), and by the reader's choice on a small
**Text / PDF** switch at the foot of the pane, remembered on the thread
(`ThreadRecord.readerView`, saved with the session). A remembered PDF choice
opens at once, without waiting for the text. The switch is there even for a
paper with only its PDF (Patrick): its Text button is off (`aria-disabled`,
not `disabled`, so the tooltip still shows) and its tooltip says why in a
line (`NO_TEXT`). Switching slides the arriving view in from its button's
side (PDF from the right, Text from the left), as the cards' scroll does,
the leaving one already gone; the switch's thumb slides between its buttons.

- **The file comes from our origin.** `/api/paper/<ref>/pdf` serves it out of
  `services/pdf`'s on-disk cache (downloaded once; `docs/pdf-mining.md`), the
  URL resolved server-side (`paper_pdf_url`: arXiv's PDF for an arXiv id,
  else the provider's open-access PDF), never taken from the client. Serving
  needs no optional extra.
- **pdf.js costs nothing until it's used.** `pdf.ts` imports the library and
  its worker on first use, so they're separate chunks (about 130 KB gzipped
  plus the worker) and the app's start-up is unchanged.
- **Pages are sized up front, drawn near the view, and kept.** Every page's
  box is set from its own dimensions when the PDF opens, so the scroll and
  the jumps are right before anything is drawn; a page draws (a canvas at the
  screen's pixel ratio, and pdf.js's transparent text layer over it) within
  a screen or so of view and is never torn down, so a selection in it can't
  vanish under a redraw (the lesson of the vanishing equation highlight,
  `docs/bugs.md`). Pages fit the pane's width, up to 900px, **once the
  width settles** (200ms): following every frame of the contents panel's
  slide redrew every drawn page each frame, and the fold lagged. When the
  scale does change, the page at the top of the pane stays there, the same
  fraction of the way down.
- **Only the text layer's essential CSS** is ours (`reader.css`, from
  pdf.js's own `.textLayer` rules); pdf.js's whole viewer stylesheet carries
  global rules this app doesn't want. `--total-scale-factor` is set per page.
- **The contents are the PDF's table of contents**, jumping to each
  heading's place on its page, the active entry the last heading above the
  top third of the pane: its own outline (bookmarks) when
  it has one, else the section headings the server finds in its text
  (`/api/paper/<ref>/pdf-contents`, `services/pdf/headings.py`), since many
  arXiv PDFs have no outline (Adam's and SAC's don't; Attention's does). A
  numbered entry's number goes in the rail's number column. Without the
  server's `pdf` extra, pdf.js's own reading of the outline stands in.
  Entries carry `top`, how far down the page the heading sits, because
  papers often start two sections on one page: knowing only the page, a
  click on the first landed on, and lit, the second. An entry without it
  jumps to its page's top. Each page's `data-scale` turns points into pixels.
- **A clicked entry stays active until the reader scrolls by hand** (a
  wheel, touch, pointer or key in the pane), in both views: two headings
  close together would otherwise both pass the top third once a jump lands,
  and the later one would light.
- **The highlight menu and the assistant work the same.** Each page carries
  `data-passage-from` ("page 3") and `data-section-id` (`page:3`), as a
  section does in the text view; a PDF line ends in a `<br>`, read as a
  break. The assistant is told the page in view and reads the PDF's text,
  that page first (`routes/agents.py`, `_pdf_context`), which needs the
  optional `pdf` extra (PyMuPDF); without it the assistant says so, and the
  PDF still shows.
- **Nothing to read** now means the PDF wouldn't open either: the messages
  name both, and a chosen PDF that won't open offers the text back.

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
  app's own navigation. A citation's own jump is its card's **Reference ↓**
  since v8.43.0.
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
  holding it through an exit). **It all moves by transform**: the layout
  changes once at the start (a closing panel leaves the flow, an opening
  one takes its width) and the reading pane's contents glide from where
  they were (`.glide-open`/`.glide-close`, half the panel's width, since
  they're centred). The first version animated the panel's margin, which
  resized the pane every frame and re-laid out the whole paper each time;
  the fold lagged in both views. The look is deliberately unlike the
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
out) and its jumps, a citation's card (pinned, previewed on hover, matched
or not, its actions and its jump to the reference), a footnote opening,
a figure enlarging, an algorithm's numbers and indents, the contents
resizing and folding by a drag and coming back only by the bump, and each
unavailable state, including the retry, and the PDF view with pdf.js
stubbed: the fallback with its outline as the contents, the switch and its
remembered choice, a chosen PDF that won't open, and a highlight's page. The parse itself is
covered by `test/curious_astronaut/integrations/arxiv/test_document.py`.
