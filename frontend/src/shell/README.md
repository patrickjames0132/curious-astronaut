# `src/shell`

The left rail names explorations and nests their threads. `SideBar.tsx` owns the
parent navigation; `SessionRow.tsx` supplies the shared rows and menus; `ThreadList.tsx` shows General and graph
threads beneath the active exploration. A row selects that discussion and its
graph together. The ellipsis opens Rename/Delete, with inline editing after Rename. Running conversations show a working indicator even off-screen.

`useSessions.ts` remains the thin server-list CRUD client. `useExplorations.ts`
coordinates that list with the live Redux exploration records. Returning to a
live exploration uses memory, not an older server response. A first server load
passes through the lazy migration in `store/threadPersistence.ts`.

## Saving without losing background work

Each save takes one immutable state snapshot before any await. It includes all
threads of the exploration, not whichever chat happens to be visible when the
network request finishes. The short debounce coalesces streamed changes; a
settled background conversation participates in the same snapshot. Naming runs
independently, so a slow model never delays storing the reader's words. Only the
first substantive request names an exploration, and manual names persist.

`saveQueue.ts` serializes writes per exploration. It records the latest body in a
local outbox synchronously, which covers page closure while an earlier network
request is in flight. An acknowledgement removes only its own exact body, never a
newer pending one. On launch pending bodies are replayed; opening a row waits for
its pending recovery. Deletion stops queued writes, waits for any request already
sent, then removes the row, so autosave cannot resurrect it.

A newly read legacy record establishes an in-memory baseline. It is not written
merely because its graph was rebuilt. New turns, thread navigation, renames and
other saved edits cause subsequent saves in the new format.

## Summaries

A thread is settled when its Redux `running` list is empty. Its completed history
(including lecture prose) feeds `/api/sessions/summary` when it has moved beyond
`summarizedThrough`. The response is accepted only for the transcript length it
read. One attempt per observed length prevents provider failure from creating an
unbounded retry loop. Summaries are persisted with the thread and rolled up into
the exploration's saved summary. They are background context, never substitutes
for the actual transcript.

## Verification

`test/shell/useExplorations.test.ts` exercises the real hook with isolated Redux
stores and stubbed APIs. It covers empty sessions, debounced streams, stable row
identity, one-time naming, delayed naming, a new General chat's naming (v8.31.0), background writes, legacy reads and
deletions. `saveQueue.test.ts` covers ordered writes and browser-close recovery.

Explorations and threads share `SessionRow`: identical typography, spacing,
hover controls, Rename/Delete menu and inline name editing (Enter or blur saves;
Escape cancels). Deleting an active thread returns to a General chat and
discards its transcript.

**Chats and Papers** (v8.31.0, Patrick). One General chat meant a reader
who'd used it for a search had to clear it to talk about anything else, so
an exploration can hold several chats now — and once it could, a flat list
mixing them with paper threads stopped saying which row was which.
`ThreadList` groups them: **Chats** (threads with no paper) then **Papers**
(one per paper opened; the header shows once there is one), each header a
caret that folds the group and a ＋ on hover.

- **A thread's group is what it is**, never what's typed in it. The
  Papers ＋ opens a chat with `@` typed (`newGeneralChat({ forPaper })`,
  handing the draft to the composer through `teacher/composerDraft`); delete
  the `@` and it's an ordinary chat, which it was all along. A paper joins
  Papers only when one is opened.
- **Both ＋s reuse an empty chat** rather than adding one, so chats opened
  and abandoned don't pile up as `New chat`s.
- **Every chat is named from its first exchange**, the first one included
  (an exploration saved before keeps its `General`). A new chat is **New
  chat** until its first answer or search has landed and settled; then
  `useExplorations` names it with the titler an exploration's first save
  uses (`titleForConversation`), falling back to the question without its
  `@` attachments line. One try per chat, and only while it still wears the
  placeholder (`awaitsTitle`), so a reader's own rename always wins.
- Every chat renames like any thread, and deletes while another remains:
  the last one's menu has no Delete (`onDelete` absent).
- **A chat's ⋮ has ↻ Re-summarize**, as an exploration's does: its
  first-exchange name goes stale as the talk wanders, so `ThreadList` titles
  it again from every question it holds (attachment lines stripped; a null
  title leaves the name). Paper threads don't get it: their natural name is
  the paper's, though they rename like any thread.

Each exploration has a caret. Only the active, expanded exploration renders
its thread list; a fresh unsaved exploration never appends an orphan General
beneath another session. `SideBar.test.tsx` verifies collapse, new-exploration
navigation, rename and active-thread deletion.

The rail helmet has a glass-blue shell outline only in the app’s light theme.
The browser favicon similarly drops its outline when the browser reports a dark
color scheme (`prefers-color-scheme`), independently of the app setting.
The theme action glyph fades and turns as the new palette fades in.
