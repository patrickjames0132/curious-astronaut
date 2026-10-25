# `src/assistant`

The **docked assistants** a tool keeps beside itself (v8.38.0): one panel and
one stream engine shared by the Knowledge Graph's assistant (v8.25.0) and the
Reader's (v8.38.0). They answer through the same graph-free researcher, each
over what its tool shows, and differ only in their words, their chat and what
they send. The Citation Graph's assistant (`teacher/Teacher`) is not one of
these: it carries lectures, paper filters and the landing chat besides.

```
assistant/
  DockedAssistant.tsx — the panel: transcript, composer, quote card, ✕, the @ list
  askAssistant.ts     — the stream engine (a thunk), Stop and Clear, the
                        passage messages (quotedMessage, passageMessage)
```

The tools' own layers are thin:

| Tool | Panel | Ask | Chat key | Saved as |
| --- | --- | --- | --- | --- |
| Knowledge Graph | `knowledge/assistant/CourseAssistant` | `askCourse` (`/api/ask_course`, the course) | `<thread>:knowledge` | `ThreadRecord.courseChat` |
| Reader | `reader/ReaderAssistant` | `askReader` (`/api/ask_reader`, the paper id and section) | `<thread>:reader` | `ThreadRecord.readerChat` |

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
- **Its own chat per tool** (Patrick, 2026-10-09). `store/chats` lists the
  side-chat tools once (`SIDE_CHAT_FIELDS`), and saving, seeding, summaries,
  the `@` list, the rail's working dot and deletion all loop over it, so a
  third docked assistant is one entry there plus its layer here.
- **A passage is quoted with where it's from.** `PassageQuote` is `{text,
  from}`, `from` a phrase ("the lesson on Q-learning", "section 3.2,
  Attention") that the quote card shows ("From …") and the messages carry
  ("Explain this passage from …"), so a transcript reads on its own later.

The OnePager's "One assistant across the tools" item (2026-10-24) plans to
fold these panels into a single floating assistant; this package is the
groundwork for it.

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

## Verified by

The tools' own tests drive it end to end: `test/knowledge/KnowledgeNetwork.test.tsx`
(Explain and Chat into the course's chat) and `test/reader/Reader.test.tsx`
(Explain, Simplify and Chat into the Reader's), with `test/store/chats.test.ts`
and `test/store/threads.test.ts` for the chats' keys, listing and saving.

Quick response stamps `ChatMsg.quickResponse` when the replacement turn starts,
before streaming begins. All chat transcripts show a muted “Quick response”
label with a colored bolt beside the clock immediately, retaining it on the
finished/saved turn. Its tooltip says “Answered from the model’s own knowledge.”
