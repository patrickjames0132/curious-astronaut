# `routes`

The Flask API surface: one blueprint per concern, wired onto the app by
`register_blueprints` (called from the app factory). Every route carries its
full `/api/...` path — no blueprint URL prefixes — so the registry order is
cosmetic.

Route modules are thin: parse/validate the request, call one service or
integration, map its outcomes onto HTTP. Anything thicker belongs a layer
down.

## `graph.py` — the canvas and the detail panel

| Endpoint | Job |
| --- | --- |
| `GET /api/graph?seed=&refresh=` | build (or re-fetch) a seed's neighborhood graph |
| `GET /api/graph/stream?seed=&refresh=` | same, as SSE with coarse build-stage progress |
| `POST /api/graph/expand` | one hop of references or citations from any paper on the graph, for the detail panel's Expand buttons (v8.18.0) |
| `POST /api/graph/links` | the citations among the papers on a graph, for the "Links between papers" switch (v8.18.0) |
| `GET /api/paper/<ref>` | hydrate one paper's details for the panel |
| `GET /api/paper/<ref>/figures` | the paper's figures — ar5iv, else floats mined from its OA PDF |
| `GET /api/paper/<ref>/document` | the paper as a structured document for the Reader card (v8.37.0; arXiv's HTML first, ar5iv as the fallback since v8.39.0) |
| `GET /api/paper/<ref>/cited` | the Reader document's bibliography matched to the papers it names, for its citation cards (v8.43.0; `services/reader/citations.py`): `{papers: {<entry id>: node}}` by the `provider` query arg's reference list; a nicety, `{papers: {}}` on any failure |
| `GET /api/paper/<ref>/pdf` | the paper's PDF from the local cache, for the Reader's PDF view (v8.40.0): arXiv's for an arXiv id, else the provider's open-access PDF; 404 with none, 502 when the download fails |
| `GET /api/paper/<ref>/pdf-contents` | the PDF's table of contents (v8.40.0): its outline, else headings found in its text, each entry `{title, level, page, top?}`; a nicety, `{source: "none", entries: []}` on any failure. A distinct suffix, not `…/pdf/contents`, so the `<path:>` rule for `…/pdf` can't swallow it |
| `POST /api/paper/<ref>/pdf-passage` | what a highlight in the PDF view covers (v8.45.0): `{span: {start, end}}` in (where the drag began and ended, in points; or `{places}`, rectangles to read inside: a box drawn over the PDF, v8.46.0), `{text, places}` out, the PDF's own words from one end to the other in reading order, across columns and pages, and their lines' rectangles (`services/pdf/passages.py`); a nicety, empty on any failure |
| `POST /api/paper/<ref>/pdf-find` | where an answer's quotes are in the PDF (v8.45.0): `{quotes}` in, `{found: [[place]]}` out, one list per quote; a nicety, nothing found on any failure |
| `GET /api/paper/<ref>/code` | Hugging Face code & artifact links |
| `GET /api/paper/<ref>/categories` | the paper's own arXiv category tags |
| `GET /api/pdf_figure/<token>/<n>` | one mined PDF float, rendered to PNG |
| `GET /api/figure_proxy?src=` | same-origin relay for ar5iv images |

Design decisions worth knowing:

- **Two failure philosophies, on purpose.** The load-bearing endpoints
  (graph, paper) map failures to real HTTP: 400 (no seed), 404 (S2 knows no
  such paper), 502 (S2 down, with a user-facing "try again"). The panel
  niceties (figures, code) instead degrade to `available: false` on ANY
  upstream failure — a missing figure strip must never 500 the panel. The
  Reader's `/document` follows the niceties and adds a `reason`
  (`not_arxiv`, `no_render`, `error`) so the card can say which it was.
- **Growing a graph needs no agent (v8.18.0).** `/api/graph/expand` is the
  reader's twin of the researcher's `expand_node`, with the same "only real
  edges" rule, but sized like the seed's own neighbourhood
  (`services.graph.growth.hop_hits`): every reference, and the citers the tau
  rule picks over the paper's whole history. It takes the reader's build
  shape as query args, parsed by the same `_requested_shape` as the graph
  stream, and an optional `arxiv_id` in the body for the corpus to resolve
  on. Until v8.18.0's polish it took the researcher's `expand_limit` (8) per
  hop from a 100-paper pool, its citers the newest page of S2's live endpoint.
  The client sends `known_ids` so the hop can tell new papers from ones
  already drawn, which only gain an edge. `/api/graph/links` hands its
  ids to `services.graph.growth.links_between`. Both map a provider failure
  to 502, like the build. The decisions themselves live in
  `services/graph/growth.py`; the routes only fetch and serialize.
- **`/api/graph/stream` is the determinate-progress twin of `/api/graph`.**
  Same result, delivered as SSE so the frontend overlay shows a real filling
  bar instead of a bare spinner. `build_graph` reports five coarse stages
  through an `on_progress` callback; `_build_stream` runs it in a worker thread
  and bridges each callback onto a queue the generator drains into
  `progress`/`done`/`error` frames — the exact pattern `sources.py` uses for
  ingestion. Two consequences fall out of the streaming shape: (1) build
  failures surface as `error` **frames**, not HTTP status (the connection is
  already 200/streaming by then), so only a *missing seed* is still a pre-stream
  400; (2) the generator and its worker must use the **module logger**, never
  `current_app` — they run after the request context is gone (see `sse.py`).
  A cache hit fires no `progress` frames (`build_graph` returns before the first
  stage), so the stream jumps straight to `done`. The blocking `GET /api/graph`
  stays for compatibility and non-streaming callers.
- **`normalize_arxiv_id` extracts; `looks_arxiv` discriminates.** The entry
  filter uses `ID_RE.search` to pull an id out of pasted text (URL-wrapped,
  version-suffixed, whatever); the S2 lookup then uses
  `arxiv.looks_arxiv()` (`fullmatch`) to decide whether the `ARXIV:` prefix
  applies. The old route prefixed unconditionally — which broke panel
  hydration for papers that exist on S2 but not on arXiv (their nodes
  hydrate by raw paperId). Fixed in this port, mirroring `build_graph`.
- **Why arXiv ids at all, when the data all comes from S2?** Because the
  arXiv id is how *humans* hand us papers — recognizing it is input
  handling, not an arXiv dependency. The chain: (1) **paste-recognition** —
  the dominant flow for ML papers is copying `arxiv.org/abs/...` from a
  browser or a tweet; unrecognized, that string would fall through to S2's
  lexical search as junk keywords and find nothing, while a recognized id
  is a statement of intent that skips search and lands on that exact paper.
  (2) **S2 addressing** — S2's own lookup API takes `ARXIV:<id>` as an
  external identifier, so normalization is just translating the reference a
  human gave us into the key S2 wants (accepting an ISBN without being a
  printing press). The version strip belongs here too: `v5` and `v2` are
  the same paper to S2 and to our cache keys. (3) **ar5iv rendering** —
  a node's `arxiv_id` is the ticket to figures and full text. (4) the arXiv
  **category tags** (`/api/paper/<ref>/categories`) — S2 doesn't carry a
  paper's own category codes, so this is the one detail-panel field arXiv's
  metadata (not S2) supplies. Retiring arXiv *search* removed none of these.
- **`/api/graph` serializes the typed `Graph`** via `model_dump()` — the
  route is the model-to-JSON boundary (Phase 3 decision: the graph is a
  Pydantic model everywhere inside the app).
- **The figure proxy is an SSRF chokepoint.** `is_render_url` allowlists the
  render hosts before any fetch (ar5iv's, and `arxiv.org/html/…` since
  v8.39.0, when arXiv's own HTML became the first source), so
  `/api/figure_proxy` can't be used as an open relay; responses carry a day-long `Cache-Control`. Since v8.37.0 they
  also carry a sandboxing `Content-Security-Policy` and `nosniff`: the bytes
  are a paper author's (the Reader shows SVG figures), served from our origin,
  so one opened directly must not run script here. Inside an `<img>` the
  headers change nothing. This is the
  same-origin contract behind both the detail panel's figure strip and the
  researcher's `show_figure` payloads. Its figure-manifest sibling
  `/api/pdf_figure/<token>/<n>` holds the same posture a different way: the
  browser sends an opaque token (minted server-side when a PDF was mined,
  resolved through the cache's `pdfurl:` registry), never a URL — unknown
  tokens simply 404.
- **`/api/paper/<ref>/figures` chains two sources.** The ar5iv render (real
  `<figcaption>`s) when the paper has one; else the paper's open-access PDF
  is fetched and mined (`services/pdf` — caption-anchored figures, tables,
  and algorithm boxes). An arXiv ref falls back to `arxiv.org/pdf` directly;
  a non-arXiv ref resolves its OA URL through the `provider` query arg's
  backend, which paper hydration usually pre-primed.
- **`/api/paper/<ref>/categories` is a panel nicety, not load-bearing** —
  same degrade-to-`available: false` contract as figures/code (a bad id, a
  raw S2 paperId with no arXiv metadata, or an arXiv outage all look the
  same to the frontend). Labels each code via `arxiv.vocab.name_for`.

## `search.py` — finding a seed paper

| Endpoint | Job |
| --- | --- |
| `GET /api/search?q=&provider=&limit=&year_from=&year_to=&fields=` | paper search (SSE): the paper scout, run alone, with the `@` typeahead's nickname resolve running alongside it |
| `GET /api/mentions?q=&provider=&source=` | the composer's `@` typeahead. `source=local` is the cache-only answer (plain JSON) the composer fires per keystroke; the full one **streams** (`step` frames then `result`), adding a day-cached provider search, a relevance re-rank across both, and — when no title matches exactly — a nickname resolve through one cached model call |
| `GET /api/taxonomy/<provider>` | a provider's field vocabulary (`s2` / `openalex`) |

Design decisions worth knowing:

- **`/api/search` is the paper scout now** (v7.6.0) — the same worker the
  researcher sends out, with the orchestration layer skipped. It replaced
  `services.search.live_search` (query-analyst expansion → verified titles →
  one lexical search), which was a second implementation of a thing the scout
  already did better: it reformulates rather than expanding once, and it
  resolves recalled titles through its own `match_title` tool. Two paths to
  one source is the bug, not the feature. `query_analyst` was retired with it.
  Skipping the *researcher* is equally deliberate: a reader who knows what
  paper they want shouldn't pay for an agent that writes prose about it.
- **It streams.** A scout run is several seconds, and a blocking response left
  the transcript blank for all of them — the reader couldn't tell a slow
  search from a dead one. The route yields a `trace` frame per lookup **as the
  scout issues it** (`on_lookup` → a thread-safe queue the generator drains
  while the agent runs on the shared loop via `streams.submit`), then one
  `result` frame, then `done`. A chip on issue says what is happening now; a
  chip on completion only reports what already happened.
- **The filters bind, and they are not prompt text.** `year_from` / `year_to`
  / `fields` go into `ScoutDeps`, so every lookup is already restricted and no
  wording the model chooses can widen them (it may narrow further inside the
  window). The same filters ride on `/api/ask_sources`
  (`routes/agents.py`'s `_opt_filters`), because they belong to the chat bar
  rather than to one of its modes — one set of filters, both destinations.
  `/api/ask` stopped reading them in v8.28.0, when the Citation Graph
  assistant lost its paper search: they had nothing left to bind there.
- **The nickname resolve runs here too, alongside the scout.** The `@`
  dropdown learned that `dqn` reaches *Playing Atari with Deep Reinforcement
  Learning* only through world knowledge (`services/search/naming.py`), and
  the scout — a text-searching agent — has exactly the same blind spot: asked
  for `dqn` it led with a 2020 paper *titled* "Deep Q-Networks" and called it
  canonical. So the same day-cached `paper_by_name` runs in its own small
  thread pool (`_RESOLVERS` — it is synchronous, and must not sit on the loop
  the scout streams from) from before the scout starts, and its confirmed
  paper is **prepended** to the scout's list under the dropdown's exact gate:
  only when no found title already *is* the query (`has_exact_title_match`;
  see `naming.py` for why "contains" is the wrong test). It overlaps the whole
  scout run, so it costs no wall-clock; a hit leaves one `trace` chip in the
  dropdown's own words for the phase, a miss leaves nothing — most queries
  aren't a paper's name, and "nothing new" after every search would be noise
  about a step the reader never asked for. A bare `@dqn` sent from the
  dropdown therefore lands on the same paper the dropdown would have offered,
  usually straight from the cache its own lookup just filled.
- **A pasted arXiv id/URL never reaches this route.** The frontend routes it
  straight to the graph: an id is exact, so resolving it needs a regex, not a
  model. (It used to short-circuit *inside* `live_search`; with a model on
  this path, keeping the fast path client-side is what stops a paper you
  already identified costing an agent run.)
- **Repeated lookups answer instantly** — caching moved down a layer with the
  search itself: `traversal.search` caches each query whole for a day (query +
  year window + limit + fields keyed). The scout still costs its one Haiku
  call; the provider calls behind it are free on a repeat.
- **Filters degrade, never error.** A non-numeric year becomes "no filter";
  unknown `fields` values are dropped against the **selected provider's**
  vocabulary (`services.search.valid_fields`, shared with the ask routes) — so
  an S2 field name left over after switching to OpenAlex is simply ignored.
  Blank queries return an empty `result` frame — the box starts empty; that's
  not an error.
- **A provider outage is NOT an `error` frame.** The scout degrades
  internally, so a rate-limited S2 arrives as a normal result whose `summary`
  says why (and, when the local cache has matches, with papers in it anyway).
  `error` is reserved for a genuine break, and the stream always terminates
  with `done` either way — a stream that simply stops is indistinguishable
  from one still working.
- **`/api/taxonomy/<provider>` returns one unified shape** —
  `{fields: [{id, name}]}` for both `s2` (~20 fields of study; id == name) and
  `openalex` (26 top-level fields; id == the numeric `topics.field.id`) — so the
  frontend field picker is provider-agnostic (show `name`, send `id`). Unknown
  provider → 404. (The `arxiv` taxonomy provider was retired in v5.1.0 — it fed
  the long-dead arXiv-category search filter; the detail panel's per-paper tag
  labels come from `arxiv.vocab.name_for`, not this endpoint.)

### LLM title resolution — the idea, and where it lives now

Worth keeping, because it explains a tool that otherwise looks redundant.

A lexical search fixes nothing for famous papers: "DQN" appears in no title or
abstract of the paper it names. Google resolves it anyway, because the web is
full of pages that say "DQN" and *link* to the Mnih et al. paper — Google
resolves the **association**, not the string. Claude internalized those same
associations in training: asked what paper "DQN" refers to, it names the exact
title from parametric knowledge, no retrieval needed. And both providers have
the receiving end — S2's title-match endpoint (`/paper/search/match`) and
OpenAlex's `resolve_work` — which turn a near-exact title into a paper.

The hallucination risk defuses itself: an invented title simply doesn't match,
costing one lookup and returning nothing, so the failure mode is "no better
than a plain search", never worse. Post-cutoff papers degrade the same way.

This shipped as the `query_analyst` agent, called from `live_search`. Both are
gone (v7.6.0) and the idea is now the paper scout's **`match_title` tool** —
strictly better placed, because the scout *chooses* when to spend a lookup on
a name it recognizes, instead of every query paying for a recall attempt
whether or not it names anything.

## `settings.py` — the settings modal's backend

| Endpoint | Job |
| --- | --- |
| `GET /api/settings` | the active config file's path + parsed contents |
| `PUT /api/settings` | replace the file's contents (validated first) and apply live |
| `PUT /api/settings/location` | repoint the app at another config file (`""` = default) |
| `POST /api/settings/pick` | open the OS file chooser server-side, return the picked path |
| `POST /api/settings/drop_cache` | empty the derived-data cache; returns `{removed}` |
| `GET /api/settings/models` | per configured vendor, the model ids its own API lists (`KNOWN_MODELS` as the offline fallback), narrowed to chat-capable families and newest-first; plus `tiers` — each listed vendor's *advanced* and *light* pick (`_tiers`, by name rank: Sonnet/Haiku, mainline gpt-/-mini, Flash/Flash-Lite, Ollama by parameter count), which the modal's per-vendor "Use for all agents" button applies to the crew (v7.29.0) |

The modal is a **config-file editor**, so the file stays the single source of
truth: PUT validates the whole body as a `Config` *before* writing anything
(a rejection returns the Pydantic field error as the 400 body and changes
nothing), then rewrites the file **in the example template's canonical key order**
(stable saves, readable diffs — Flask's default alphabetical JSON sort is
also off for the same reason) and folds the fresh values into the running
app's shared `config` object in place (`config.reload_config` — every
consumer reads fields late, so no restart). The raw file JSON is what GET
returns and PUT accepts, so values round-trip byte-for-byte. The location
endpoint validates the target file before switching the `.config-location`
sidecar (see `config.py`).

## `knowledge.py` — the knowledge network (v8.14.0)

| Endpoint | Job |
| --- | --- |
| `POST /api/knowledge/expand` | break one course item into the concepts it needs (JSON); `fresh: true` skips the cached breakdown and replaces it ("Break it down again", v8.23.0) |
| `POST /api/knowledge/lesson` | stream one item's lesson: SSE `token` frames, then `done` (the `paper_refs` frame went with citations in v8.17.0); `needed_by` lists every item that needs it, for its closing "How it fits in", and `fresh: true` skips and replaces the cached lesson after a "Break it down again" (v8.23.0). Since v8.24.0 it is written **with images** unless `quick: true`: `paper` and `provider` say where the course paper's figures are, and the stream adds `step` frames (one status line each) and an `image` frame per image placed |
| `POST /api/knowledge/place` | where in the paper each of the course's concepts is needed, for the Reader's Knowledge Graph notes (v8.44.0): `{paper, concepts, source?, provider?}` → `{sections: {<section id>: [names]}}`, read from the paper's cached document to the contents' depth (paragraph headings folded into their subsection), or with `source: "pdf"` from its PDF's contents entries (`pdf:<n>`, each with the pages it spans, up to 3; the reference list left out) for a paper with only a PDF; cached by the paper, the source and the concepts, `{sections: {}}` with nothing to read, 502 when the model fails |
| `POST /api/knowledge/phrase` | name the concept behind a passage highlighted in a lesson, for its "Expand" (JSON `{child: {name, why}}`, or `{child: null}` when it names the lesson's own item or one above it; cached, v8.25.0) |
| `POST /api/knowledge/fit` | rewrite only a lesson's closing "How it fits in" section for what needs it now (JSON `{text}`, v8.23.0) |
| `POST /api/knowledge/synthesis` | name a synthesis: what several concepts become together toward an item (JSON `{name, why}`, v8.23.0) |
| `POST /api/knowledge/synthesis/lesson` | stream a synthesis's lesson: SSE `token` frames, then `done` (v8.23.0); with images or `quick` as for a lesson, and `fresh: true` to skip and replace the cached copy (v8.24.0, ↻ "Rewrite this lesson") |
| `GET /api/web_image/<handle>` | an image a lesson's tutor found on the web, fetched afresh through the guarded fetch and never stored; only a handle a search registered resolves (v8.24.0) |

All are thin over `agents/orchestrators/tutor`. What lives here is the
grounding and the cache. A synthesis's two routes are cached permanently too,
keyed on its members **sorted**, so the same group synthesized in any order is the
same synthesis and never paid for twice; a synthesis needs two or more members
(at most 12 are sent on) and a target, or it is a 400:

- **The paper's real reference list grounds both.** The routes fetch up to
  40 references through `traversal.neighbors` (day-cached, provider-aware).
  The paper's own expansion reads them to judge which ideas it builds on.
  Every lesson is handed them numbered and may cite a paper only by its
  number; its `paper_refs` frame resolves the numbers it used. The graph
  itself holds only concepts. A failed fetch degrades quietly (no references,
  no citations) rather than failing the request, and a concept's expansion
  never fetches references.
- **Both results are cached permanently**, like generated TL;DRs, because a
  course re-opened tomorrow should not be paid for twice. The keys include the
  tutor's `children`/`lesson_words` knobs, so a settings change misses the old
  entries. The one way past it is a breakdown asked for `fresh` (v8.23.0),
  which writes over its entry, so a redo costs one call and later opens see
  the new breakdown; there is deliberately no TTL. The reader's "already in the course" list is deliberately not in
  the key: it only nudges naming, and the frontend merges repeats either way.
  A lesson is cached with its citations (`{text, refs}`), and only once its
  stream finishes cleanly; a dropped stream writes nothing. Both keys carry a
  version (`tutor:expand:v2`, `tutor:lesson:v4`), bumped when 5b dropped paper
  nodes, when lessons stopped citing (v3), and when they gained a closing
  section covering every item that needs them (v4, v8.23.0; `needed_by` is
  in the key, sorted, so the same set in any order is one lesson). A
  rewritten section (`tutor:fit:v1`) is keyed on the subject, the lesson
  before it and that set, so the same change never bills twice. An old entry would otherwise serve a paper as a concept, or a lesson
  with no citations.
- **A lesson's images come with it** (v8.24.0): the tutor finds and places
  them while it writes (`tutor.images`), so the route relays its `step`
  and `image` events alongside the tokens and caches the lesson as `{text,
  images}`, replaying both. A quick response (`quick: true`, or the
  tutor's `images` knob at 0) keeps the key lessons always had, so lessons
  written before v8.24.0 still serve as quick ones; a lesson with images
  adds the knobs (`images`, and since v8.32.0 `min_images`) and the paper
  to it, so the two are never served for each other, and `"lead"` (v8.32.0), so a lesson cached before lead images is
  never served as one that opens on its subject's picture. A web image is served through `/api/web_image/<handle>`, so the
  browser never hotlinks a stranger's host, the host never sees the
  reader, and nothing but the address is kept; "Drop cache" forgets those
  addresses (and the lessons), after which a saved lesson's web image is a
  404.

## `sessions.py` — explorations

| Endpoint | Job |
| --- | --- |
| `GET /api/sessions` | list explorations (metadata only, newest first) |
| `POST /api/sessions` | save an exploration (new, or overwrite by `id`) |
| `GET /api/sessions/<id>` | the full record, to restore |
| `PATCH /api/sessions/<id>` | rename — `{renamed: bool}` |
| `DELETE /api/sessions/<id>` | delete — `{deleted: bool}`, idempotent |
| `POST /api/sessions/title` | name an exploration after its conversation |
| `POST /api/sessions/summary` | summarize completed thread history |

Thin CRUD over `storage/sessions.py`. New saves carry a versioned exploration
container with ordered General/graph thread records; each child reuses the old
session shape. Legacy payloads remain readable and are migrated client-side
only when opened. The summary endpoint is separate from saving, uses the
summarizer model, and bounds input by the configured history window. The blob (`{name, graph_ref, layout,
discovered_nodes, discovered_edges, chat}`) is **frontend-owned and
deliberately unvalidated** — the store treats it as opaque JSON, and
validating its shape here would create a second place that has to track the
frontend's format. That indifference is what makes the frontend's format free
to change: `lecture`/`lectureSources` (and, earlier, a per-mode `lectures`
cache) were written into this blob until v7.21.0 and are now read-only
legacy, folded into `chat` on restore — and this route needed no edit for
either change. (Old saves may also carry the whole graph inline plus a
`hist_trace` field from the retired lecture backfill; the former is used on
restore, the latter ignored.)

Two things about `POST /api/sessions` are load-bearing since v7.16.0, when
saving became automatic:

- **A graphless body is valid.** The route used to 400 on an empty `nodes`
  list, which made a conversation held before any graph existed unsavable —
  the exact data loss the autosave was built to end. Only a non-object body
  is refused now.
- **It is written constantly**, on a 2-second debounce from the frontend, so
  the common case is an overwrite by `id`, not a create. Nothing expensive
  belongs on this path — which is why titling is a **separate** route rather
  than a step inside the save: a model call here would put provider latency
  on a request that fires all afternoon. `POST /api/sessions/title` answers
  `{title: null}` with HTTP **200** when it can't name the conversation (no
  key, provider down); that is not an error, because the caller falls back to
  the reader's own first message and a save must never fail over a nicety.

Delete returns `{deleted: false}` rather than 404 (idempotent); a store
failure is a canned 500 with details in the log.

## `sources.py` — the local library

| Endpoint | Job |
| --- | --- |
| `GET /api/sources` | list the library + the `available` flag |
| `POST /api/sources` | ingest a PDF upload or a `{url}`, streaming SSE progress |
| `DELETE /api/sources/<id>` | remove a source — `{deleted: bool}`, idempotent |
| `GET /api/sources/<id>/figure/<n>` | one figure mined from the source's stored PDF, as PNG |
| `GET /api/sources/<id>/pdf` | the source's stored PDF itself, so a lesson image's credit opens the book at its page (`#page=N`, v8.24.0); 404 for an unknown source or one with no stored file |

Thin wrappers over `services/sources`. Points worth knowing:

- **`available` explains a disabled state.** The list response reports
  whether local embeddings + sqlite-vec loaded, so the UI can say *why*
  semantic search is off; the check itself degrades to `False` on any
  error. This endpoint is where the lazy torch load happens — deliberate:
  the sources drawer is the UI's "is semantic search on" indicator (the
  researcher, by contrast, never probes).
- **Two-tier error contract.** `SourceError` text goes to the client
  verbatim as a 400 — those messages are *written for users* by the
  ingestion layer ("no extractable text — is it scanned?"). Anything
  unexpected is a canned 500, details in the log only.
- **Ingestion streams progress** (browser-milestone addition): `progress`
  frames carry `{done, total}` chunks embedded — embedding is where the
  time goes — then `done` (the stored record) or `error`. The pipeline is
  synchronous, so a worker thread runs it and a queue bridges its progress
  callback into the SSE generator. Everything request-scoped (the upload's
  temp file, the parsed URL) happens *before* streaming starts — the
  generator outlives the request context (see `routes/sse.py`, the shared
  SSE helpers promoted from `agents.py` when this second consumer arrived).
- **Temp-file hygiene on upload:** `mkstemp` + close the fd *before*
  `upload.save()` (on Windows an open handle holds an exclusive lock),
  removal in a `finally`.

## `agents.py` — the teacher's endpoints

| Endpoint | Job |
| --- | --- |
| `POST /api/route` | which assistant a typed message wants, and over which papers (**JSON, not SSE**) |
| `POST /api/route/papers` | which graph papers a lecture request named (**JSON**) |
| `POST /api/lecture` | streamed lecture over the reader's scoped graph |
| `POST /api/ask` | agentic Q&A over the graph (no paper search since v8.28.0: it reads and expands the graph) |
| `POST /api/ask_sources` | chat with no graph open (library + search) |
| `POST /api/ask_course` | the Knowledge Graph's course assistant (v8.25.0; no paper search since v8.28.0): the same graph-free researcher, with the thread's course laid out and bounded by `_course_context` (the open lesson whole, the others' openings) |
| `POST /api/ask_reader` | the Reader's assistant (v8.38.0; no paper search): the same graph-free researcher over the paper being read. The client sends only the arXiv id and the section in view; `_reading_context` lays the paper out from the cached document (`integrations/arxiv/document.py`): title, abstract, outline, the section in view whole, then the rest in order under `READING_CHARS` (most papers fit whole). Since v8.40.0 `_pdf_context` lays it out from the PDF's text page by page instead, the page in view first, when the Reader shows the PDF (`section` is `page:<n>`) or the paper has no HTML render (needs the `pdf` extra, and says so without it). Since v8.45.0 a passage highlighted in the PDF view comes as `places`, and `_highlight_context` adds the PDF's own words there to the prompt and sends the model a picture of it (`images`). 400 when there's nothing to read |

All three `ask` routes take `quick: true` since v8.30.0: ⚡ Quick response, the researcher with no tools (`_opt_quick`; see the researcher's README).

All three also take `model` since v8.33.0: the chat bar's Model pick, a `provider:model` the researcher answers on in place of its configured model (`_opt_model`, which drops anything but a known vendor's string to the configured model; see the researcher's README).

Since v8.25.0 the sibling index (`thread_context`) has one entry per
**chat**, not per thread (a paper thread's Citation Graph and Knowledge
Graph each, see `frontend/src/store/chats.ts`), and a mentioned Knowledge
Graph chat carries its course, which `_sibling_context` adds as an outline
(no lessons) after the chat's turns.

(The route face of the `agents` package — a deliberate name-cousin,
different full paths.) Each streaming endpoint validates, builds typed
inputs, and hands off to the agent that serves it — directly, since v7.0.0
deleted the `orchestrator.run(intent, ...)` funnel they all used to pass
through; one `_relay` generator serializes the typed event stream as SSE.

Design decisions worth knowing:

- **`/api/route` is the one endpoint here that doesn't stream**, because it
  produces a *decision* rather than an answer: the client uses it to pick
  between `/api/lecture` and `/api/ask`, then streams from the one it picked.
  Two round trips on purpose — folding the choice into one streaming endpoint
  would mean a second implementation of both workflows' event relays, to save
  a few milliseconds on localhost.

  It **always returns 200**. A blank message, a missing key, a dead model and
  an unparseable classification all come back as the researcher, because this
  sits in front of every message the reader sends: failing it would break
  asking questions in order to protect a routing nicety. See
  `agents/orchestrators/router/README.md` for the cost model behind that
  asymmetry.

  Since v7.23.0 its answer also carries a **`scope`** — which papers a
  lecture is about, as far as the message says (`screen`, `references`,
  `citations`, `seed`, `named`). **`/api/route/papers`** is the second half
  of that: called by the client only when the scope was `named`, with the
  graph's paper list (`{id, title, year, authors}` per paper — a thin cut,
  no abstracts), it returns the ids the message pointed at. Split from
  `/api/route` on purpose, so the paper list crosses the wire and is billed
  only for the messages that name a paper, never on the every-message
  classify. It, too, always returns 200: an empty `ids` is both "nothing
  matched" and every failure, because the client already has to handle the
  first.
- **One serialization rule replaces six tuple matches.** Frame name = the
  event's `type` tag, payload = `model_dump(exclude={"type"})`. That
  reproduces the old wire shapes for `token`/`beat`/`cited`/`trace`/`done`
  exactly, with the two documented renames (`nodes` → `discovery`,
  error `{"error"}` → `{"message"}`); `discard` is gone (nothing to disavow
  — the researcher's pre-answer narration is never streamed).
- **The typed-node boundary.** The agents take `Node` models; the
  frontend sends dicts that the force-graph renderer has mutated with
  simulation fields (`x`, `vy`, `index`, ...). `_node` picks exactly the
  model's fields out of each dict — strict about the core shape (missing
  fields → 400), tolerant about baggage.
- **History is client-owned.** Both research routes validate and cap the
  completed transcript supplied with every request. Agents receive history;
  neither they nor the routes store a competing copy. Lecture beats are
  converted by the frontend before sending. `thread_context` carries a bounded
  sibling index and explicitly mentioned histories, labelled as borrowed
  background rather than current paper scope or instructions.
- **Both research routes carry a `provider`.** `/api/ask` takes it from the
  graph it's grounded in; `/api/ask_sources` has no graph, so it takes the
  header dropdown's choice straight off the request. Leaving it off — as
  `ask_sources` did until v6.14.0 — doesn't leave the agent backend-less, it
  silently pins it to the default, so a chat under OpenAlex searched Semantic
  Scholar and handed back ids no OpenAlex build could resolve. Both go
  through `resolve_provider`, which degrades anything unrecognized to the
  configured default rather than erroring.
- **No availability gate on `/api/ask_sources`** (the old route 400'd when
  embeddings didn't load): retrieval self-degrades to lexical-only, and an
  empty library just means the agent's source search finds nothing — a working
  degraded feature shouldn't be refused. The sources drawer's `available`
  flag still tells the UI the semantic story.
- **SSE `error` frames carry the orchestrator's message text** — like
  `SourceError`, they're the user-facing error surface (the panel needs
  something actionable); HTTP-level errors stay canned. And the module
  logger (never `current_app.logger`): the generators run after the request
  context is gone, where touching `current_app` would kill the stream
  before the `error` frame the frontend waits for.

`drop_cache` is the one endpoint here that isn't about the config file. It
lives in this module because it is app maintenance rather than graph work, and
it is safe by construction: everything in the cache table is derived and
refetches on demand. Saved sessions are in a different store and are not
touched — a fact the UI's confirmation states outright, and a test pins.

## Who uses it, and how/why

The React frontend (Phase 6) is the only caller: the search/seed flow hits
`/api/graph`, clicking a node hydrates via `/api/paper/<ref>`, and the
detail panel lazily loads `/figures`, `/code`, and `/categories`. `<img>` tags
point at `/api/figure_proxy` URLs (both panel figures and the researcher's
inline answer figures use it). A bare `@phrase` in the chat bar streams
`/api/search`; the Filters popover loads `/api/taxonomy/<provider>` once,
lazily. (`/api/local_search` is gone — the scout reads that cache itself.)

## Testing

`test_graph.py` and `test_search.py` drive every endpoint through a real
test client built from `register_blueprints` (`conftest.py`), with
services/integrations monkeypatched at the route module's seams: URL/version
normalization reaching the service, the 400/404/502 taxonomy,
prefix-vs-raw paperId lookups, proxy rewriting + degradation of the
niceties, the SSRF lock, filter parsing/validation and clamps, the
never-error local search, and the taxonomy providers' shapes. The pasted-id
short-circuit is service-level behavior, tested in
`services/test_search.py`.
