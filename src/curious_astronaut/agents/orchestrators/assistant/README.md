# `agents/orchestrators/assistant`

One assistant for every view (v9.0.0). A question is asked *from*
somewhere — a chat with no view open, a paper's Citation Graph, its
Knowledge Graph course, its Reader — and this package turns "the message,
and where it was asked" into a workflow, the tools it may use, and the
context the model reads.

```
assistant/
  views.py    — the screen → tools table (CAPABILITIES), ViewKind, Workflow
  context.py  — what each view lends the prompt: the paper being read (its
                document or its PDF), a highlight pictured, figures boxed, a
                course laid out, the other chats, the history; all bounded
  main.py     — route(message, kind); run(request) → the workflow's events
```

Served by `routes/agents.py`: `POST /api/assistant/route` (`route`) and
`POST /api/assistant` (`run`).

## The table

| View | Workflows | Paper search | What it lends the model |
| --- | --- | --- | --- |
| `general` | answer | yes, bounded by the bar's filters | nothing: the library and the literature through tools |
| `citations` | answer, lecture | no | the seed and the graph in scope (numbered, expandable) |
| `knowledge` | answer | no | the course: its concepts, what each needs, check-offs, lessons |
| `reader` | answer, guide | no | the paper being read, the section or page in view first; a PDF highlight pictured; boxed figures |

Only the general chat searches the literature (v8.28.0): a view is its own
map, and finding papers is the general chat's job. The bar's paper filters
bound that search, so only the general view reads them.

## Each view's fields

What `run` reads off `request["view"]`; everything else (`question`,
`workflow`, `provider`, `source_ids`, `history`, `thread_context`, `quick`,
`model`) rides beside it.

- **`general`**: `year_from?`, `year_to?`, `fields?`.
- **`citations`**: `seed`, `nodes` (non-empty: the graph in scope, full
  node shapes; force-graph baggage is dropped, a missing core field is a
  400), and for a lecture `framing?` (`summary` | `history`; anything else
  is `summary`) and `bridge?` (a node: the bridge lecture).
- **`knowledge`**: `course`, as `context.course_context` reads it.
- **`reader`**: `paper` (arXiv id or provider id), `section?` (a section id,
  or `page:<n>` in the PDF view), `title?`, `places?` (a PDF highlight),
  `figures?` (boxed figures' image sources), and for a guided read
  `known?` / `learning?` (the course's concepts checked off, and not).

## Why it is shaped like this

- **Keyed by view, not by intent.** v7.0.0 deleted an orchestrator every
  route funnelled through, because it dispatched on an intent its callers
  already knew. This one dispatches on the view, which decides things no
  caller should restate. The orchestrators README tells the longer version.
- **Routing stays a separate call.** `route` decides; the client then
  streams with the workflow named. On the Citation Graph the client has work
  to do in between (a lecture's scope is resolved against the graph on
  screen, `frontend/src/scope/`), and a reader correcting a route names the
  workflow without a classify. A view with one workflow is never routed:
  asking a model to choose between one option is paying for a known result.
- **Everything that can refuse runs before the stream.** `run` builds the
  view's context and validates it, then returns the workflow's generator
  unstarted, so the route can still answer HTTP 400 (`RequestError`). The
  workflows are generators, so nothing reaches a model until the stream is
  read.
- **Every route is one its view offers.** `route` maps each router's answer
  onto the view's own workflows, and `run` refuses a workflow the table
  doesn't list, so a lecture can't be asked for in the Reader even by hand.
- **The context blocks moved unchanged.** `context.py` is the Reader's,
  the course's and the sibling chats' prompt-building from the old routes,
  renamed public; the words the model reads are byte-for-byte what they were.

## What it is the groundwork for

The OnePager's "One assistant" item, stage 1: one brain behind the panels
that exist today, with nothing visible changed. In later stages one
assistant docked beside whatever view is open calls this with the view on
screen, and each turn is tagged with where it was asked.

## How it's verified

`test/curious_astronaut/agents/orchestrators/assistant/`: `test_main.py`
pins the table (every view answers; only `general` searches papers) and that
every route is a workflow its view offers, even when a router answers its
loudest; `test_context.py` the history, sibling and course bounds. The HTTP
face — status codes, what reaches the researcher and lecturer per view, the
Reader's document and PDF fallbacks — is `test/curious_astronaut/routes/test_agents.py`.
