# `services/reader`

The Reader card's backend services, beyond the document itself (parsed in
`integrations/arxiv/document.py`) and its PDF (served by `services/pdf`):
what joins the paper being read to the rest of the app.

## `citations.py` — the citation cards (v8.43.0)

`get_citations(arxiv_id, provider)` matches each entry of the paper's
bibliography to the paper it names, so a `[12]` in the Reader can show that
paper and open it (`GET /api/paper/<arxiv_id>/cited`). It returns
`{bibliography entry id: node}`, cached a day as
`readercites:v1:<provider>:<arxiv_id>`.

- **Matched against the provider's own reference list** for the paper: Semantic
  Scholar's, or OpenAlex's for an OpenAlex thread, so a matched paper's id is
  one that thread's Citation Graph, detail panel and `openPaper` all know.
  The reference list and the bibliography are the same papers; matching them
  is the job (settled with Patrick, 2026-10-23).
- **By evidence in the entry's text, strongest first:** an arXiv id written
  in it (`arXiv:1607.06450`, `abs/1409.0473`, or in a link) equal to a
  reference's, then the reference's whole title found in it, compared as
  lowercase words. Titles under three words aren't matched on alone: "Adam"
  or "Dropout" appear in other entries. Each reference matches one entry at
  most.
- **Hydrated in one batch on S2** (`get_papers`, the detail fields), so a
  card has authors, venue and TL;DR without a request of its own. OpenAlex's
  reference nodes go out as they come; the card shows what they carry.
- **A nicety, never an error:** the route answers `{papers: {}}` for a paper
  not on arXiv or a provider that's down, and the card shows the
  bibliography's own text. A failed lookup isn't cached.
- **The PDF view has no cards.** Its citations are drawn text; parsing a
  PDF's reference list properly needs something like GROBID, a Java service,
  wrong for an easy install (OnePager, settled 2026-10-23).

Verified by `test/curious_astronaut/services/reader/test_citations.py`
(matching on the real shapes of Attention's and SAC's bibliographies, the
cache, the providers, all offline) and the route's tests.

## `figures.py` — figures boxed in the text (v8.48.0)

`figure_pngs(sources)` turns the figures a box over the Reader's text took
into PNGs for the model, which `/api/ask_reader` sends with the question.
An image can't be selected, so before the box the model only ever saw a
figure's caption.

- **Held to the figure proxy's allowlist.** The Reader sends the image
  sources as the page shows them, our proxy's URLs (`/api/figure_proxy?src=`);
  each is unwrapped and checked with `arxiv.is_render_url` (ar5iv, and
  arXiv's HTML render) before anything is fetched, so a question can't make
  the server fetch anywhere else.
- **Every one a PNG.** Many renders draw their plots as SVG (all of SAC's
  results), which the model can't take; pymupdf (the `pdf` extra) renders
  SVG, JPEG and the rest to PNG, an SVG at twice its size to stay legible.
  Without the extra only PNGs go.
- At most eight images a question (SAC's results figure is six panels; a
  cap of four cut it short); anything refused, unfetchable or
  unreadable is left out, never an error.

Tested with a real SVG rendered by pymupdf (`test_figures.py`).

## `sections.py` — the paper as a placer reads it (v8.54.0)

`paper_sections(paper, source, provider)` is what the margin notes' model
calls read: the Knowledge Graph placer (`/api/knowledge/place`) and the
reviewer's pins (`/api/reviews/notes`). Moved out of `routes/knowledge.py`
when the second one needed it.

- **The text** (`text_sections`): the arXiv render's sections down to
  `DEPTH` (subsubsections, as deep as the Reader's contents), each with
  the text of the deeper ones under it folded in. A paragraph heading
  ("Encoder:") is a section of its own in the document, and its text belongs
  to the subsection it sits in.
- **The PDF** (`pdf_sections`), for a paper the Reader can only show as a
  PDF: its contents entries as `pdf:<n>`, each with the text of the pages it
  spans (at most `PDF_PAGES`), the reference list left out; empty without a
  PDF, contents or the `pdf` extra.

Its ids are the Reader's own (document section ids, or the n-th entry of
`/pdf-contents`), which is what lets a note land where it was placed.
Tested through both routes (`test_knowledge.py`, `test_reviews.py`).
