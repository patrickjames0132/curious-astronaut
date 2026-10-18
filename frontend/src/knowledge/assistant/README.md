# `src/knowledge/assistant`

The **Knowledge Graph Assistant** (v8.25.0; the code calls it the course
assistant, `CourseAssistant`): the Knowledge Graph's own chat, docked
beside a thread's course the way `teacher/Teacher` docks beside the Citation
Graph. Ask what a concept means, how two connect, or what to study next; a
lesson's **Explain** (a highlighted passage, `../SelectionMenu.tsx`) asks
here too.

```
assistant/
  CourseAssistant.tsx — the docked panel: transcript, composer, ✕, the @ list
  askCourse.ts        — the stream engine (a thunk), Stop and Clear, Explain's message
  context.ts          — the course as the assistant reads it, and its outline
```

## Why it is shaped like this

- **The researcher, generalized, not a new agent** (Patrick, 2026-10-17).
  `POST /api/ask_course` runs the same graph-free researcher as the General
  chat, with the course laid out where a graph would be
  (`routes/agents.py`, `_course_context`). So it keeps the library, paper and
  web search, the citation chips and the trace, and the transcript renders
  exactly as Teacher's does (`teacher/transcript/ChatMessage`). Its prompt
  tells it whose assistant it is and to answer a question *about the course*
  from the course, searching only when the question reaches past it.
- **What it reads** (`context.ts`): every item in teaching order (the paper
  first), with its kind, check-off, what it needs and why, a synthesis's
  concepts and target, and **every lesson written so far**, image markers
  removed. The server shows the open lesson whole and the others' openings,
  under a ceiling, so a long course can't crowd out the question.
- **Its own chat** (`store/chats`). Assistants are encapsulated per tool
  (Patrick, 2026-10-09): this one writes to the thread's Knowledge Graph
  chat, key `<threadId>:knowledge`, saved as `ThreadRecord.courseChat`, with
  its own rolling summary for the sibling index. The Citation Graph's chat
  is untouched, and `@` reaches either from the other.
- **A thunk, not a hook.** Two places ask: the composer, and Explain in the
  lesson panel, which may fire while the assistant is still closed (it opens
  through the shell's `onAssistant`). Both dispatch `askCourse`, and the
  stream addresses its chat by key, so leaving the course or the thread
  never stops or misroutes an answer, as in `teacher/useConversation`.
  Asking again in the same chat supersedes the last question.
- **Smaller than Teacher on purpose**: no landing shape, no lecture routing,
  no paper filters, and its `@` list offers chats only: a paper picked there
  would be nothing but its title in the question, since this agent has no
  numbered papers to attach it to. It does share Teacher's 📚 source picker
  and the one-line notes over the bar (`teacher/SourcePicker`,
  `teacher/ComposerNotes`; Patrick noticed the picker missing at the first
  browser round).
- **The tutor's suggested syntheses are still to come.** The OnePager's
  Knowledge Graph assistant ticket planned them as this assistant's tool; it
  shipped without them (Patrick, 2026-10-17) and they stay an open follow-up.

## Verified by

`test/knowledge/assistant/context.test.ts` (order, links, check-offs,
lessons, the outline), `test/knowledge/KnowledgeNetwork.test.tsx` (Explain
from a highlighted passage reaching this chat with the course, the graph
untouched), `test/teacher/history.test.ts` (the per-chat sibling index and a
mentioned course chat's outline), `test/store/threads.test.ts` (the chat
saved and restored beside the thread's own), `test/App.test.tsx` (where it
docks), and on the server `test/curious_astronaut/routes/test_agents.py`.
