# `src/teacher`

**The one assistant** (v9.0.0, the OnePager's "One assistant", stage 3).
One composer serves chats and every view of a paper: full screen as a
chat's landing surface, else **docked beside the view**, against the right
edge or along the bottom (the header's dock button), and behind the floating astronaut when
closed (`assistant/AssistantLauncher`). Below 900px it covers the view
instead of squeezing it, and Esc from inside puts it away. Until stage 3 it
docked beside the Citation Graph only (since v8.15.0), and the Knowledge
Graph and the Reader docked panels of their own; now they lend it their
words, their asking and the Reader's passages (`assistant/views`:
`useCourseView`, `useReaderView`), and `Teacher` sends through the view's
`ask` when it has one, else through `useConversation` as it always has.

It talks in **the dock's chat**, the chat you were last in (`store/chats`),
each question tagged with where it was asked (`ChatMsg.tag`, shown by
`assistant/useTurnTags`). A turn is the view's own when its question was
asked here (`owns`): only those it retries, answers quickly or re-routes,
since a turn asked beside another view needs that view's context. A turn
from another view links there instead (stage 4a, `elsewhere`): clicking it,
a `[n]`, a quote or a beat goes to that view and lights it. Once a chat
spans places, `assistant/TagFilter`'s menu over the transcript shows one at
a time. Before a question goes out, `placeOrHere` asks where it is about
(stage 4b, `api.routePlace`) when the exploration has another paper it could
mean; placed elsewhere, or across several papers (stage 4c), it is asked
there (`assistant/askAt`), and its bubble offers "Ask from … instead"
(`askInstead`).
A paper holds no conversation of its own, so
opening another paper keeps the conversation and changes the canvas under
it; a discovery for a paper no longer on screen waits on that paper
(`pendingDiscoveries`). Elsewhere Teacher stays mounted but hidden, so a
running answer keeps streaming. With the graph up, the composer names its
subject and scoped paper count.

**Why the graph alone** (Patrick, 2026-10-09). Beside the cards and the
Knowledge Graph this assistant could only answer seedless. `@thread`
borrowing assumed a thread *was* its graph conversation; v8.25.0 answered
that by making a reference address a **chat**, a thread and a tool, so the
Knowledge Graph got an assistant of its own rather than this one. v9.0.0
kept the panels apart but gave them one conversation: a chat is a thread of
its own now, and a tool is where a question was asked (its tag). One panel
for all of them is the OnePager's "One assistant", stage 3.

## Sending and streaming

`Teacher.tsx` owns input, menus, scope controls, scroll behavior and transcript
rendering. `composerDraft.ts` (v8.31.0) hands its input a draft from outside:
the rail's Papers ＋ opens a chat with `@` typed. The composer remounts with
every thread, so the draft waits until a General chat's composer mounts (or
hears the event, if one is already up) and takes it once; a docked one leaves
it. The draft is addressed to the new chat (v8.32.1): the ＋ hands it over
before the switch, so the General chat being left hears it first, and before
the address it took the `@` and was remounted away with it, which left the
first new chat empty. A chat that opens with its draft waiting skips the
bar's entrance (`drafted`, v8.32.1): the `@` list opens inside the bar's block,
and the block's fade left the list see-through over the landing picture.
`useConversation.ts` asks the router whether the message wants the
researcher or lecturer; graphless conversations bypass that choice. The routing
label lets readers correct a model-selected destination **in either
direction**: `lectureInChat` and `ask` both take a `routed` flag and stamp
their turn (`turnRouted`) only when the router chose them, so *"Answered as a
question · Lecture on it instead"* is the mirror of *"Answered as a lecture ·
Answer it instead"* (the answer side's stamp was missing until v7.27.0). A
correction, a retry, or a graph-free question carries no stamp and so no
offer — those were never a choice a model made. The transcript follows the
bottom while an answer builds **only if the reader is already there** —
scrolling up mid-answer to re-read must not be fought — with one exception:
starting a turn (a send from the bar, or a reroute click, which is by
definition made from further up) re-arms the follow, so the new turn's first
frame lands in view rather than below the fold. Lectures are ordinary
chat replies with beats, including real figures and citations. (A `/lecture`
command was the explicit path from v7.21.0 to v7.23.0; asking in words
replaced it once the router could read everything the command said, and more.)

