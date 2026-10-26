# services/pdf — open-access PDF mining

Full text and figures for papers **ar5iv can't serve**: journal papers that
were never on arXiv, and the occasional arXiv paper whose LaTeX ar5iv failed
to render. When a provider knows an open-access PDF for the paper (S2's
`openAccessPdf`, an OpenAlex location's `pdf_url`) — or the paper is on arXiv,
whose `arxiv.org/pdf/<id>` is always open — this package downloads the file
once and mines it with pymupdf.

```
resolve.py — where the paper's OA PDF lives (arXiv → primed URL → provider), cached
fetch.py   — the download + on-disk cache (data_dir/pdf_cache, LRU-pruned)
text.py    — readable body text from the file (the ar5iv fulltext's PDF twin)
floats.py  — caption-anchored float mining: figures, tables, algorithms
mine.py    — the cached high-level API the app calls; token → URL registry
passages.py — passages by where they sit: a highlight's words, quotes' boxes, crops
errors.py  — PdfError, the package's one exception
```

## Who uses it

* **`routes/graph.py`** — `/api/paper/<ref>/figures` falls back
  ar5iv → the mined **figure manifest**; `/api/pdf_figure/<token>/<n>` serves
  a manifest entry as a rendered PNG; paper hydration `prime()`s the resolver.
* **`agents/researcher/tools.py`** — `read_paper(detail="full")` falls back
  ar5iv → `get_pdf_text`, and `show_figure` draws from the same figure
  manifest the full read printed.

**The figure manifest** is what mining a PDF produces and caches
(`pdffloats:<token>`): one entry per float, each just four fields — `kind`
(`figure`/`table`/`algorithm`), 1-based `page` number, `caption`, and the
`region` rectangle (`[x0, y0, x1, y1]` in page points). No pixels are stored:
images are rendered from `page`+`region` on demand.

> **Storage rationale in depth:** [docs/pdf-mining.md](../../../../docs/pdf-mining.md)
> — why the PDF is the cache and text/manifest/pixels are derivatives, why the
> derived caches carry a TTL over an immutable paper, and what dpi has to do
> with keeping the source.

## The geometry, precisely

How `floats.py` turns a page of ink into figure regions — with the
terminology the code (and the tuning constants) use.

First, the two nouns that name the pipeline's input and output. A **float**
is typography's term for a figure, table, or algorithm block — content that
"floats" free of the text flow to wherever the layout fits it, carrying a
caption. It's what this module hunts, hence the filename. The **figure
manifest** is what the hunt produces and caches: the list of found floats,
one entry each (`kind`, `page`, `caption`, `region`). Floats are the things;
the manifest is the record of them.

All coordinates are in **points** (pt): PDF's native unit, 1/72 inch, origin
at the page's top-left.

**The raw material.** pymupdf exposes three kinds of ink on a page:

- **Text blocks** (`page.get_text("blocks")`) — paragraphs/lines of text,
  each with a bounding rectangle. Captions are found here.
- **Embedded images** (`page.get_images` + `get_image_rects`) — raster
  pictures (photos, plot PNGs) placed on the page, each with the rectangle
  it's drawn into.
- **Drawings** (`page.get_drawings`) — vector strokes: every line, curve,
  and filled shape as its own tiny rectangle. A matplotlib plot is hundreds
  of these; so is a hand-drawn diagram. pymupdf's `page.cluster_drawings()`
  groups strokes that touch or nearly touch (~3 pt) into **drawing
  clusters** — one rectangle per connected clump of ink. Crucially, a
  *sparse* diagram (arrows and circles with whitespace between them — a
  backup diagram) comes back as MANY small clusters, not one big one.

**Special drawings.** A **hairline rule** is a drawing whose rectangle is
almost flat (height ≤ 3 pt) and wide (≥ 100 pt) — the horizontal lines that
bound tables and algorithm boxes. (pymupdf quirk: such a rectangle is
*empty* — zero area — and `Rect.__or__` silently ignores empty operands, so
rule spans are assembled from raw min/max coordinates, never `|`.)

**Step 1 — find captions.** Every text block matching `CAPTION_RE`
(`Figure N:` / `Fig. N.` / `Table N:` / `Algorithm N`) is a **caption
block**. The trailing `[:.]` is load-bearing for Figure/Table: an in-prose
cross-reference ("Figure 2 provides…") starts with the same words but has no
separator. Algorithm captions carry no separator; their filter is the rule
anchor below.

**Step 2 — collect content candidates.** The page's **candidate rectangles**
are every embedded-image placement at least `_MIN_TILE` (30 pt) on a side,
plus every drawing cluster with area ≥ `_MIN_CLUSTER_AREA` (100 pt²). This
floor is a **dust filter** and nothing more — it drops stray specks (a
6×6 pt fleck is not evidence of anything) while *keeping* the small pieces
sparse diagrams are made of. It was originally 4000 pt², which silently
discarded every piece of Sutton & Barto's backup diagrams (each arrow
column is a few hundred pt²); the lesson — filter dust at the input,
judge *size* only on the finished answer — is written up in `docs/bugs.md`.

