# `src/store`

The store separates an exploration, its threads, and the workspace currently
on screen. A paper thread owns one graph and its other views; a chat owns a
transcript, and since v9.0.0 only chats do (see "Chats own the conversation"
below). Opening another graph changes the active thread; it never replaces the graph
beneath an unrelated conversation. This deliberately reverses v7.10.0: the
continuity that release protected now belongs to the parent exploration.

## Ownership and navigation

`explorations.ts` owns the parent records, thread order and names, summaries,
and parked workspace states. A chat (a thread with no paper, `identity:
null`; "General" before v8.31.0) is created with each exploration, titled
`New chat` until its first exchange names it; more can join it since
v8.31.0 (`generalChatAdded`, inserted after the last chat; `newGeneralChat`
reuses an empty one instead). Deleting the last one left starts it over
(v9.3.0): `deleteThread` adds a fresh `New chat` before removing it, so an
exploration always keeps one, and the menus offer it only once that chat has
been talked in (`chats.ts`'s `chatDeletable`). A chat holds its conversation
from creation (`generalChatAdded` seeds it in `transcript.ts`), not from when
it's first opened: one started in the dock beside a paper is never opened. An old exploration's chat still titled `General`
is named from its conversation like a `New chat` (`awaitsTitle`). Titles stay
unique in an exploration (`uniqueTitle`, a clash gets ` (n)`), because a
chat is referenced by title: the `@` list, a sent `@thread[Title]`, the
sibling index. A graph thread's identity is provider + resolved seed id, so returning
to the same paper reuses its thread, while identical ids from different providers
cannot collide. The seed title supplies the initial thread name; users can rename it.

**Switching the data source moves the thread you're in** (v8.28.1). Because
identity includes the provider, `switchProvider` used to find no thread for
the new key and open a twin beside the old one, with the chats and the course
left behind. Now it rebases the active paper thread instead
(`explorations.threadRebased`): same id, title, chats and course; new
identity, `data.provider`, `graph_ref`, card details, and the course's root
paper id (lessons resolve the PDF by it). A graph **on screen** rebuilds right
away (`loadGraph`'s `rebase`, which also clears the old provider's
discoveries and selection); on the cards or the course one paper lookup
moves the thread (`rebasePaper`) and the loaded graph stays in memory.
`openTool` rebuilds it on open only if `graphProvider`, the provider it was
built under, still differs from the selected one, so switching away and back
before opening rebuilds nothing (Patrick). A thread that already holds the new identity (a twin from
before this) is resumed rather than duplicated. On General the switch only
changes the provider for the next search.

## Paper threads, their cards and their tools (v8.13.0)

A thread with a seed is a **paper thread**, and it shows one surface at a time:
its card home or a tool a card opened. `ThreadRecord.tool` remembers which
(`'cards' | 'graph' | 'knowledge' | 'reader' | 'reviews'`), so a revisit reopens it
(and since v8.40.0 `ThreadRecord.readerView`, the Reader's Text/PDF choice;
since v8.44.0 `readerPlace`, where the reader was in the paper, and
`returnTo`, a way back to the tool that opened this one (the Reader, from a
lesson or a cited paper on the graph it opened, v8.49.0; Criticisms, from a
citing paper it showed in the Citation Graph), which lasts only
while the thread stays on the tool it was set for); `threadTool()`
reads it, returning null for General and `'graph'` for a thread saved before
the field existed, since those always showed their graph. `ThreadRecord.paper`
holds the seed's hydrated details for the card home's header. Both are thread
metadata, so `explorationBody` saves them with no extra wiring.

Before v8.13.0 only a graph build could resolve a seed's id, so a thread could
not exist without its graph. `openPaper` resolves the id with one
`/api/paper` lookup instead and creates the thread **on its cards, with no
graph**. The graph is built when its card is opened (`openTool('graph')`) and
then stays in memory when the reader goes back to the cards. The lookup's id
and the build's id can disagree. For that case, `loadGraph` falls back to the
thread the seed reference already belongs to rather than creating a second
thread for it. `workspace.openRequestId` marks a lookup in flight; anything
that replaces the workspace meanwhile drops it, and that is how a late lookup
knows it was superseded. `workspace.focusRequest` (v8.43.0) is a paper the
Citation Graph should select and centre once it shows, asked for by the
Reader's citation card (`graphFocusRequested`) and by Criticisms through
`showCiterInGraph`, which builds the graph if needed and first adds a citer
the graph lacks (with its citation edge to the seed) as a discovery, so the
button always lands on the paper; `GraphExplorer` clears it once it has acted.

`seedPaper` is the router for "open this paper": into `loadGraph` when the
reader is on the graph tool (wandering the map stays on the map), otherwise
into `openPaper`. `activateThread` and the exploration reopen in
`shell/useExplorations.ts` rebuild a graph only for a thread on its graph
tool. `loadGraph` itself always means "show me the graph", so it sets the
target thread's tool to `'graph'`.
`openThread` is what the rail and the chat's "Context from" links dispatch.
A thread that is not on screen is activated on the tool it was left on (a
graph comes back from memory); the thread already on screen goes up to its
cards (`threadCardsShown`). From v8.16.0 until 2026-10-30 it always landed on
the cards. A question's tag (`openTag`) still lands on cards first, through
`openThreadOnCards`, which rests the thread on its cards *before* activating
it so a thread left on its graph is not rebuilt only to be left.

**The knowledge network's course lives on its thread** too
(`ThreadRecord.knowledge`, v8.14.0), so it saves with the exploration like
`tool` and `paper`. Its reducers (`knowledgeStarted`, `knowledgeExpanded`,
`knowledgeLessonWritten`, `knowledgeKnownToggled`, `knowledgeOpened`) take an
explicit `threadId` rather than acting on the active thread. A tutor call that finishes after the reader has moved on
still lands on the course that asked for it, the same rule streamed answers
follow in `transcript.ts`. The graph rules themselves are pure functions in
`knowledge/model.ts`. A course saved in another shape (`version` ≠ 2) is
ignored by the reducers and replaced by `knowledgeStarted`.

`workspace.ts` holds the active graph, discoveries, selections, layout and view
filters. `expansionUndone` (v8.18.0) takes one of a paper's Expand hops back
off the discovery lists, with every discovered paper the graph can no longer
reach (`graph/expansions.ts`); a hop's ✓ is read off the same lists, so it is
saved with the thread for free. `threadActivated` parks the outgoing state and restores the incoming
state in one action, also handled by `transcript.ts` and `highlight.ts`.
Two scope fields for `scope/resolve.ts`'s priority list: `visibleNodeIds` is
the papers **passing the view filters** (published by `GraphExplorer` from
its eligible set, never the drawn one), the default; `selectedNodeIds` is
the selection, which outranks the filters and is saved with the thread —
written by the reader's hand and by a message that chose its own scope
(`useConversation.send` makes that scope the selection, permanently; there
is no separate per-turn scope state). `selectScope` resolves the two rungs
for the panel's readouts. The v7.23.0 `revealedNodeIds` is gone: a scoped
paper the filters hide is drawn by the canvas *because* it is selected,
derived rather than stored.
`loadGraph` resolves aliases before creating a thread. Refresh and display
changes stay with the current thread. A response from a superseded graph load
cannot navigate back over a newer user choice.

Only serializable data belongs here. The force simulation still owns its mutable
node positions, velocities and links. A canvas remount restores its graph and
filter state, but recalculates physics; coordinates are not saved.

## Conversations and streaming

`transcript.ts` keys conversations by chat (`chats.ts`: a chat's own id).
Every stream captures that key before starting and dispatches to it
explicitly. A background answer continues writing to its own conversation.
Its discoveries belong to the paper it was asked about, not the chat: when
that paper isn't on screen they wait in its entry's `pendingDiscoveries`
until it is displayed; they also participate in saves while it is away.
Deleting an exploration drops every owned conversation, so late events have
nowhere to land.

**Each answer is timed** (v8.33.0, `teacher/ResponseTimer`): `turnStarted`
and `turnCompleted` stamp `Date.now()` in their `prepare` (the reducer stays
pure, `timed()`), the first on the new assistant turn as `startedAt` and the
second turning it into `respondedIn`. Both live on the `ChatMsg`, so a
background answer keeps its clock and a finished one's time is saved with
the thread; a turn that fails or is stopped never completes and keeps no
time. **A conversation carries its model pick**: `model`, set by
`conversationModelSet` from `teacher/ModelPicker` and read by every ask as
it builds its request, so a background answer runs on the model it was
asked with. The pick isn't saved: a reload goes back to the default.

A turn begins with `unfinished: true`; only a successful terminal response
clears that flag. Partial answers remain readable but do not become model history.
Lectures live in `ChatMsg.beats`, not in a separate lecture slot. `teacher/history.ts`
converts completed prose and beats into model history and strips figure markers.
The same conversion is used for normal sends, retries and borrowed discussion.

## Chats own the conversation; views lend it context (v9.0.0)

An exploration is **a set of papers plus several chats** (the OnePager's
"One assistant", stage 2a). `chats.ts` says which is which:

- **A chat** is a thread with no paper (`identity: null`). It holds the
  conversation: its transcript is keyed by its own id (`data.chat`,
  `summary` and `summarizedThrough` when saved), and it is what `@`
  references, what the sibling index lists, and what the rail's Chats group
  shows.
- **A paper thread** is a view: its cards, Citation Graph, course, Reader and
  reviews, with all their view state. It holds **no conversation**. Its
  transcript entry exists only for `pendingDiscoveries`, the papers its graph
  found while it wasn't on screen.
- **The dock's chat** is `ExplorationRecord.chatId`, the chat you were last
  in: opening a chat sets it, opening a paper keeps it (`threadActivated`),
  the docked panel's chat picker switches it without leaving the view
  (`dockChatSet`, `workspace.newDockChat`; `assistant/DockChatPicker`), and
  deleting it falls back to the first chat (`dockChatId`). Every view's
  docked assistant talks in it. `selectChatKey` is the conversation on
  screen: the active chat, or beside a paper, the dock's chat.
  `transcript.activeKey` still means the **thread on screen**, a chat or a
  paper, which the graph's parking and a stale load's check rely on.
- **Every question is tagged** with where it was asked (`ChatMsg.tag`,
  `TurnTag`): a paper thread and its tool, or no tag for General. A label
  reads the paper's current title (`tagLabel`), falling back to the title
  stamped on the tag once the paper is deleted. `workspace.openTag` goes
  there: the paper on that tool, or the chat itself. A question about
  several papers at once (stage 4c) is tagged `across`, naming each of
  them (`acrossTag`, `tagPapers`), which is what asks it again across
  them; but it **reads as General** (`shownPlace`: its label, its filter
  key, and its "Ask from … instead"), since no view holds it and its
  answer cites the papers `[n]` already (Patrick, 2026-10-30).
- **One answer in flight per chat**, whichever view asked
  (`assistant/inFlight`): both stream engines share a chat now, so a new
  question supersedes whatever the chat was answering.

Until v9.0.0 a paper thread held a chat per tool instead (v8.25.0: its own,
the Citation Graph's; `courseChat`, `<threadId>:knowledge`; and since
v8.38.0 `readerChat`, `<threadId>:reader`), addressed by `chatKey`/`chatOf`
and labelled `PPO › Knowledge Graph`. There is no migration (Patrick: v9.0.0
is a major release, and nobody else had installed it): an 8.x save's paper
chats and summaries are dropped on load (`threadPersistence`'s
`chatsOwnTheConversation`) rather than read wrong.

## Persistence and migration

`threadPersistence.ts` writes a versioned exploration container containing thread
records. Each thread reuses `SessionData`: its chat, graph reference, discoveries,
layout, filters and selected ids. Parked simulation state is omitted. The graph
is rebuilt from its reference on a cold reopen, while agent discoveries are
stored because no provider rebuild could reproduce them. A failed rebuild must
not erase the only saved reference.

A legacy save becomes one exploration. Assistant graph stamps determine the
thread by seed + provider (falling back to the save's provider); the preceding
user turn travels with its answer. Unstamped turns stay with the save's own seed,
or General when it had none. Legacy standalone lectures and citation-field
aliases are retained. Migration happens in memory on load; opening a saved
exploration does not itself rewrite its blob.

`shell/useExplorations.ts` owns the autosave and navigation orchestration.
`shell/saveQueue.ts` orders whole-exploration writes and retains an unacknowledged
snapshot in a local browser outbox before awaiting the server. The outbox is
cleared only when that exact snapshot is acknowledged, and is replayed on the
next launch. SQLite remains the durable store.

## Other shared state and selectors

`library.ts` loads uploaded sources once and refreshes after source operations.
`highlight.ts` contains serializable paper ids and clears on navigation;
since v8.45.0 it also holds the Reader's lit passages (`passages`: the
thread, the answer, the passage its question was asked about, that
passage's places in the PDF and its labels (v8.48.0), the answer's quotes, and a counter of requests
to go to them), set by the Reader Assistant and shown by the Reader.
`selectScope` replaced `selectGroundingNodes`/`selectLectureNodes` in v7.24.0
(they intersected the selection with the visible set and kept hidden
discoveries for the researcher only); the one rule now lives in
`scope/resolve.ts`, and filters decide only the default scope. Paper
citations highlight their node on the canvas.

## Verification

`test/store/threads.test.ts` covers graph identity, General, selection restoration,
background token ownership, migration and serialization (a legacy save's
turns kept in its chat and tagged, an 8.x save's paper chats dropped), the
dock's chat following the chat last opened, and a tag going where it was
asked; `chats.test.ts` covers which threads are chats, the dock's chat, which
chats an exploration offers, mentions, and tag labels;
`test/assistant/askAssistant.test.ts` a docked question landing tagged in
the dock's chat and superseding the other engine's answer. Transcript tests cover
the keyed stream reducers. Shell tests cover write ordering, teardown recovery,
read-only legacy opening, deletion and preserving names. Build with `npm run build`
and run the offline suite with `npm test`.

Quick response preserves the working answer’s original start time when replacing
the exchange, so its running and completed timers include the full wait. New
messages and ordinary retries start a fresh clock.

Quick response stamps `ChatMsg.quickResponse` when the replacement turn starts,
before streaming begins. All chat transcripts show a muted “Quick response”
label with a colored bolt beside the clock immediately, retaining it on the
finished/saved turn. Its tooltip says “Answered from the model’s own knowledge.”
