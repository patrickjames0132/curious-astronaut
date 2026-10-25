# `agents/orchestrators/tutor`

The agent behind the **knowledge network** (Phase 5b, v8.14.0), a short course
on what a reader needs to know before a paper makes sense. The paper is the
centre of a graph of ideas: the tutor breaks the paper, or any concept in the
course, into the concepts it needs, and teaches each one.

```
tutor/
  config.py — AGENT_ID, FIT_HEADING, the prompts (EXPAND_PROMPT,
              PHRASE_PROMPT, LESSON_PROMPT, FIT_PROMPT, a synthesis's
              SYNTHESIS_NAME_PROMPT and SYNTHESIS_PROMPT, and
              IMAGES_PROMPT, added when a lesson has its image tools), skills
  main.py   — the Agents, their output models, expand(), name_phrase(), lesson(),
              fit_section(), a synthesis's name_synthesis() and
              synthesis_lesson(), and place() for the Reader's notes
  images.py — a lesson's image tools (v8.24.0): find_images() and
              show_image() over LessonDeps, the library/paper/web candidate
              gatherers, shrink(), and image_bytes()/web_image_url(), which
              serve what was found
```

## Two jobs, one agent id

- **`expand(item, path, references, existing)`** makes one structured call
  and returns `Child`ren: a concept `name` and the `why` the item needs it.
  The result comes back whole, not streamed: an expansion is a short list,
  and the frontend shows a turning ring on the node until it arrives.
