# `src/assistant`

**One assistant for every view** (v9.0.0, the OnePager's "One assistant",
stage 3). The panel itself is `teacher/Teacher`: a chat's landing surface,
else docked beside whatever view of a paper is open, against the right edge
or along the bottom, and behind a floating 🎓 when closed. This package
holds what that one panel is built from beyond the Citation Graph's own
asking (`teacher/useConversation`): the engine the Knowledge Graph and the
Reader ask through, the shape a view lends the panel, the chat it talks in,
and the dock's controls. Until stage 3 the course (v8.25.0) and the Reader
(v8.38.0) each docked a panel of their own here, `DockedAssistant`.

```
assistant/
  views.ts            — what a view lends the one assistant (AssistantView):
                        its words, how it asks, what its answers light
  askAssistant.ts     — the course's and the Reader's stream engine (a thunk),
                        Stop and Clear, the passage messages
  inFlight.ts         — the answer in flight in each chat, shared with
                        teacher/useConversation (v9.0.0)
  useTurnTags.ts      — a question's tag as its bubble shows it (v9.0.0)
  DockChatPicker.tsx  — the line under the docked panel's title: its chat, and
                        a menu to switch to another or start one (v9.0.0)
  AssistantLauncher.tsx — the 🎓 in the top-right corner: opens it while
                        closed (v9.0.0)
```

The views' own layers are thin:

| View | Lends it | Ask | Tag |
| --- | --- | --- | --- |
| Knowledge Graph | `knowledge/assistant/useCourseView` | `askCourse` (the `knowledge` view: the course) | `<paper> › Knowledge Graph` |
| Reader | `reader/useReaderView` | `askOrGuideReader` (the `reader` view: the paper id and section) | `<paper> › Reader` |
| Citation Graph, cards, Peer Reviews, a chat | nothing: `Teacher` asks itself (`useConversation`) | `send` | `<paper> › Citation Graph`, or General |

All ask the one backend assistant, `POST /api/assistant` (v8.53.0), naming
the view they ask from (`api/agents.ts`); the view decides what the model
reads and which tools it gets.

## Why it is shaped like this

- **One panel, views lend it what's theirs** (v9.0.0, stage 3). The course
  and the Reader each docked a panel (v8.25.0, v8.38.0; generalized into
  one `DockedAssistant` in v8.38.0), beside a third for the Citation Graph,
  and each kept a column. Now `Teacher` is the panel for all of them, and a
  view's hook gives it an `AssistantView`: a `copy` (title, hint, notes line,
  tip, placeholder, class), an `available` flag, an `ask` thunk and, for
  the Reader, its `passages`. `Teacher` sends through the view's `ask` when
  there is one, else through `useConversation` as it always has, so the
  Citation Graph's routing, scope and lectures are untouched. The engine
  takes a `prepare(thread)` that returns the view's stream call, or null
  when there is nothing to ask over yet.
- **A thunk, not a hook.** Two places ask: the panel's composer, and a
  highlighted passage's action in the tool, which may fire while the panel is
  still closed (the shell opens it through the tool's `onAssistant`). The
  stream addresses its chat by key, so leaving the tool or the thread never
  stops or misroutes an answer; asking again in the same chat supersedes the
  last question.
- **One chat for every view** (v9.0.0, the OnePager's "One assistant",
  stage 2a). Until v9.0.0 each tool kept its own chat (Patrick, 2026-10-09);
  now a chat is a thread of its own and a tool is where a question was asked.
  Two things follow. **One answer in flight per chat** (`inFlight.ts`):
  the Citation Graph's engine and this one write to the same transcript, and
  a stream writes to the chat's last turn, so both take the chat's one slot
  and a new question supersedes whichever was answering. And **only a tool's
  own answers light it** (`AnswerPassages.owns`): the dock's chat also holds
  turns asked beside other views and papers, which stay unclickable here.
- **Tags show once a chat crosses views** (`useTurnTags.ts`). A chat whose
  questions were all asked with no view open is General throughout; from
  the first question asked beside a paper, every question wears its tag,
  and clicking one goes there (`workspace.openTag`).
- **A passage is quoted with where it's from.** `PassageQuote` is `{text,
  from}`, `from` a phrase ("the lesson on Q-learning", "section 3.2,
  Attention") that the quote card shows ("From …") and the messages carry
  ("Explain this passage from …"), so a transcript reads on its own later.

- **Docks right or along the bottom** (Patrick, at stage 3: as PyCharm docks
  a tool window). The header's dock button flips it, remembered. (Dragging
  its title toward an edge was tried and dropped: the drag selected the
  text it passed over, Patrick.) The
  graph, the course and the paper are wider than they are tall, so a bottom
  dock costs them less. Below 900px it covers the view instead of
  squeezing it, and Esc from inside puts it away.
- **One 🎓, in the corner** (`AssistantLauncher`). Each tool kept a 🎓 in
  its top-right corner; now one sits there over every view (Patrick: the
  bottom right is where the views keep their find bars). It was draggable
  for one round, its spot remembered and a ↺ to put it back; Patrick
  preferred it staying put.

## What an answer can light (v8.45.0)

A view may lend `passages` (`AnswerPassages`): told when an answer is
clicked, and when one of its quotes is, and which answer is lit; the
Reader's view watches for an answer finishing itself. Only the Reader's
view has them, to light the paper's words an answer is about
(`reader/README.md`); without them answers stay unclickable, as the
Knowledge Graph's are.

A passage highlighted in the Reader's PDF view carries **places** too
(`PassageQuote.places`, `AssistantQuestion.places`): where it sits on the
page. `askAssistant` keeps them on the user turn (`ChatMsg.places`) and
sends them with the question, so the server can picture the passage for
the model; a retry sends the turn's places again. Figures boxed in the
Reader's text go the same way (`figures`, kept as `ChatMsg.boxedFigures`,
v8.48.0): the server sends the model their images. And the labels a
passage covers (`labels`, "Figure 1", "(6)") are kept on the turn, not
sent: the Reader lights the passage by them in whichever view it's in.

## Lectures in a docked chat (v8.50.0)

`lectureAssistant` streams a lecture into a tool's chat as one answer turn
of beats, with `askAssistant`'s bookkeeping (a new message supersedes it,
Stop and Clear end it, a lecture that produced nothing says so on its
turn). The Reader's guided read is its one user. `Teacher` passes beat
clicks and Back / Next through `AnswerPassages` (`activeBeat`, `onBeat`). The lecture's button, **Give Lecture**, is the Reader's, by the
paper's title, not the panel's.

## Verified by

The tools' own tests drive it end to end: `test/knowledge/KnowledgeNetwork.test.tsx`
(Explain and Chat from the course) and `test/reader/Reader.test.tsx`
(Explain, Simplify and Chat from the Reader), into the dock's chat.
`test/assistant/askAssistant.test.ts` pins the tag and that a question
supersedes the other engine's answer in the same chat;
`test/teacher/transcript/ChatMessage.test.tsx` the tag on the bubble; and
`test/store/chats.test.ts` and `test/store/threads.test.ts` the dock's chat,
listing, saving and where a tag goes; `test/assistant/AssistantLauncher.test.tsx`
that the 🎓 opens it; and
`test/App.test.tsx` one assistant beside every view, docked right or bottom.

Quick response stamps `ChatMsg.quickResponse` when the replacement turn starts,
before streaming begins. All chat transcripts show a muted “Quick response”
label with a colored bolt beside the clock immediately, retaining it on the
finished/saved turn. Its tooltip says “Answered from the model’s own knowledge.”