**Which papers a turn is about is one rule, shared by both agents**
(v7.24.0, `scope/README.md` has the full story): what the message asked
for, else the hand-picked selection, else what passes the view filters.
`send` resolves it **once**, with the router's `scope`/period in play — "the
references", "the seed", named papers (one more call, `resolveRoutedPapers`,
with titles/authors/years only), "between 2016 and 2017" — and hands the
same `ResolvedScope` to `ask` or `lectureInChat`, which stamp it on the turn
(`ChatMsg.scope`, shown as *"Scoped to the references, 2010–2019 · 12
papers"*) and never read the store for it again. A message scope **becomes
the selection** (`nodeSelectionSet`: ringed, drawn even where a filter would
hide it) and stays after the turn, like a pick made by hand — Patrick's
call: a request that changes the scope changes it, it does not borrow it. A
message scope that matches nothing **fails the turn in words** for either
agent, never falling through to the next rung, and leaves the selection as
it was. A correction (`reroute`) or a retry re-resolves the turn's *stamped
request* against the graph as it stands now, sets the selection again, and
re-asks. Callers that skip routing (graph-free asks) take `selectScope`, the
default.

Every lecture ends with all of its beats' papers lit and its bubble active —
the same state as clicking the bubble — rather than the last beat alone,
which read as the lecture pointing at its ending rather than at what it
covered.

Bare paper mentions and pasted paper ids open paper threads, through
`seedPaper`: onto the paper's graph when the reader is on the graph tool, onto
its cards otherwise. Paper mentions
inside questions attach those papers without changing the graph. The same `@`
dropdown lists this exploration's other discussions above the paper results;
choosing one inserts `@thread[Title]`, which `readMessage` keeps away from the
paper scout so a bare thread mention can never launch a literature search.
On the General chat a whole-message `@phrase` opens the list on its **search
row**, selected by default: Enter runs the full search, however far the
lookup has got (v8.29.0). A paper or thread is taken only once arrowed onto
(hovering selects nothing), and attaches as a chip that waits for the
question. Opening a paper has its own control: each paper row's Open button, or
Shift+Enter on it, seeds its thread (`openMention`; General chat only). The
composer feeds its resolved-mention keys back into the dropdown so a picked
title ends its mention rather than the question after it becoming the query.
See `../mentions/README.md`.

`useConversation.ts` captures the conversation key when a run starts. Background
tokens and beats land there, and discoveries are held for that thread if it is
not visible. Highlight and error effects consult the current store before
changing the screen. Controllers are retained by thread so returning to a running
discussion can stop it. A successful terminal response marks the turn complete;
aborted or failed partial prose remains visible but never enters model history.
⚡ **Quick response** (v8.30.0, `quickAnswer`) is the one stop that replaces
rather than keeps: on an answer still searching it aborts the run, drops the
working exchange (`failedTurnDropped`, as a retry does) and re-asks the same
question with `quick: true`, the researcher with no tools. `ask` keeps what
it was given in `lastAsk` (the question, named papers, scope and filters),
so the quick answer is about exactly the same papers.

## History and cross-thread knowledge

`history.ts` supplies one conversion for normal sends, retries and borrowed
history. A lecture's heading and beat prose become the assistant's content even
though its `text` field is empty. Failed and unfinished exchanges are excluded,
and `<<FIG n>>` placement markers are stripped. Every research request carries
client history; the backend no longer maintains endpoint-specific copies.

Each request also carries a sibling index: titles and summaries from this
exploration only, **one entry per chat** since v8.25.0 (a paper thread's
Citation Graph and Knowledge Graph each, labelled `PPO › Citation Graph` and
`PPO › Knowledge Graph`; `store/chats.ts`). The `@` dropdown lists the same
chats. Explicit `@thread[Label]` references attach that chat's completed
history, a course chat with its course's outline; a bare `@thread[Title]`
from before still means the thread's Citation Graph chat. The server bounds sibling count, summary length, history turns and total
borrowed text; it labels the result as quoted background with independent paper
numbering. Replies show a `Context from` line linking to explicitly attached
threads. Borrowing a discussion never silently swaps the canvas.

## Scopes and citations

Source exclusions remain panel-local; the uploaded-source list is shared Redux
state. `scope/resolve.ts` owns paper scope, for lectures and answers alike; a
discovery is in scope on the same terms as any other paper (eligible,
selected or named — no longer kept regardless for the researcher). Scope
changes do not invalidate earlier answers; each turn keeps its own stamp.

Paper citations highlight their node on the current graph, toggling off on a
second click. Graph icons on search references open or resume that paper's
provider-specific thread directly, on the same rule (graph from the graph,
cards from anywhere else). There is no intermediate paper modal.
Whole-answer and beat clicks highlight their cited papers — for a lecture
turn, the bubble lights every beat's papers at once (the lecture's whole
scope), a beat lights its own. `ChatMsg.graph`
remains for migration and lecture scope counts; observed grounding provenance
(papers, sources and web actually consulted) stays.