- **`lesson(item, why, path, abstract, needed_by)`** streams `Token` events
  and nothing else: lessons don't cite (v8.17.0). It uses the same
  structured-output streaming as the researcher (a `Lesson.text` field read
  out of the output tool's partial JSON), so no preamble can leak into the
  page.
- **Every lesson ends with a marked closing section** (v8.23.0, Patrick).
  The prompt asks for `FIT_HEADING` (`### How it fits in`) verbatim, then
  how the subject serves each item under **NEEDED BY** (`needed_by`, every
  item that needs it, each with its reason), and none on the paper's own
  lesson. The prompt always ended on how the item above it on the path uses
  it, which Patrick noticed read as the lesson's link back to its parent; marking it lets
  the panel show it in its own card without guessing at a last paragraph,
  and handing over every parent, not just the path's, covers a shared
  prerequisite. **`fit_section(item, body, needed_by)`** rewrites that
  section alone (one structured call, `FIT_PROMPT`) when what needs the
  subject has changed since; the rest of the lesson stays as written.

- **`name_phrase(phrase, item, path, existing)`** (v8.25.0) names the one
  concept behind a passage the reader highlighted in a lesson (its
  "Expand"): one structured call (`PHRASE_PROMPT`) returning a `Child`, or
  None when the model names the item itself or something above it (that
  would be a cycle). The frontend hangs it under the lesson's item as a
  breakdown would, so the same name dedup applies, and `existing` lets the
  model reuse a name already in the course.

- **`place(sections, concepts)`** (v8.44.0) finds where in the paper each of
  the course's concepts is needed, for the Reader's Knowledge Graph notes:
  one structured call (`PLACE_PROMPT`) over the paper's sections, each cut
  to its share of 60,000 characters. A section needs a concept when its
  argument, method or equations rely on it, named or not, not where it is
  merely mentioned; every concept is placed at least once where the text
  allows, at most four sections, the most specific first. The prompt said
  less at first and left layer normalization, residual connections and
  label smoothing unplaced on Attention while piling five concepts on its
  Model Variations section; asking for each concept at least once, and
  ruling out experiments that only vary a thing, fixed both. Names and
  section ids the model makes up are dropped.

- **A synthesis** (v8.23.0; the reader sees it as a **synthesis**) is an
  optional node made of several concepts the course already holds, or of
  earlier syntheses, synthesized toward the item they build toward.
  **`name_synthesis(members, toward, path)`** names what they become together and
  what that gives the target (one structured `SynthesisName` call), and
  **`synthesis_lesson(name, members, toward, path)`** streams how they combine.
  Its prompt assumes the reader has met each concept, so it says what each
  contributes and where they meet rather than re-teaching them. It streams
  through the same `_stream_text` as `lesson`. Syntheses never touch
  `expand`: they sit beside the course, not in it (see
  `frontend/src/knowledge/README.md`).

- **A lesson is written with images** (v8.24.0; `images.py`) unless the
  reader asks for a quick response: `lesson` and `synthesis_lesson` take
  `pictures` (where the course paper's figures are), and with it run
  `illustrated_lesson_agent` / `illustrated_synthesis_agent`, the same
  prompts plus `IMAGES_PROMPT` and the image tools. See "Lesson images".

All read the tutor's `config.llm.agents` entry **per call**: the model
through `factory.model_for` and the knobs from `extras` (`children`, the
most concepts one expansion lists, `lesson_words`, the target lesson
length, `images`, the most images a lesson shows, 0 for none,
`min_images`, the fewest, and `image_searches`, the searches a lesson may make for them; see
`config.TutorExtras`). A settings edit therefore applies to the
next expansion without a restart. The tutor sits on the lecturer's tier: the
settings modal's "Apply Default Models" gives it the vendor's advanced model.

## Decisions worth knowing

- **The graph holds ideas, not papers** (Patrick, 2026-10-09).
  5b's first build also had *paper* nodes, grounded in the reference list.
  They were dropped because a paper bundles several ideas and so sits at a
  different level from "Bellman equations", and the reader needs the ideas.
  The prompt asks for ideas and never papers or authors, so every child is a
  concept.
- **The real reference list grounds the paper's breakdown.** The paper's
  own expansion sees it, to judge which ideas the paper really builds on.
- **Lessons don't cite** (Patrick, v8.17.0). From v8.14.0 to v8.16.0 every
  lesson saw the reference list numbered and could cite a paper only by its
  number, resolved server-side (`cited_references`) to the real paper, so an
  unknown paper could never appear. It was grounded but read oddly: bare
  numbers look like footnotes to a reader who never saw a list, and every
  lesson, however deep, cited the *root* paper's list. The prompt now asks
  for no markers and no reference list, and lets a lesson name a paper only
  where an idea is commonly known by it. The planned replacement is a
  suggestions section of vetted resources (the OnePager's "Verified
  resources").
- **The path is context.** Every call carries the path from the paper down to
  the item, because eigenvectors under PCA and eigenvectors under policy
  iteration are different lessons. That is also why the server's cache keys
  include the path.
- **Cycles and duplicates are dropped here.** A child naming the item or
  anything above it on the path is discarded, and so is a repeat within one
  listing, compared case- and space-blind. A concept that is already
  elsewhere in the course is kept: the frontend, which owns the whole graph,
  turns it into a second edge into the existing node.
- **Fewer is allowed.** The prompt asks for at most `children` items, and an
  empty list for an elementary concept rather than padding. The cap is also
  enforced after the call.

## Lesson images

Real images placed in a lesson where they help, each credited and described
(Patrick, 2026-10-17). **The prose stays the model's own**: it teaches from
what it knows and cites nothing, as lessons have since v8.17.0. The tools
ground only the pictures. Not interactive, and a fresh start beside the
parked `feature/visuals` branch, whose generated widgets never read well
enough to ship.

- **The tutor finds its images while it writes** (Patrick's call, after
  trying it the other way). It holds two tools: `find_images(what, where)`
  searches for one picture it wants, described specifically ("a backup
  diagram for the Bellman optimality equation"), in the reader's
  **library**, **papers** and the **web**, and returns the candidates
  numbered **with their pixels** (shrunk to 768px a side first), so it
  looks at each one; `show_image(number, description)` places one and
  answers with the `<<FIG n>>` marker it writes on its own line after the
  paragraph the image shows, a paragraph it then writes to point at it. So
  each image is chosen by the writing that explains it.
- **Why not after the lesson** (the first build, kept here so it isn't
  re-tried): it wrote the lesson, searched once on the subject's name, and
  had a second model fit images into prose that never knew about them.
  Almost no lesson got one. A dry run for "Bellman equations" showed why:
  the name alone ranked Sutton & Barto's backup diagrams sixth of seven in
  the library (three reached the picker), the web gave one usable page, and
  the only paper searched was the course paper, whose figures are results
  plots. The tutor's own phrase for the picture fixes the ranking, and it
  can only write that while writing the lesson.
- **Every search looks everywhere, and no source outranks another**
  (Patrick, 2026-10-17). Left to choose where (an early `where` argument),
  the tutor named one or two places a search, the web most, and a 4/3/5 cap
  over 8 slots left papers no room at all, so the reader's library and
  papers were rarely seen. Now each search covers all three; each source is
  sure of a share (`LIBRARY_SHARE` 3, `PAPER_SHARE` 2, `WEB_SHARE` 3 of
  `PER_SEARCH` 8), slots a source can't fill go to the others in turn, and
  the candidates are interleaved, one from each source in turn, so their
  order favours none. The tutor judges them on their merits.
- **A lead image first** (v8.32.0, from the OnePager ticket "Lesson images
  should show the concept itself, first"). Left to itself the tutor
  illustrated *side* ideas a lesson touched on, each after its paragraph,
  and the lesson's own concept went unpictured. Now its first search is for
  the subject itself, its best-known diagram (`find_images(..., lead=True)`,
  which sets `LessonDeps.lead_searched`), and a candidate that shows the
  subject is placed with `show_image(..., lead=True)`: marked `lead` on its
  `LessonImage`, one per lesson, and told to open the lesson with its
  marker. The panel puts it above the first paragraph whatever the model
  did with the marker. `send_back` sends a lesson that never made the lead
  search back to make it (`SEARCH_FIRST`, reworded), while it has a search
  left; *placing* a lead isn't required, since a side idea's picture as the
  opening is worse than prose. The lesson cache key gains `"lead"`, so older
  lessons aren't served as ones with a lead.
- **Several images are welcome** where more than one paragraph would be
  clearer with a picture, each searched for on its own, up to the `images`
  knob; one is the least, not the goal.
- **Where candidates come from**: figures within a page of the library passages
  `sources.search` matches; **Wikipedia**, read directly through its search
  and REST APIs (no key, no scout: the subject's article, then the best one
  for `what`, figures ranked by caption match), then the web scout's pages,
  their pictures read with `integrations.web` and downloaded through its
  guarded fetch (a vendor without web search gets Wikipedia alone); and
  papers, an S2/OpenAlex search on the lesson's **subject** (a long picture
  description finds noise) and the ar5iv figures of the first hits with a
  render, ranked by caption match to `what`. The **course paper's
  own figures are offered only in its own lesson** (`paper_lesson`): in a
  concept lesson, required to place something, the tutor placed SAC's
  Hopper results plot. Tables and algorithm boxes are no picture. A failing
  source gives none, never an error, and a later search never re-offers an
  image.
- **Why Wikipedia is read directly** (2026-10-17): a dry run found every
  Wikipedia figure had been dropped as page furniture, because its image
  addresses end `?utm_content=thumbnail` and the furniture filter matched the
  whole URL (now the path only: `integrations/web`). And Medium answers
  server-side fetches with 403; we don't dress the fetch up as a browser to
  get past that. Wikipedia's figures are the canonical ones a lesson wants,
  captioned and free to reuse: with it, KL divergence placed Wikipedia's two
  densities, MDPs Sutton & Barto's agent–environment loop.
- **One description per image** (Patrick): a figure keeps its own caption,
  and the tutor's `description` stands in only for an image with no real
  caption (fewer than three words: an `alt` is often a file name like
  `maze_one_path`).
- **Images aren't optional** (Patrick, 2026-10-17). Left to choose, the
  tutor searched in one lesson of four and wrote the rest from memory (the
  `lesson images` log lines showed `0 search(es)`). `must_show_an_image`,
  an output validator on both illustrated agents, sends a lesson back until
  it has searched (`SEARCH_FIRST`) and placed an image (`place_more`: place
  the best candidate, or search again with a different description). It
  goes out without one only when its searches are spent with nothing found,
  or after `NUDGES` returns, so a model that won't comply still gives the
  reader a lesson. With it, the three lessons that had placed nothing each
  placed a fitting image.
- **…and one isn't enough** (v8.32.0, Patrick). With one required, the log
  showed every lesson in an evening placing exactly one, the lead or a
  paragraph's, and stopping, though the prompt welcomed several: the model
  treats the floor as the goal. So the floor is a knob, `min_images`
  (default 2, never above `images`; `LessonDeps.least`), the prompt asks
  for "at least N and at most M", and `send_back` returns a lesson holding
  fewer while it has searches left or candidates unplaced. Requiring a
  *placement* rather than just a search trades some weaker second images
  for the guarantee; 0 hands the choice back to the tutor (not even the
  lead search is demanded). The log now marks lead searches and
  placements, and says how many of how many images a lesson held when it
  was sent back. A rejected draft must never reach the page, and the
  text should still stream (Patrick), so `send_back` is the one rule both
  read: the validator enforces it, and the stream checks it as each draft
  starts. It depends only on what the tools did before the draft, never on
  its text, so a draft that streams is the one kept; one that will be sent
  back is held.
- **Budgets are knobs**, like the researcher's search limits:
  `image_searches` (default 4) caps the searches a lesson makes
  (`LessonDeps.searches`), `images` caps what it places and `min_images`
  sets the fewest; the tools answer
  in words when either is spent, or for a number they never showed, or an
  image already placed.
- **The status line follows the tools.** Nothing streams while a tool runs,
  so a search's line ("Searching your library, papers and the web for …")
  is said the moment the tutor writes the call (`pending_step`, the way the
  researcher's pending chips work), and the tools queue "Looking at N
  images…" and "Placing an image from …" for the stream (`LessonDeps.drain`).
- **A quick response** is the lesson without the tools: `pictures` is None,
  the plain agents run, and no image is searched. The frontend asks for one
  when the reader clicks "Quick response" on the status line, and every
  lesson is one with the knob at 0. A model that can't see images fails a
  lesson with images; the reader can take the quick response.
- **Nothing is fetched by URL from the browser or the model.** A candidate's
  `key` resolves only to an ar5iv image, a PDF token this server minted, a
  library source, or a web image a search registered under an opaque
  handle (`web_image_url`); `image_bytes` refuses anything else. A web
  image is never stored, only its address, as `docs/pdf-mining.md` settles
  for PDFs' images.

The candidate gathering is adapted from `feature/visuals`' `figures.py`,
which built and reviewed it on 2026-10-16.

## Verified by

`test/curious_astronaut/agents/orchestrators/tutor/test_main.py` covers the
concept children, cycle and repeat dropping, the width cap, the references
and course list in the expansion prompt, a lesson's prompt carrying no
references but every item that needs it, its tokens adding up to its text,
the closing section's rewrite seeing the lesson and what needs it, a synthesis's naming
prompt and streamed lesson, a highlighted phrase named as one concept
(never the item or its path, the passage and the course in its prompt), and
the course placed in real sections in the paper's order (made-up names and
ids dropped, the sections and the course in its prompt). `test_images.py` covers lesson images: library
figures near the matching passage, the course paper's PDF fallback, searched
papers' best-matching figures (and a failed search giving none), web images
behind opaque handles and downloaded once, a key reading only what it may, a
large image shrunk, a lesson written with images end to end (its steps, the
tutor seeing the candidates' pixels, the image placed with its marker and
description), a quick response carrying no tools, the tools' budgets, a
lesson sent back until it has searched and placed an image (kept when none
can be had, or past its nudges) with only its kept draft streamed, an
image's own caption standing in place of the tutor's description (and the
tutor's used for a file-name alt), Wikipedia's figures from the subject's
article, and the course paper's figures offered only in its own lesson.
The routes' grounding,
caching and degradation are tested in `test/curious_astronaut/routes/test_knowledge.py`.
