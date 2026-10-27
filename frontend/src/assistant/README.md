# `src/assistant`

The **docked assistants** a tool keeps beside itself (v8.38.0): one panel and
one stream engine shared by the Knowledge Graph's assistant (v8.25.0) and the
Reader's (v8.38.0). They answer through the same graph-free researcher, each
over what its tool shows, and differ only in their words and what they send.
The Citation Graph's assistant (`teacher/Teacher`) is not one of these: it
carries lectures, paper filters and the landing chat besides. Since v9.0.0
all of them talk in **the dock's chat** (`store/chats`): the chat you were
last in, each question tagged with the paper and tool it was asked beside.

```
assistant/
  DockedAssistant.tsx — the panel: transcript, composer, quote card, ✕, the @ list
  askAssistant.ts     — the stream engine (a thunk), Stop and Clear, the
                        passage messages (quotedMessage, passageMessage)
  inFlight.ts         — the answer in flight in each chat, shared with
                        teacher/useConversation (v9.0.0)
  useTurnTags.ts      — a question's tag as its bubble shows it (v9.0.0)
  DockChatPicker.tsx  — the line under a docked panel's title: its chat, and a
                        menu to switch to another or start one (v9.0.0)
```

The tools' own layers are thin:

| Tool | Panel | Ask | Tag |
| --- | --- | --- | --- |
| Knowledge Graph | `knowledge/assistant/CourseAssistant` | `askCourse` (the `knowledge` view: the course) | `<paper> › Knowledge Graph` |
| Reader | `reader/ReaderAssistant` | `askReader` (the `reader` view: the paper id and section) | `<paper> › Reader` |

Both ask the one backend assistant, `POST /api/assistant` (v8.53.0), naming
the view they ask from (`api/agents.ts`); the view decides what the model
reads and which tools it gets.

## Why it is shaped like this

- **Generalized, not copied** (v8.38.0). The Reader needed what the
  Knowledge Graph's assistant already was, with different words and context.
  `CourseAssistant` and `askCourse` were lifted here with every
  course-specific piece made a parameter: the panel takes a `copy` (title,
  hint, notes line, tip, placeholder, class, width key), an `available` flag
  and an `ask` thunk; the engine takes a `prepare(thread)` that returns the
  tool's stream call, or null when there is nothing to ask over yet. The
  course's messages are byte-for-byte what they were, so its tests didn't
  change.
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

The OnePager's "One assistant" item (2026-10-24, redesigned 2026-10-26)
folds these panels into a single assistant docked beside whatever view is
open (stage 3); the shared chat is stage 2a's, and this package is the
groundwork for the rest.

## What an answer can light (v8.45.0)

`DockedAssistant` takes an optional `passages` (`AnswerPassages`): told when
an answer finishes, when one is clicked, and when one of its quotes is, and
which answer is lit. Only the Reader's assistant passes it, to light the
paper's words an answer is about (`reader/README.md`); without it answers
stay unclickable, as the Knowledge Graph's are.

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
turn). The Reader's guided read is its one user. `DockedAssistant` passes
beat clicks and Back / Next through `AnswerPassages` (`activeBeat`,
`onBeat`). The lecture's button, **Give Lecture**, is the Reader's, by the
paper's title, not the panel's.

## Verified by

The tools' own tests drive it end to end: `test/knowledge/KnowledgeNetwork.test.tsx`
(Explain and Chat from the course) and `test/reader/Reader.test.tsx`
(Explain, Simplify and Chat from the Reader), into the dock's chat.
`test/assistant/askAssistant.test.ts` pins the tag and that a question
supersedes the other engine's answer in the same chat;
`test/teacher/transcript/ChatMessage.test.tsx` the tag on the bubble; and
`test/store/chats.test.ts` and `test/store/threads.test.ts` the dock's chat,
listing, saving and where a tag goes.

Quick response stamps `ChatMsg.quickResponse` when the replacement turn starts,
before streaming begins. All chat transcripts show a muted “Quick response”
label with a colored bolt beside the clock immediately, retaining it on the
finished/saved turn. Its tooltip says “Answered from the model’s own knowledge.”
