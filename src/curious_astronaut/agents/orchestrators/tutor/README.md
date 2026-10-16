# `agents/orchestrators/tutor`

The agent behind the **knowledge network** (Phase 5b, v8.14.0), a short course
on what a reader needs to know before a paper makes sense. The paper is the
centre of a graph of ideas: the tutor breaks the paper, or any concept in the
course, into the concepts it needs, and teaches each one.

```
tutor/
  config.py — AGENT_ID, FIT_HEADING, the prompts (EXPAND_PROMPT,
              LESSON_PROMPT, FIT_PROMPT, and a synthesis's
              SYNTHESIS_NAME_PROMPT and SYNTHESIS_PROMPT), skills
  main.py   — the Agents, their output models, expand(), lesson(),
              fit_section(), and a synthesis's name_synthesis() and
              synthesis_lesson()
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

All read the tutor's `config.llm.agents` entry **per call**: the model
through `factory.model_for` and the two knobs from `extras` (`children`, the
most concepts one expansion lists, and `lesson_words`, the target lesson
length; see `config.TutorExtras`). A settings edit therefore applies to the
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

## Verified by

`test/curious_astronaut/agents/orchestrators/tutor/test_main.py` covers the
concept children, cycle and repeat dropping, the width cap, the references
and course list in the expansion prompt, a lesson's prompt carrying no
references but every item that needs it, its tokens adding up to its text,
the closing section's rewrite seeing the lesson and what needs it, and a synthesis's naming
prompt and streamed lesson. The routes' grounding,
caching and degradation are tested in `test/curious_astronaut/routes/test_knowledge.py`.