**Step 3 — seed a region from the caption.** For a figure caption, look
ABOVE it (fall back to below): every candidate whose bottom edge is within
`_GAP` (60 pt) of the caption's top edge and which overlaps the caption
horizontally becomes a **seed**. The union of the seeds is the initial
**region** — one rectangle that will grow.

**Step 4 — grow by axis-aware chaining.** Repeatedly, any remaining
candidate for which `_chain_near(region, rect)` holds is unioned in, until
nothing more joins. `_chain_near` is deliberately looser than "touches":
a piece joins when it **overlaps the region in one axis** and sits within
`_CHAIN_GAP` (60 pt) of it **in the other**. Contact-only chaining (the
first implementation, an 8 pt pad) handled subfigure tiles that touch, but
couldn't walk a sparse diagram whose pieces sit 40–60 pt apart and relate
*diagonally* — from one seeded arrow column it never reached the rest.
Axis-aware chaining climbs column to column: each newly joined piece
extends the region, which brings the next piece within reach.

**Step 5 — judge the answer.** The grown region must have area ≥
`_MIN_REGION_AREA` (4000 pt²) — the **region floor**. This is where junk
actually dies: a lone underline or footnote rule near a caption may seed a
region, but it can't *grow* one of figure size, so it's rejected. The two
floors work as a pair: the dust filter keeps the inputs honest, the region
floor keeps the answers honest, and everything in between is allowed to be
small.

Tables and algorithms take different step-3/4 routes (in `_table_region` /
`_algorithm_region`): tables try pymupdf's `find_tables` bounding box, then
a **rule span** — consecutive hairline rules of the same width walking away
from the caption, the anatomy of a booktabs table — then a drawing-skeleton
cluster widened to the caption's x-span; algorithms take the region between
the full-width rule directly above their caption and the last same-width
rule below it. Both include their caption in the rendered clip (it's part
of the float's visual identity); figures don't (theirs is displayed as the
card text instead).

**Known misses**, all shapes with no geometry to anchor: floats made purely
of text (no image, drawing, or rule — pseudo-code "figures" in very old
PDFs), and truly uncaptioned inline graphics. Edge text labels of a figure
(axis names hanging outside the drawn ink) can also clip, since text blocks
never join the union.

## Design decisions worth knowing

* **Caption-first mining.** A PDF has no semantic markup, so floats are
  found from their captions and the caption anchors the content region —
  the full pipeline, with its terminology, is the "The geometry, precisely"
  section above. The caption doubles as the junk filter: uncaptioned
  drawing clusters (decorations, stray rules) are never shown. Mining caps
  are the caller's: paper-sized for OA papers (`config.pdf.research_papers`),
  book-sized for uploaded library PDFs (`config.pdf.library_documents`) — one
  sub-object per corpus, because paper-tuned limits were silent data loss
  on textbooks.
* **Renders, not embedded images.** A manifest entry is served by rendering
  its page region to PNG at `config.pdf.render_dpi` — vector figures
  (matplotlib, TikZ) have no embedded image to extract, and a render treats
  raster and vector floats identically.
* **Tokens, not URLs, in the browser.** Image URLs are
  `/api/pdf_figure/<token>/<n>` where the token is a hash of the PDF URL,
  resolvable only through the server-side `pdfurl:` registry written when a
  PDF is mined. The browser never supplies a URL, so the route can't be used
  as an open proxy (the same SSRF posture as the ar5iv figure proxy).
* **Everything is cached, misses included.** The file on disk
  (`pdf_cache/` — `oa_pdfs/` until v7.22.1, renamed because "oa" read as
  OpenAlex when it meant open-access; LRU beyond `config.pdf.cache_files`),
  the mined text/floats
  and the resolver's answers in the SQLite cache for a month (published PDFs
  are immutable) — including "no PDF"/"nothing mined", so a barren paper
  isn't re-mined on every panel open. Transient provider failures are the
  one thing **not** cached.
* **pymupdf trap, learned the hard way:** a hairline rule is an *empty* rect
  (zero height) and `Rect.__or__` silently ignores empty operands — rule
  spans are built from raw min/max coordinates, never `|`.

## How it's verified

Offline, like the whole suite: `test/curious_astronaut/services/pdf/` builds synthetic
PDFs with pymupdf in-test (drawn figures, ruled algorithm boxes, booktabs
tables, prose decoys) and runs the real geometry pipeline over them; the
fetcher's network is a monkeypatched `urlopen`. The extraction heuristics
were tuned against three real PDFs (JMLR's LDA paper — vector-only figures;
Attention Is All You Need — raster figures + booktabs tables; PPO — algorithm
floats and rules-and-ticks appendix tables): 33 of 35 real floats mined with
correct captions, the two misses both text-only floats.

## The Reader's PDF view (v8.40.0)

The Reader shows a paper as its PDF when it has no HTML render, or when the
reader chooses to. Two additions serve it, both on the same cache:

- **`paper_pdf_url(ref, provider)`** (`resolve.py`): arXiv's PDF for an arXiv
  id (always open, no provider lookup), else `resolve_oa_pdf`. The route
  `/api/paper/<ref>/pdf` (`routes/graph.py`) resolves with it and serves the
  file from `fetch_pdf`'s cache, so pdf.js reads same-origin bytes and the
  paper is downloaded once. Serving needs no optional extra.
