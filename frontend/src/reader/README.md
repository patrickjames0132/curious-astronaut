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
  ConceptNote.tsx — a Knowledge Graph note: the course concepts a section builds on
  ConceptCard.tsx — the card a note's concept opens: why, its lesson, the check-off
  useConceptNotes.ts — which concepts each section needs (the tutor's placement)
  CriticismNote.tsx — a criticism note: the Criticisms card's criticisms at a passage
  CriticismCard.tsx — the card a note's criticism opens: its summary, a quote, the way on
  useCriticismNotes.ts — the card's pins (the reviewer's placement), and in the PDF
  useMarginNotes.ts — margin notes stacked apart and tied to their headings or passages
  passages.ts     — an answer's passages: read out, found in the text, lit
  usePdfPassages.ts — the same in the PDF, as places: boxes over its pages
  pdfPlaces.ts    — where a PDF highlight began and ended, as points on its pages
  useBoxDraw.ts   — a box drawn with ⌥-drag, over the PDF's pages or the text
  textBox.ts      — what a box over the text takes: whole elements, figures as images
  glide.ts        — every scroll the Reader makes itself, kept to its target as the page settles
  useAnchoredCard.ts — when a card shows, stays and goes, and where it sits
  selectionText.ts — what a highlight says (formulas as LaTeX) and where it's from
  askReader.ts    — the Reader Assistant's asking: what it sends, the
                    section in view, how a highlight's action is worded,
                    and the lecture (guideReader, askOrGuideReader, beatLight)
  useReaderView.ts — what the Reader lends the one assistant: its words, its
                    asking, and the passages its answers light (v9.0.0)
  PdfView.tsx     — the PDF view: pages sized up front, drawn near the view,
                    notes in the margin beside them
  pdf.ts          — pdf.js, loaded on first use, and a PDF's outline as pages
  reader.css      — the layout, the reading column, the PDF's pages, `--reader-ink` accents
