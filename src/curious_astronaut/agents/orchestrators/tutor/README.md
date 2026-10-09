# `agents/orchestrators/tutor`

The agent behind the **knowledge network** (Phase 5b, v8.14.0), a short course
on what a reader needs to know before a paper makes sense. The paper is the
centre of a graph of ideas: the tutor breaks the paper, or any concept in the
course, into the concepts it needs, and teaches each one.

```
tutor/
  config.py — AGENT_ID, the two prompts (EXPAND_PROMPT, LESSON_PROMPT), skills
  main.py   — the two Agents, their output models, expand(), lesson(), cited_references()
```

## Two jobs, one agent id

- **`expand(item, path, references, existing)`** makes one structured call
  and returns `Child`ren: a concept `name` and the `why` the item needs it.
  The result comes back whole, not streamed: an expansion is a short list,
  and the frontend shows a turning ring on the node until it arrives.
- **`lesson(item, why, path, abstract, references, provider)`** streams
  `Token` events, then one `PaperRefs` for the papers the lesson cited. It
  uses the same structured-output streaming as the researcher (a `Lesson.text`
  field read out of the output tool's partial JSON), so no preamble can leak
  into the page.

Both read the tutor's `config.llm.agents` entry **per call**: the model
through `factory.model_for` and the two knobs from `extras` (`children`, the
most concepts one expansion lists, and `lesson_words`, the target lesson
length; see `config.TutorExtras`). A settings edit therefore applies to the
next expansion without a restart. The tutor sits on the lecturer's tier: the
settings modal's "Apply Default Models" gives it the vendor's advanced model.

## Decisions worth knowing

- **The graph holds ideas; papers live in the lessons** (Patrick, 2026-10-09).
  5b's first build also had *paper* nodes, grounded in the reference list.
  They were dropped because a paper bundles several ideas and so sits at a
  different level from "Bellman equations", and the reader needs the ideas.
  The prompt asks for ideas and never papers or authors, so every child is a
  concept.
- **The real reference list still grounds the course, in two places.** The
  paper's own expansion sees it, to judge which ideas the paper really builds
  on. Every lesson sees it numbered and may cite a paper **only by its
  number**. `cited_references` then resolves just the markers the text used
  that are in range, to the real paper (id, title, url, provider), so a paper
  the provider doesn't know can never appear as a citation. A deeper concept's
  lesson uses the same list (only the paper has one), and a lesson with no
  citation is fine.
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
and course list in the prompts, and a lesson's tokens adding up to its text
with only its in-range citations resolved. The routes' grounding, caching and
degradation are tested in `test/curious_astronaut/routes/test_knowledge.py`.