- **`get_pdf_contents(url)`** (`mine.py`, cached as `pdfcontents:v2:<token>`; the
  logic in `headings.py`): a table of contents for the PDF view, its outline
  when it has one, else the section headings found in its text. Many arXiv
  PDFs carry no outline (Adam's and SAC's don't), so the heuristic matters: a
  heading is a short line set larger or bolder than the body that is numbered
  ("3.2", "B.1") or a standard unnumbered one (Abstract, References). It
  joins a number set apart from its title on one baseline (Attention, Adam),
  spaces small caps from the gaps between spans (Adam), takes a wrapped
  heading's second line (SAC), and shows ALL CAPS in sentence case. On
  those three papers it found every section: Attention's headings match its
  own 22-entry outline. Every entry carries `top`, how far down its page
  the heading sits (points from the top edge), so the Reader can jump to the
  right one of two sections starting on one page: a found heading's own
  line, an outline entry's destination, which PyMuPDF reads back bottom-up
  for a named destination (hyperref's) and top-down for a direct one.
  Synthetic PDFs pin each case
  (`test/curious_astronaut/services/pdf/test_headings.py`).
- **`get_pdf_pages(url)`** (`mine.py`, cached as `pdfpages:<token>`): the text
  page by page (`text.extract_pages`), for the Reader assistant's "page in
  view". `extract_text` is now the pages joined. Needs the `pdf` extra; a
  missing extra raises `MissingExtra` and isn't cached, so installing it takes
  effect at once.

## Passages by place (v8.45.0)

The Reader's stage 6 lights the passages an answer is about. In the PDF view
it first found them by matching words in pdf.js's text layer, and read a
highlight out of that layer too; but the layer is in the order the PDF was
written, not read, so a highlight across an equation picked up glyphs set
elsewhere, and quotes lit stray bars (Patrick, 2026-10-25: "very noisy").
`passages.py` answers by **place** instead: a 1-based page and rectangles on
it in points from the page's top-left, which is how pdf.js lays a page out at
scale 1, so the browser and pymupdf point at the same spot. It works from
pymupdf's words, which come in reading order with their boxes:

- **`passage_between(path, start, end)`**: a highlight as the reader
  dragged it, every word from the one nearest where the drag began to the
  one nearest where it ended, in reading order, read out as text (a hyphen
  broken across lines rejoined), with their lines' rectangles. So a passage
  across a column or a page reads whole: a first try read the words inside
  the browser's rectangles kept between the drag's two heights, which in
  two columns kept only the first and last lines. Served by
  `POST /api/paper/<ref>/pdf-passage`; the Reader quotes these words, not
  the browser's.
- **`passage_at(path, places)`**: the words whose centers sit in some
  rectangles, the same way; what `/api/ask_reader` reads a highlight's
  places with, and what a box drawn over the PDF (v8.46.0, ⌥-drag) is read
  by.
- **`find_quotes(path, quotes)`**: each quote's places, matched by letters
  and digits only (ligatures spelled out), else by its first and last five
  words, keeping only words in the band between them on the page. Served by
  `POST /api/paper/<ref>/pdf-find`.
- **`render_places(path, places)`**: a PNG per page and column of a
  highlight (the box around that column's rectangles, padded), sent to the model with the question by
  `/api/ask_reader` so it reads an equation from the picture.

- **`label_places(path, floats, labels)` / `labels_in(path, floats, places)`**
  (v8.48.0): the labels both of the Reader's views share, "Figure 1",
  "Table 2", "Algorithm 1", "(6)", so a passage asked in one view lights in
  the other. A float is found by the mined manifest's region, matched by its
  caption's opening (`float_label`); an equation by its number, a word of
  its own that closes its line (prose citing "(6)" goes on past it, and the
  other column, across the gutter, doesn't count), lit as its column's words
  at that height, the column being the span of the lines that reach the
  number. Served by `/pdf-find` (`labels` in, `labelled` out) and
  `/pdf-passage` (the `labels` a passage covers).
  **A whole section** is a label too, "§6 Conclusion" (a lecture's beat about
  a section, v8.50.0): found in the PDF's contents (its outline, else its
  found headings) by number, else by title, it runs from its heading's words
  to the next heading at its level or above, **in reading order**, so across
  columns and pages (a heading's height alone misleads: in two columns, 4
  sits above 3.2 on the page). Its figures' regions are left out (their
  axis numbers and legends lit as stray marks), and so, when it crosses
  pages, is the page furniture (`_page_furniture`): running headers, the
  same words at a page's edge on two pages or more, and bare page numbers
  at its foot. A fixed band at the edges was tried and cut real text: SAC
  has no page numbers, and its last line sits at the very bottom.

Nothing is stored, as with figures (`docs/pdf-mining.md`): the words are
memoized in process for the last four files (by path and mtime), since one
answer asks for them more than once. Tested over a real synthetic PDF
(`test/curious_astronaut/services/pdf/test_passages.py`).