```

## Where it's going

The OnePager's **Reader card** item holds the plan, in the order Patrick set
after the first browser round (2026-10-23): (1) the structured parse, the
reading view and the contents (v8.37.0); (2) the highlight menu and the
Reader Assistant (v8.38.0, below); (3) the PDF view with the same
AI tools (v8.40.0, below); (4) the citation cards, resolving `[23]` to the
real cited paper (v8.43.0, below); (5) the Knowledge Graph notes (v8.44.0,
below); (6) an answer lighting up the passage it's about (v8.45.0, below);
(7) a box drawn over the PDF to ask about (v8.46.0, below); (8) the same
box in the text view, taking whole elements (v8.48.0, below).
Read the OnePager entry before extending it.

## The lecture: Give Lecture On Paper (v8.50.0)

The Reader card's last planned stage, the "guided read": the whole paper
taught step by step in the Reader Assistant's chat, each step lit in the
paper as you go. The margin teacher it was planned after was crossed off:
both halves of its sketch had shipped as the Knowledge Graph notes and the
assistant.

- **Two ways in** (Patrick): **Give Lecture On Paper**, by the paper's title
  and outside the assistant, and asking in the chat. In the text it is a red
  button just under the authors; in the PDF it is a margin note on the first
  page in the Knowledge Graph notes' shape, in red (a bar and an outlined
  chip of their size and type), with a red line to the title (stacked with
  the notes and drawn its line by `useMarginNotes`; the title's
  height is found in page 1's text layer by its words, and the PDF always
  keeps the margin's room so the pages don't shift when it appears). A typed
  message goes through `askOrGuideReader`: the Reader's router
  (`/api/assistant/route` in the `reader` view) says lecture or answer. A question about an attached
  passage is never routed. Always the whole paper: a lecture on one section
  was tried and dropped (Patrick).
- **A lecture turn**: `guideReader` streams the beats into the chat as one
  turn (`lectureAssistant`), the lecturer writing them over the paper as the
  assistant reads it (`/api/assistant`'s `guide` workflow,
  `lecturer.guided_read`), told
  the course's check-offs (`courseNames`). Each beat names its passage, its
  exact words and any label ("(1)", "Figure 2").
- **One place per beat** (`beatLight`): a beat about **a whole section**
  lights the section, a beat about an equation, figure, table or algorithm
  lights that, whole, by its label; any other beat, its quote. A section
  rides as a label too, "§6 Conclusion" (Patrick: "the conclusion beat
  should highlight the whole Conclusion section"): in the text, its element
  and its subsections' (`labelElements`), in the PDF its text from its
  heading to the next at its level, figures and running headers left out
  (`services/pdf/passages.py`). Lighting both lit two places a page apart whenever the quote was
  the sentence *naming* the figure ("…described in Algorithm 1."), which
  read as noise (Patrick); after, every SAC beat lit one place, in both
  views, a third of the way down the pane.
- **It follows itself as it is written** (Patrick, as the Citation Graph's
  lecture does): each beat lights and the Reader goes there as it arrives,
  for as long as the reader is following (the lit beat is the one before
  it). Clicking a beat, Back / Next or Esc leaves them where they went, and
  the beats still arriving don't pull them away. The lit beat shows Back /
  Next;
  any beat can be clicked. Its bubble says "Answered as a lecture" by the
  timer, as the Citation Graph's chat does (`lectureAssistant` marks the
  turn `routedTo: 'lecture'`), and folds behind its caret, the newest
  lecture open. The lecture's bubble itself is neither clicked
  nor shown lit (it has nothing of its own to light, and lit, it washed out
  the beats inside it). A beat
  lights like an answer (`store/highlight`'s `passages`, with its `beat`),
  in either view, and the note says when it has no place in the one you're
  in.

## Scrolling that lands (v8.49.0)

Every scroll the Reader makes itself (a contents entry, a citation's
**Reference ↓**, a figure or equation number, a lit passage, a place in the
PDF) goes through `glide`. A smooth scroll fixes its destination when it
starts, so anything that grew above the target while it glided pushed the
target down after the fact, and the scroll landed short (Patrick: "the
scrolling often stops short"). Measured live on Attention: a jump to its
Conclusion landed **1,000px** short. Two fixes:

- **Figures hold their size before they load** (`reservedSize` in
  `ReaderBody`). The CSS sizes a figure by its loaded image (`width` and
  `height: auto`, up to 520px tall), so a lazy one showed as its bare
  20px mat until scrolled near, then grew by up to 500px. Its declared size
  now sets the same box up front, with `aspect-ratio` for a narrower column.
  That alone took the miss to 1px; it also stops the text jumping as you
  read.
- **A glide checks where it landed** and goes the rest of the way if its
  target moved, up to three times, measuring the target afresh each time;
  the moment the reader scrolls (wheel, touch, a key, a click in the pane),
  it lets go. A new glide replaces one still going.

## A box over the PDF (v8.46.0)

Hold ⌥ (Alt) and drag over a PDF page to draw a box, for what a text
selection can't grab: an equation, a figure, a table (`useBoxDraw`, which
draws in either view's frames: the PDF's pages, the text's article). The
highlight menu comes up over it (`SelectionMenu`, labelled "Boxed area",
placed by `pillAnchor`), and it's asked about the way a highlight is,
because a box is a place (`PdfPlace`, from v8.45.0, below):

- **Its words** are read as soon as it's drawn (`/pdf-passage` with
  `places`, the server's `passage_at`), and quoted in the question; a box
  with no words in it, a figure, is quoted as "the boxed area, pictured".
- **Its picture** goes to the model with the question (`render_places`),
  which is what makes an equation or a figure readable to it.
- **The answer lights it** as a highlight's places light, a box on the page,
  kept on the user turn (`ChatMsg.places`).

**⌥-drag only, no button** (Patrick, 2026-10-25): text selection stays the
plain drag and needs no mode, and the box is taught where the Reader's help
lives: the ⓘ at the end of the Text/PDF capsule (`ui/InfoTip`, as the 3D
course explains its navigation; what it says follows the view), the tour's
highlight step, the assistant's tip and the PDF button's tooltip. Holding
⌥ over the PDF turns the pointer into a crosshair (`.reader-boxing`), so
the mode shows before the drag. ⌥ also keeps the browser from starting a
selection (the mousedown is cancelled). A drag smaller than 8px each way is a click, not a box; a
plain click elsewhere, Esc or a menu choice lets the box go, and the menu
follows the page as it scrolls. While drawn and its menu is up the box is a
dashed outline in the selection's accent (`.reader-pdf-box`); once asked
about, it lights in red like any lit passage.

### In the text view: whole elements (v8.48.0)

The same ⌥-drag and dashed box draw over the text's article, for the same
hand in both views (Patrick, 2026-10-25: "more importantly, consistent").
**But not a picture**: the text has nothing to recover, its equations are
LaTeX and its prose text, and screenshotting HTML is heavy and unreliable
under KaTeX. Instead the box **takes the whole elements it touches**
(`textBox.ts`: paragraphs, equations, figures, tables, listings, list items,
headings; the outermost only, never the notes or cards laid over the text)
and, let go, snaps to them. Each reads as a selection over it would
(`readerSelectionText`): an equation as its LaTeX, a figure as its tag and
caption, a table as its cells. **What a box adds is the figures**: an image
can't be selected, so the model never saw one asked about from the text.
Their image sources go with the question (`figures`, kept on the turn as
`ChatMsg.boxedFigures` for a retry), and the server fetches them, held to
the figure proxy's allowlist, and sends them as PNGs, an SVG plot rendered
by pymupdf (`services/reader/figures.py`). The answer lights the passage by
its words, as any text-view passage.

### Across the views: by label (v8.48.0)

A box or highlight made in one view lights in the other (Patrick: "can one
box map to the other view?"). Not by position, which means nothing across
them (the PDF's points against a reflowing column), but by **the labels
both views share**: "Figure 1", "Table 2", "Algorithm 1", an equation's
"(6)". The user turn keeps them (`ChatMsg.labels`), beside its words and
places:

- **Asked in the text**, the labels are the equations and figures the
  selection or box reaches, even in part (`labelsInRange`, `labelsOf`); in
  the PDF the server finds each, a float by the mined manifest's region, an
  equation by its number's line (`/pdf-find` `labels`, `label_places`).
- **Asked in the PDF**, the server reports which labels the highlight or
  box covers (`/pdf-passage` `labels`, `labels_in`), and the text lights
  those elements whole (`labelElements`), its prose by its words as before.
- **What can't map is said, not silently dropped**: an equation without a
  number (its LaTeX is nowhere in a PDF), a label one view lacks, words
  found nowhere. A note over the controls says "Part of this passage isn't
  in the PDF" (or the text) with **Show in text** / **Show in PDF**
  (`.reader-lit-note`, `partMissing`), and switching views goes to it there.
  A passage is only ever "missing" in the view it wasn't asked in.
- **Questions from before labels were kept** read theirs off their own words
  (`labelsInPassage`): a whole equation is quoted as `$$…$$ (2)`, a figure's
  caption as "Figure 1. …". Tried live on a question asked before this
  change: its equation (2) lit in the PDF.
- **Arriving in the PDF lands once the pages' scale has settled**
  (`scrollToPlace`): the pages are sized at once and fit the pane's width a
  moment later, and PdfView keeps the page in view across a change of scale,
  so landing before that put the reader back at the top (seen live).

## An answer lights up its passage (v8.45.0)

The Reader Assistant's answers light the paper's words they're about, as the
Citation Graph's teacher glows the papers an answer cites. Patrick's picks
(2026-10-24): the passages are quotes in the answer, an answer finishing
lights them in place without moving the page, a click goes there, and they
stay lit until something else is chosen.

- **Quotes in the answer.** The assistant wraps the paper's exact words in
  ⟦ and ⟧ (`READING_QUOTES` in the researcher's reading prompt), one to
  three times an answer, prose only. `remarkQuote` turns them into quotes
  underlined in red (`--passage-lit`, the Reader's own `--reader-ink`; gold
  was the first color, but the Knowledge Graph's notes beside the text are
  gold, Patrick, v8.48.0), each a button (a span with the role: a `<button>`
  won't flow inline, and the words after a quote broke onto their own line); a stray marker (a quote still
  streaming) never shows. A question asked from a highlight already knows
  its passage ("Explain this passage from …: “…”"), so that's lit too.
- **What lights it, and when** (`useReaderView`, `store/highlight`'s
  `passages`): **an answer stands for the passage its question was asked
  about**, exactly as highlighted, and an answer to a typed question for its
  quotes (Patrick, 2026-10-25: clicking the answer lit bits of its quotes,
  not the passage he'd highlighted). An answer finishing lights that where
  it is; a click on the answer lights it and goes there (again: puts it
  out); a click on a quote lights just that quote and goes there. Switching
  between the text and the PDF with something lit goes to it in the view
  arrived in (in the PDF once its page is laid out, `scrollToPlace`), and
  clearing the Reader's chat puts it out (`store/highlight`). Esc, or a passage
  the reader highlights themselves, puts them out. The lit answer is marked
  active in the chat.
- **Found in the rendered text** (`passages.ts`) by comparing letters and
  digits only, so case, punctuation, spacing and ligatures don't matter, and
  by its first and last five words when the middle slips (a PDF's hyphenated
  line break). KaTeX's hidden MathML copy isn't read, so a formula counts
  once. **A formula is found by its LaTeX**: a highlighted one is quoted as
  LaTeX (`$…$`, or `glyphs (part of $…$)`), which the page's glyphs never
  match, so the first version lit only the sentence above Patrick's
  equation. Now a passage's formulas are matched to the source KaTeX keeps
  beside each one and lit whole, its prose by its words (`passageParts`,
  `findFormula`).
- **Lit as boxes, a line at a time** (`boxesOf`, `.reader-text-lit`): each
  range's glyph boxes, joined where they share a line (`joinLines`), drawn
  behind the text in the article. The first build lit ranges with the CSS
  Custom Highlight API, which paints every glyph's own box: an equation lit
  as a patchwork of KaTeX's spans, tall and short (Patrick, 2026-10-25). The
  boxes touch no element of KaTeX's or React's, as the Highlight API didn't
  (the vanishing equation highlight, `docs/bugs.md`), and are measured again
  when the column reflows. **Ranges are one per text node, each just its
  matched words**, never one from the quote's start to its end, so what lies
  between two matched words in the DOM isn't lit.
- **The PDF works in places, not text** (Patrick, 2026-10-25: "very
  noisy"). The first build lit the PDF the way it lights the text view, by
  finding words in pdf.js's text layer, and read a highlight out of that
  layer too. But the layer is in the order the PDF was *written*, not read:
  a drag across an equation selected glyphs set elsewhere on the page, and
  quotes lit stray bars. So the PDF view speaks **places** instead, a page
  and rectangles on it in PDF points (`PdfPlace`), the space pdf.js draws a
  page in at scale 1 and pymupdf reads it in on the server
  (`services/pdf/passages.py`):
  - **A highlight is sent as where the drag began and ended**
    (`pdfPlaces.ts`): the left of the selection's first box and the right
    of its last, as points on their pages. The server takes every word
    between them in the PDF's reading order (`/pdf-passage`), across a
    column or a page as it was read, and returns them with their lines'
    rectangles; those words, not the browser's, are the passage the
    question quotes. A first try sent the selection's rectangles and kept
    those between the drag's two heights, which across two columns kept only
    the first and last lines (Patrick: "bits and pieces"). The question
    carries the places too, and the server sends the model **a picture of
    them** with the question, a column at a time, since a PDF's text spells
    an equation as loose glyphs. The user turn keeps them
    (`ChatMsg.places`), so its answer relights them and a retry sends them
    again.
  - **The selection itself stays where the pointer is** (`.endOfContent`,
    from pdf.js's own viewer): while a drag is on, an unselectable sheet
    spreads under the page's words, so letting go over a gap between them
    doesn't end the selection on the text layer itself, at a child in the
    middle of another column. Without it Chrome selected the wrong stretch
    (reproduced in the browser, 2026-10-25); our copy of pdf.js's CSS had
    left it out, with the spans' `z-index: 1` and `user-select: text` it
    needs.
  - **Lit as boxes** (`usePdfPassages`, drawn by `PdfView` under the text
    layer, `.reader-pdf-lit`): the asked-about passage at its places, at
    once; an answer's quotes where the server finds them in its words
    (`/pdf-find`: by letters and digits, else by their first and last five
    words, keeping to the band between). A passage with no places (asked in
    the text view, or before places were kept) is found the same way, by its
    prose and a part-formula's glyphs, which match the PDF's own; its LaTeX
    never could. Places need no page drawn, so going
    to one is a plain scroll.

## The citation cards (v8.43.0)

- **Hover previews, a click pins** (Patrick, 2026-10-24). The card shows
  after the pointer rests 250ms on a citation, so passing over the text
  doesn't flash cards, and stays while the pointer is on the citation or the
  card. A click pins it (the citation's second click unpins); a pinned card
  stays through hovering other citations, until its ×, Esc or a click
  elsewhere (`useAnchoredCard`, shared with the concept cards). It sits in the pane's scrolled content,
  under the citation or above it when there's no room, so it scrolls with
  the text. Its outline is a dim blue, stronger once pinned or focused, as
  a concept card's is in gold (v8.50.0).
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
  **Show in Citation Graph** leaves the way back: the graph shows **Back to
  reading** where its ↑ would be, as a lesson opened from a concept card
  does (`ThreadRecord.returnTo`, v8.49.0). **Reference ↓** marks the entry it
  lands on in the Reader's red (`.landed`), and the mark stays until the
  reader presses anywhere or hits Esc (`markLanded`, v8.49.0; it used to
  fade after 1.6s, before the eye found it).
- **Not in the PDF view.** A PDF's citations are drawn text; see
  `services/reader/README.md`.

## The Knowledge Graph notes (v8.44.0)

Once the paper's Knowledge Graph course exists, each section the course
matters in gets a note: **Builds on** and the concepts it needs, each a
button, a ✓ on the ones checked off. The shape, the placement and the click
are Patrick's picks (2026-10-24): section notes in the margin, placed by one
model call, a card in the Reader.

- **Placed by the tutor** (`/api/knowledge/place`, `routes/knowledge.py`):
  it reads the paper's sections to the contents' depth, paragraph headings'
  text folded into the subsection holding them ("Encoder:" holds Attention's
  layer normalization), and names the sections each concept matters in,
  named or not, most specific first. Cached on the server by the paper and
  the concepts, so `useConceptNotes` asks again only when the course's
  concepts change; check-offs and lessons are read live from the course.
  On Attention it put softmax and dot products in 3.2.1, layer
  normalization and residual connections in 3.1, label smoothing in 5.4.
- **Nothing without a course** (Patrick): no note, no prompt, no request.
- **In the Knowledge Graph's colours** (Patrick): the notes and their chips
  are outlined in its gold (`--knowledge-paper-ink`), and a known concept's
  ✓ is its known green (`--knowledge-known-ink`). The ✓ is always in the
  DOM, so checking off and taking back both animate (it grows in with a
  little overshoot, and shrinks away).
- **Tied to their headings, never piled up** (Patrick, `useMarginNotes`).
  A curve runs from the middle of a margin note's bar to the end of its
  heading's text, barely there in grey until the note is hovered (or holds
  keyboard focus, not a clicked button's lingering focus), when it glows
  gold. In the text view the note is lifted so "Builds on" sits level
  with its heading, and the curve runs along the heading's own line (empty
  past its end) and down the gap beside the column, never across the text:
  the first version cut straight through the paragraph. In the PDF the
  heading's words are found in pdf.js's text layer near its height
  (redrawn when a page's text layer arrives, `PDF_TEXT_DRAWN`) and the
  curve goes straight there. Notes are
  stacked so none overlaps the one above (a narrow PDF margin piled them on
  each other), pushed down just as far as needed; the curve keeps a pushed
  note tied to its heading. Each pass watches every note there is, since a
  PDF's notes arrive with its pages, and a note says when its "+N more"
  opens or closes (`NOTES_CHANGED`): the first version watched only the
  notes there at the start, so an opened note sat over the next one, its
  "Show fewer" out of reach. A note shows its first three concepts and
  "+N more", and a chip's name ends in an ellipsis when it won't fit, the
  tooltip holding it whole.
- **Tied to their headings, never piled up** (Patrick, `useMarginNotes`).
  A faint gold curve runs from the middle of a margin note's bar to the end
  of its heading's text: the section's own heading in the text view, and in
  the PDF the heading's words found in pdf.js's text layer near its height
  (redrawn when a page's text layer arrives, `PDF_TEXT_DRAWN`). Notes are
  stacked so none overlaps the one above (a narrow PDF margin piled them on
  each other), pushed down just as far as needed; the curve keeps a pushed
  note tied to its heading. A note shows its first three concepts and
  "+N more", and a chip's name ends in an ellipsis when it won't fit, the
  tooltip holding it whole.
- **A note's order holds through check-offs.** Chips follow the course's
  order as if nothing were known: the real teaching order prunes what a
  known item needs, so ticking one moved chips around (Patrick saw MDPs jump
  to the front, then the back).
- **One chip lights at a time.** A concept two sections build on is in both
  their notes; a chip's card is keyed by its note as well (`chipId`), so only
  the chip clicked shows as open.
- **In the margin when there's room** (`reader.css`, a container query on
  the pane at 1000px): a 200px column level with the section's heading,
  the text shifting left so the pair stays centred. Narrower, the note sits
  under the heading.
- **A concept's card** (`ConceptCard`, timed and placed like the citation
  card): why the course needs it (`routeWhy`), the first paragraph of its
  lesson when one is written, **Mark as known** (the course's own
  check-off, `knowledgeKnownToggled`: the Knowledge Graph shows it too), and
  **Read lesson in Knowledge Graph** (named for where it goes, since "Builds
  on" alone doesn't say whose notes these are) or **Open in Knowledge
  Graph**, which opens the item
  there (`knowledgeOpened`, `openTool('knowledge')`) with a **Back to
  reading** pill in its ↑'s place (`ThreadRecord.returnTo`, `tools/README.md`).
- **The Reader reopens where you left off** (v8.44.0), in either view: the
  section or page at the top of the pane and how far into it, as a fraction
  of its height (so images loading or pages rescaling don't move it), kept
  as you scroll and saved on the thread when the Reader closes
  (`ThreadRecord.readerPlace`), restored once the view is laid out.
- **In the PDF view too** (Patrick), beside the page at the heading's
  height (`PdfView`'s margin notes; the pages leave 232px for them). A paper
  with a text **reuses the text's placement**, each section matched to the
  PDF's contents entry that heads it (`textNotesInPdf`: by number when both
  have one, else by title, forward from the last match since an outline can
  repeat a title), so the views agree and nothing is asked twice. A paper
  with only its PDF is **placed in the PDF's own contents**
  (`source: "pdf"`, ids `pdf:<n>`, each entry read with the pages it spans).
  A section the PDF has no heading for gets no note there.

## The criticism notes (v8.54.0)

Once the paper's **Criticisms** card has been gathered, a criticism the
field raised about something the paper says or does is noted beside that
passage: **Criticisms** and the criticisms, each by its number and
headline, a button opening its card. Patrick's picks (2026-10-27): the
Knowledge Graph notes' shape ("just like we do for the knowledge graph"),
pointing at **the passage itself**, only **once a card exists**, and a
**card, then the criticism** on a click.

- **Pinned by the reviewer** (`POST /api/reviews/notes`,
  `services/reviews.notes`, `reviewer.place`): it reads the paper's sections
  (the same ones the Knowledge Graph placer reads, `services/reader/
  sections.py`) and the card's criticisms, and for a criticism about
  something in the paper quotes the passage, word for word. Not every
  criticism gets one: one about what the paper never tried, or the field
  after it, has nothing to point at ("a wrong pin is worse than none").
  **Code checks every quote** against its section's text (letters and
  digits, as `passages.ts` compares), so a note always points at the
  paper's own words; at most two pins a criticism. Cached with the card, by
  its criticisms: a card gathered again is pinned again.
- **Nothing without a card** (Patrick). The route reads the card's cache
  only (`services/reviews.cached`) and never starts the half-minute gather;
  without a card it answers `{card: null, pins: []}` and no model is asked.
- **One note per passage.** Pins quoting the same words share a note,
  their criticisms in number order (`notesOf`).
- **Tied to the passage, not the heading.** The note finds its quote in its
  own section (`findQuote`, the text index that skips the notes themselves)
  and registers where it is (`noteAnchors`, `useMarginNotes`): the margin's
  layout sets its label level with the passage's first line, stacked with
  the Knowledge Graph notes like any other, and its curve starts in the gap
  beside the column at that line, never across the text. Narrow, it sits
  under its section's heading like the concept notes.
- **Hover lights the passage** in the card's sage (`.reader-text-lit.
  criticism`), and the curve glows sage: the passage it means is never a
  guess.
- **In the PDF view too.** The pins' quotes are found in the PDF's own
  words by the server (`/pdf-find`, `useCriticismPdfNotes`), so the text's
  pins serve the PDF and nothing is asked of the model twice; each note
  sits beside its page at its passage's line, its curve to the passage's
  end, its passage lit in sage over the page (`PdfView`'s `marked`). A
  quote the PDF doesn't have has no note there. A paper with only its PDF
  is pinned in the PDF's own contents (`source: "pdf"`).
- **A criticism's card** (`CriticismCard`, timed and placed like the
  citation card, in sage): its number and headline, how many papers raise
  it, its summary, its most-cited quote with the paper that wrote it, and
  **Read in Criticisms**, which opens the Criticisms card scrolled to that
  criticism (`criticisms/focus.ts`) with **Back to reading** in its ↑'s
  place (`tools/ReturnPill`, drawn by `ScrollNav` there).

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
  `docs/bugs.md`). **Zoom** (v8.44.0, Patrick: a small window shrank pages
  past reading): − and + in the same capsule as the Text/PDF switch, past a
  thin divider (two pills side by side looked like a pair). Switching to the
  PDF grows the zoom out of the switch, left to right, and switching back
  folds it away (its column animating from nothing to its width; `inert`
  while folded); every button in the capsule is one height, so nothing
  resizes as it comes and goes. The steps run through multiples
  of fitting the width, 50% to 300%, and the percentage goes back to
  fitting; a page wider than the pane scrolls sideways (`align-items: safe
  center`). Whatever changes the scale (zoom, the pane's width, room made
  for notes), the page at the top stays there, the same fraction down: its
  place is tracked as the reader scrolls. Pages fit the pane's width, up to 900px, **once the
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

- **The assistant is the one assistant, beside the Reader.** Since v9.0.0
  (stage 3 of the OnePager's "One assistant") there is one panel for every
  view (`teacher/Teacher`), docked right or along the bottom, behind the
  floating astronaut when closed; `useReaderView.ts` and `askReader.ts` give it the
  Reader's words and what to send (`assistant/views`). It talks in the
  dock's chat (`store/chats`; until v9.0.0 a Reader chat of its own), and
  only the answers to questions asked beside this paper's Reader light
  passages in it (`AnswerPassages.owns`).
- **It reads the paper, not a summary.** `askReader` sends only the arXiv id
  and the section in view; the server lays the paper out from the document
  it cached for the Reader (`assistant/context.py`, `reading_context`): the
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
- **The contents rail is shared** (`contents/ContentsRail`, since the
  Criticisms card wanted one too, 2026-10-27): its look, the fold, the drag
  and the slide are told in `contents/README.md`. The Reader lends it the
  coral (`--contents-ink`), its entries (the sections to depth 3, or the
  PDF's outline) and which is active, remembers it under
  `ca.readerContentsOpen` / `ca.readerContentsWidth`, and plays the glide on
  `.reader-main` (`.glide-open`/`.glide-close`, the shared
  `contents-glide-*` keyframes).
- **The shell's overlays sit over the reading pane** (`.reader-main`), not
  the whole Reader, so the ↑ back to the cards centres over the text, not
  over text and contents together, and stays put as the text scrolls. Since
  v8.50.0 the Reader draws that button itself (the app leaves it out for
  the Reader; the shared `tools/ScrollNav` since Criticisms wanted it too): the ↑ within 120px of the top (`AT_TOP`), and below that a
  **Back to top** pill, words alone until the pane is narrow and then just
  its icon, gliding back to the top. It replaced the contents panel's own
  Back to top. (A ←
  was tried and dropped; `tools/README.md` has the story.) The top-right
  corner was kept free for the Reader's own 🎓 until v9.0.0; the one
  assistant's 🎓 floats wherever the reader leaves it
  (`assistant/AssistantLauncher`).
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
or not, its actions and its jump to the reference), the Knowledge Graph
notes (placed beside their sections in course order, none and no request
without a course) and a concept's card (its lesson's opening, the
check-off, the way to the lesson), the criticism notes (asked for the
thread's paper, beside the passage's section, none without a card, in the
PDF only where the server finds the passage) and a criticism's card (its
summary and quote, Read in Criticisms setting the way back and the
criticism to open at), an answer's passages (lit in the text,
gone to only when asked, put out by Esc; set by the Reader Assistant as an
answer finishes, by a click on the answer and on a quote), a footnote opening,
a figure enlarging, an algorithm's numbers and indents, the contents
resizing and folding by a drag and coming back only by the bump, and each
unavailable state, including the retry, and the PDF view with pdf.js
stubbed: the fallback with its outline as the contents, the switch and its
remembered choice, a chosen PDF that won't open, a highlight's page, a
PDF highlight asked about in the PDF's own words with its places sent and
kept, and the PDF's lit places (the passage's at once, the quotes the
server finds, an older turn's passage found by its words).
A box drawn with ⌥-drag (only with ⌥, and not as a click) is read, asked
about by its place and kept on the turn, and a box with no words is quoted
as its picture. A box over the text snaps to the equation and figure it
touched and asks with the LaTeX, the caption and the figure's image, kept on
the turn; `test/reader/textBox.test.ts` pins what a box takes (the outermost
element, never a note).
`test/reader/CriticismNote.test.tsx` covers a note's chips by number, its
passage found in its section and lit on hover, its anchor registered, and
its PDF places; `test/reader/useCriticismNotes.test.ts` the pins grouped
into notes. `test/reader/passages.test.ts` covers reading quotes out, finding them
however the text differs, and lighting them; `test/reader/pdfPlaces.test.ts`
a highlight's rectangles as places, kept to the band its drag spans. The
server's half is `test/curious_astronaut/services/pdf/test_passages.py`
(over a real PDF). The parse itself is
covered by `test/curious_astronaut/integrations/arxiv/test_document.py`.