The transcript renders Markdown and KaTeX math, structured source references,
streamed tool traces, inline figures and expandable lecture beats. All of that
stays on its turn across save and restore. `transcript/README.md` describes the
rendering boundary; `../figures/README.md` (the shared folder, since v8.24.0)
describes figure placement.

## The composer's notes and the 📚 picker, shared (v8.25.0)

Four pieces of the composer are shared with the Knowledge Graph Assistant
(`knowledge/assistant/`), so the two bars read as one:

- **`ComposerNotes.tsx`**, the quiet lines over the bar: what the message is
  about ("Asking about PPO · 18 papers"), a hand-picked selection, and what
  answers also draw on. In a narrow panel they used to wrap into a block of
  grey text crowding the bar (Patrick, 2026-10-17). Each now keeps to one
  line, ending in an ellipsis with its full text on hover, and an ⓘ
  (`ui/InfoTip`, the 3D course's narrow-panel help) appears beside them,
  holding them all in full, whenever one is cut. That is **measured**, not
  read off the panel's width. The bar's placeholder keeps to one line the
  same way (`teacher.css`), where it used to wrap under a one-line bar. The
  ⓘ also always holds **the `@` tip** in full (how to name a paper or bring
  in another chat), and the placeholders name `@` again, cut short by a
  narrow panel (Patrick, 2026-10-17).
- **`@` attachments** (`mentions/AttachedChips`, `mentions/attachments`): a
  pick from the `@` list is a chip over the bar, not text in the question
  (v8.29.0), in this composer and the Knowledge Graph Assistant's alike, and
  a sent question shows the same chips above its text. Chips alone send
  nothing: Send waits for the question, and the placeholder asks for it.
- **`ModelPicker.tsx`** (v8.33.0), the Model picker beside 📚, a small network icon (a chip in the landing
  row, an icon in the docked bar): which model the researcher answers on in
  this conversation, from what `GET /api/settings/models` lists (fetched on
  each open, so a key added in Settings shows without a reload), under a
  "Settings default" that goes back to Settings → Agents. The pick is the
  conversation's (`Conversation.model`), sent with its every ask and read by
  the assistant's `main._model`; docked, a dot on the icon says the chat has
  its own. The bar's popovers stay one-at-a-time (`openScope`). On the
  empty landing chat its popover drops down from a bar centred mid-page, so
  it measures the room left and cuts its scrolling list (the only part that
  scrolls) to end 8px clear of the window's edge, however small that makes
  it; the wheel scrolls it in the smaller box. It never flips over the
  question box (Patrick). Measured in Patrick's browser, not guessed: two
  blind tries missed, because the shared `.scope-pop` cap made the popover a
  scroller of its own, and then because a 120px floor on the list still
  overran the 150px left under the landing bar.

**`ResponseTimer.tsx`** (v8.33.0) times each answer, pinned to the top
right of its block in the transcript (level with the "7 steps" toggle, or
in a slim header strip of its own when there are no steps: a float squeezed
every line under it, `teacher.css`) (`transcript/ChatMessage`, so every
chat's answers wear one): a running clock while the answer is on its way,
then a dimmed clock and duration. Both use whole elapsed seconds (and minutes
for longer answers), with a monochrome icon matching the readout. The completed
readout keeps “Responded in” in its accessible label, without the visible prefix. It was first a single readout over the chat bar;
Patrick wanted it on the answer it times. The times are the turn's
(`ChatMsg.startedAt` / `respondedIn`, see `store/README.md`), so a
background answer keeps its clock across thread switches and a finished
one keeps its time across a reload. A failed or stopped answer never
completes, so it shows none.
- **`SourcePicker.tsx`** and **`useSourceScope.ts`**, the 📚 picker and its
  choice (tracked by exclusion, so a new upload is searchable by default).
  Each panel keeps its own choice. Since v8.28.0 it is named **Library
  filters**, beside **▽ Paper filters** (`search/SearchControls`); it said
  "All sources" beside a "Filters" chip until then, and readers couldn't tell
  which narrowed what. The trigger wears the name alone: the state ("· 2 of
  5", "· off") is in its tooltip and in the "Answers also draw on 2 sources
  (📚)" note over the bar, which shows in every panel shape now, not just
  docked. Narrowed, the chip also wears a red corner badge with the count
  that's in (on the docked icon too) (`.chip-badge`, `search.css`), as Paper filters wears its
  applied count — the same badge the graph's nodes wear for hidden
  children. Where it sits depends on the panel's shape: docked, it is a round
  icon inside the bar beside 🗑, never lit (its badge says it's narrowed),
  with no row under the bar at all; on the landing chat it is a labelled chip in the row under the
  bar, beside the paper filters. The filters are the landing chat's alone:
  docked, nothing searches papers — the assistant's `citations` view runs
  the researcher with `paper_search=False`, and `@` offers chats only (`useMentionSuggestions`'
  `withPapers`, as the Knowledge Graph's assistant always has), so a bare
  `@words` there is just text in a message — and `Teacher` neither shows the
  filters docked nor sends them (`activeOptions`).

The panel's title is "Citation Graph Assistant" since v8.25.0 ("AI Teacher &
Discovery" until then), matching the "Knowledge Graph Assistant" beside the
course.

## Docked: closing and reopening

Beside a graph the panel's ✕ slides it off the right edge, and reopening
slides it back (`panel-out` / `panel-in`, v8.9.0). It never unmounts — that
is what keeps the conversation — so `ui/usePresence` only delays the
`.collapsed` class (`display: none`) until the slide-out has played. The
slide-in is tied to the **reopen** (`reopening`, set when `collapsed` flips
false), not to the class, so the panel arriving with its graph is left to
the graph's own entrance.

## The landing

With no graph and an empty transcript the composer is the whole page: the
astronaut painting, the greeting, then the bar, rising in together on one
entrance. The painting is **two cuts of one full-bleed image**, both oval and
the same proportions, picked by theme in `teacher.css`:

- **Dark** is the painting as painted, its rectangle dissolved by an elliptical
  `mask-image`, so the nebula thins into a page whose navy is close to its own.
- **Light** can't fade that way — dark paint at partial alpha over off-white is
  a grey haze — so its oval is *painted*: the image sits on white paper inside
  a watercolour brush edge, and `mix-blend-mode: multiply` turns the paper into
  exactly the page colour. The edge was lifted from an earlier, square version
  of the painting and remapped onto an ellipse (measure where its paint ends in
  every direction, smooth away the square, keep the brush wiggle).

The empty General/new-exploration entrance takes 550ms for both rise and fade,
with the composer following the picture and greeting by 120ms.

**A theme switch replays the entrance** for all three parts at once. The
effect restarts their CSS animations in place through the Web Animations API
(`getAnimations()` → cancel, play) rather than remounting — a remount would
drop a half-typed question. Both WebPs live in `frontend/public/`; the
full-size source paintings are deliberately kept out of the repo. The images
are decorative (`alt=""`): the greeting is the content.

## Verification

`test/teacher/useConversation.test.tsx` runs the real hook through a lecture and
an ordinary follow-up, asserting that researcher history includes the lecture —
and through the scope priority list's acceptance cases (see
`scope/README.md`): what reaches each agent, a message scope becoming the
selection and staying, an unmatched scope failing the turn, a correction
re-asking for the same papers. `test/scope/resolve.test.ts` pins
the rule itself. `history.test.ts` covers
incomplete exchanges and figure-marker removal. Teacher and transcript
component tests exercise layout controls, lecture folding and citation clicks
offline. Browser handoff checks the complete flow:
General search, two graph threads, independent follow-ups, cross-thread comparison,
and return to the first graph without losing its conversation or selection.

Quick response preserves the working answer’s original start time when replacing
the exchange, so its running and completed timers include the full wait. New
messages and ordinary retries start a fresh clock.

Lecture timers sit in a shared header row beside scope and routing metadata,
with baseline alignment and wrapping text, rather than the standalone answer
timer’s reserved top strip.

Quick response stamps `ChatMsg.quickResponse` when the replacement turn starts,
before streaming begins. All chat transcripts show a muted “Quick response”
label with a colored bolt beside the clock immediately, retaining it on the
finished/saved turn. Its tooltip says “Answered from the model’s own knowledge.”

The model picker caps its scrolling model list at 180px, including when its
window-fitting measurement finds more room. In tight windows it shrinks further;
the heading, close control and Settings default stay outside the scrolling list.

Quick responses in General and Citation Graph chats retain “Answered as a
question” and the completed answer’s “Lecture on it instead” action, alongside
the Quick response status. The routing label is stamped before streaming.
