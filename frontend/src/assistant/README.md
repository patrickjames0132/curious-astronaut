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

## Verified by

The tools' own tests drive it end to end: `test/knowledge/KnowledgeNetwork.test.tsx`
(Explain and Chat into the course's chat) and `test/reader/Reader.test.tsx`
(Explain, Simplify and Chat into the Reader's), with `test/store/chats.test.ts`
and `test/store/threads.test.ts` for the chats' keys, listing and saving.
