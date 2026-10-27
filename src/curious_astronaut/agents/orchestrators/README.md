# `agents/orchestrators`

The agents that own an outcome. Each one decides what the work is, delegates
parts of it, and is answerable for what the user finally sees.

```
orchestrators/
  assistant/      — the front door: one assistant, keyed by the view it's
                    asked from (v8.53.0)
  researcher/     — agentic Q&A, with or without a graph
  lecturer/       — the streaming lecture over the visible graph
  summarizer/     — one-shot paper TL;DRs
  reviewer/       — the Peer Reviews card: what later papers objected to
  tutor/          — the knowledge network: prerequisites and their lessons
  router/         — which of the two a typed message wants
```

(`query_analyst/` sat here until v7.6.0 — a one-shot seed-search query
expander. The paper scout absorbed both halves of its job, so it went rather
than leave two implementations of "search papers". See `docs/history.md`.)

The other tier is `workers/` — one source each, one bounded question each.
The membership rule and the return-shape contract live in
[`../workers/README.md`](../workers/README.md); read that first if you're
deciding where something new belongs.

## Why the tier exists

Not every agent here delegates today — `summarizer` is a one-shot micro-agent
with no sub-agents at all. It lives here anyway, because the line that matters
is **who owns the result**, not who currently has employees. A summarizer's TL;DR is shown to the reader as the app's
answer; a worker's findings never are.

The practical version of that ownership, and the reason it can't be split:
the researcher owns the **numbered paper list**. `[n]` must mean the same
paper to the prose, the citation resolver, the provenance count and the
frontend chip that builds a graph from it. That invariant holds exactly as
long as one agent assigns the indices — which is why `find_papers` receives
raw provider nodes from the paper scout and numbers them itself.

## The router, and the one that isn't

There used to be an `orchestrator/` in this folder: one `run(intent, ...)`
entry point that every route funnelled through, dispatching on an `Intent`
enum. It was **deleted in v7.0.0**, along with the enum, because it had
stopped earning its place — it dispatched two known intents to two agents and
never grew the model half it was designed around. Every caller already knew
which workflow it wanted, so the enum was a string round-trip between a route
and the function next to it.

Routing lived in the routes after that, which is where the intent already
was: `/api/lecture` called the lecturer, `/api/ask` and `/api/ask_sources`
the researcher. Two things the router carried had to land somewhere real,
and neither belonged to it:

- **The Done/Error termination contract** — a stream that simply stops looks
  identical to one still working, so the panel would wait forever. It is now
  `streams.terminated`, shared plumbing wrapping any workflow. A workflow is
  responsible for its events, not for how a transport learns it finished.
- **Lecture mode scoping** (`_story_nodes`, `_chronological`) — which visible
  nodes a mode may narrate, and in what order. That is lecture domain logic
  and moved into `lecturer/main.py`, which now scopes its own input: callers
  pass everything on screen rather than pre-filtering. (One visible
  consequence: a lecture's numbered list is chronological, so `[1]` is the
  oldest paper.)

**`router/` (v7.20.0) is the model half finally being wanted** — and it is a
different shape on purpose. The deleted orchestrator was a funnel every route
passed through, threading an enum between callers that already knew their
own workflow. This one is a **classifier with one caller**: the chat composer,
holding a sentence a person typed, for which working out what the sentence
*is* is the entire job. A caller that already knows the workflow — a reader
correcting a route — names it and is never classified, so nothing pays for a
decision it doesn't need. Since v7.23.0 the router also
reads a lecture's **scope** off the message ("lecture me on the references",
"…on the Bekenstein paper"), with a second, rarer call resolving named papers
against the graph. See [`router/README.md`](router/README.md) for the
two-stage design, the scope, and why every failure answers the question.

## `assistant/`, and why it isn't the funnel again (v8.53.0)

`assistant/` is a single entry point every question passes through, which is
what v7.0.0 deleted. The difference is what it is keyed by. The old funnel
dispatched on an **intent** the caller already knew, so the enum was a
string round-trip. `assistant.run` dispatches on the **view** the question
was asked from, and the view decides things no caller should restate:
which workflows may run there, whether the researcher may search the
literature, and what the view lends the prompt (the paper being read, a
course, the graph in scope). Before it, those facts were spread over seven
routes as a `paper_search=False` here and a missing endpoint there; now
they are one table (`assistant/views.py`).

It is also what the OnePager's "One assistant" item needs: one assistant
docked beside whatever view is open knows the view and the message, nothing
more, so something has to turn those into tools and a workflow. The
workflow is still named by the caller, after `assistant.route` (or a
correction) decides it, so a correction never pays for a classify.

## What moved here, and what it cost

All five packages moved from `agents/` in v7.0.0 with **no behavior change**
(the fifth, `orchestrator/`, was then deleted — see above).
Worth knowing if you're grepping history: `AGENT_ID` is a string constant
independent of package path, so no `config.llm.agents` entry moved and no
config churn was involved. The only mechanical cost was relative-import
depth (`from ..` became `from ...` inside each package).

## How it's verified

Each package has its own tests under
`test/curious_astronaut/agents/orchestrators/<name>/`, mirroring the source tree. The
researcher's are where the two-tier contract is actually pinned — it stubs
the workers rather than the provider calls beneath them, so the assertions
are about the seam that exists rather than the plumbing behind it. The router's most
valuable tests are its *negative* ones: the phrasings its no-model fast path
must **not** claim, since being narrower than it could be is the whole
justification for having one.
