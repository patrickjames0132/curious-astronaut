# `src/assistant`

**One assistant for every view** (v9.0.0, the OnePager's "One assistant",
stage 3), called **Nova** wherever the UI names it: the panel's title, the
launcher, the tooltips and the tour (the code keeps saying "assistant").
The panel itself is `teacher/Teacher`: a chat's landing surface,
else docked beside whatever view of a paper is open, against the right edge
or along the bottom, and behind a floating astronaut when closed. This package
holds what that one panel is built from beyond the Citation Graph's own
asking (`teacher/useConversation`): the engine the Knowledge Graph and the
Reader ask through, the shape a view lends the panel, the chat it talks in,
and the dock's controls. Until stage 3 the course (v8.25.0) and the Reader
(v8.38.0) each docked a panel of their own here, `DockedAssistant`.

```
assistant/
  views.ts            — what a view lends the one assistant (AssistantView):
                        its words, how it asks, what its answers light
  askAssistant.ts     — the stream engine (`streamAnswer`, a thunk), the
                        course's and the Reader's asking through it, Stop and
                        Clear, the passage messages
  askAt.ts            — asking a question in a view that isn't on screen,
                        in General, or across several papers, where the
                        router placed it (stages 4b, 4c)
  pendingAsk.ts       — a placed lecture, waiting for the panel that arrives
                        at its view to ask it (stage 4b)
  keepChatInView.ts   — the full-screen chat, taking the reader to a paper,
                        asks the shell to open the dock there
  inFlight.ts         — the answer in flight in each chat, shared with
                        teacher/useConversation (v9.0.0)
  useTurnTags.ts      — a question's tag as its bubble shows it, and the
                        anchor a click leaves to keep its turn in view (v9.0.0)
  TagFilter.tsx       — the "Showing: All ▾" menu filtering a chat by where
                        its questions were asked (v9.0.0, stage 4a)
  DockChatPicker.tsx  — the line under the docked panel's title: its chat, a
                        menu to switch to another or start one, and a 🗑
                        that expands right into a compact confirmation; a
                        second click deletes it (v9.0.0), and on the last
                        chat leaves a new empty one, so the last chat shows
                        it only once talked in (v9.3.0, `chatDeletable`)
  AssistantLauncher.tsx — the astronaut, top-right until dragged of the view's canvas: opens it
                        while closed (v9.0.0)
```

The views' own layers are thin:

| View | Lends it | Ask | Tag |
| --- | --- | --- | --- |
| Knowledge Graph | `knowledge/assistant/useCourseView` | `askCourse` (the `knowledge` view: the course) | `<paper> › Knowledge Graph` |
| Reader | `reader/useReaderView` | `askOrGuideReader` (the `reader` view: the paper id and section) | `<paper> › Reader` |
| Citation Graph, cards, Criticisms, a chat | nothing: `Teacher` asks itself (`useConversation`) | `send` | `<paper> › Citation Graph`, or General |

All ask the one backend assistant, `POST /api/assistant` (v9.0.0), naming
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
  and clicking one goes there (`workspace.openTag`), keeping the question in
  view across the remount the navigation causes (`anchorTurn`).
- **An answer from another view links there** (stage 4a, `teacher/Teacher`'s
  `elsewhere`). What it lights is in that view: a graph's papers, a Reader's
  passages. So clicking the answer, a `[n]`, a quote or a beat goes there
  first, keeps the turn in view, then lights it, through the same highlight
  the view would have set itself (`store/highlight`; `reader/askReader`'s
  `answerLight` and `beatLight`).
- **The router decides where a question is about** (stage 4b). Before a
  question goes out, `teacher/Teacher` asks `api.routePlace` whether it is
  about the view it was typed in, no view, or another of the exploration's
  papers and its tool, but only when there is another paper it could mean,
  and never for one with a passage or a paper attached. Placed elsewhere,
  it is asked there (`askAt`) with that place's context, and the reader is
  not moved: the course and the Reader read their paper off its thread, and
  a Citation Graph not on screen is the one parked from the last visit or
  built quietly (Patrick: build or reuse it, 2026-10-26), its finds waiting
  on that paper. Its bubble says where it was typed (`ChatMsg.placedFrom`)
  and offers to ask it there instead, as a re-routed lecture offers the
  answer. `streamAnswer` is the one stream engine all of this runs on.
  **Several papers at once** (stage 4c): a bridge question, comparing or
  connecting papers, is tagged `across` with each of them
  (`store/chats`'s `acrossTag`), and answered over the papers themselves,
  numbered as peers the researcher can read and expand, with no graph
  built (Patrick, 2026-10-27; `api.streamAcross`, the `papers` view). A
  paper with no hydrated details yet has them fetched and kept on its
  thread, as its cards would. No one view holds it, so it **reads as
  General** (Patrick, 2026-10-30; `shownPlace`), and its `[n]`s are the
  gold paper refs a search's are, from the `paper_refs` the backend sends
  for the peers and any paper an expand numbered past them: each opens its
  paper's thread, on its cards. They were resolved as graph refs once,
  which drew them as the blue spotlight chip, promising a glow on a canvas
  that isn't there. Worked through in "One question, three places" below.
  **A lecture goes there** (Patrick, 2026-10-27): placed on another paper's
  Citation Graph or Reader and read as a lecture or a guided read, the
  question can't be answered off-screen, since it lights its graph or paper
  as it goes. So the panel goes to that view (the one exception to never
  moving it unasked: being taught is asking to be shown), the question
  waits in `pendingAsk`, and the panel that arrives asks it through the
  ordinary path once its graph is built or its paper loaded.
- **Following the chat to a paper keeps it in view** (Patrick,
  2026-10-27). Full screen, a tag, an answer's link, a placed lecture or a
  paper opened from the chat moves to a paper's view, where the dock is
  closed by default; so it opens (`keepChatInView`, a window event the shell
  listens for). The rail's own navigation leaves the dock as it was.
- **Filtered by where it was asked** (`TagFilter.tsx`). Once a chat holds
  questions from two places or more, "Showing: All ▾" at its top picks one,
  and only the exchanges asked there show: each tool's conversation, back
  when it is wanted. Per chat, forgotten on leaving it. A menu, grouped by
  paper, rather than the row of chips it started as, which wrapped into
  rows over the transcript as places added up (Patrick). A bridge question
  (several papers at once) is General here, as on its bubble: it had an
  entry of its own, "Across papers", and a tag of the papers' titles, each
  a link, until it read as General everywhere (Patrick, 2026-10-30). The
  papers it is about are cited `[n]` in its answer, gold like any search's,
  each opening its paper. `store/chats`' `shownPlace` is the one rule.
- **A passage is quoted with where it's from.** `PassageQuote` is `{text,
  from}`, `from` a phrase ("the lesson on Q-learning", "section 3.2,
  Attention") that the quote card shows ("From …") and the messages carry
  ("Explain this passage from …"), so a transcript reads on its own later.

- **Docks right or along the bottom** (Patrick, at stage 3: as PyCharm docks
  a tool window). The header's dock button flips it, remembered, and the
  panel morphs from one edge to the other (a FLIP in `teacher/Teacher`: drawn
  in its old box, animated into the new, its contents fading through the
  middle so the stretch never reads). (Dragging
  its title toward an edge was tried and dropped: the drag selected the
  text it passed over, Patrick.) The
  graph, the course and the paper are wider than they are tall, so a bottom
  dock costs them less. Below 900px it covers the view instead of
  squeezing it, and Esc from inside puts it away.
- **One launcher, in the corner, movable** (`AssistantLauncher`). Each tool
  kept a 🎓 in its top-right corner; now one starts there over every view
  (Patrick: the bottom right is where the views keep their find bars). The
  🎓 was draggable for one round and Patrick preferred it staying put; with
  the astronaut he brought dragging back. Dragged, it stays where it was
  left (`ca.launcherSpot`, its distance from the canvas's top-right corner,
  clamped by the stylesheet so a smaller canvas never loses it), and a ↺ on
  hover puts it back. A press that moves under 4px is still a click.
- **The astronaut floats only when reached for** (Patrick). The launcher is
  the project's astronaut, 96px and free of a box: a still frame
  (`public/astronaut-still.png`) until the pointer is over it, when it
  swaps to the animation (`public/astronaut.webp`); a click or the pointer
  leaving stills it again, and reduced motion keeps it still. On the light
  page it wears a thin ink outline and a firmer shadow, or its pale suit
  fades into the white (Patrick, over a painted disc behind it). Both were cut
  from Patrick's generated video (its painted background removed frame by
  frame, the tether trimmed), the still being the animation's first frame
  so the swap doesn't jump. It moves the moment it is hovered (Patrick): the
  video's still opening and long rests are cut to a beat, its doubled
  frames dropped, and the motion runs 1.5× the video's speed (a 3.3s loop).

## One question, three places (worked example)

An exploration holds *Playing Atari with Deep Reinforcement Learning*
(DQN) and *Soft Actor-Critic* (SAC) as papers. The reader types **"How
does DQN compare with Soft Actor Critic?"** Where it goes is
`teacher/Teacher`'s `placeOrHere`, asking `api.routePlace`:

| Typed in | SAC in the exploration? | Router places it | Tag | Its `[n]`s |
| --- | --- | --- | --- | --- |
| Home, the full-screen General chat | yes | `papers` [DQN, SAC]: a bridge question (`acrossTag`) | **General**, with no "Ask from General instead": typed and shown read as one place | gold, each opening its paper |
| DQN's Reader, course or Citation Graph (or its cards or Criticisms, which ask as its Citation Graph once that's loaded) | yes | the same bridge question, moved off the view | **General**, offering "Ask from Playing Atari… › *tool* instead" | gold |
| DQN's Citation Graph | no | nowhere else to mean (`placeOrHere` skips the router with no other paper) | `Playing Atari… › Citation Graph` | blue, lighting the papers on that canvas |

The rule underneath: a bridge question is answered from the papers
themselves (`api.streamAcross`), with no graph, so nothing it cites is on a
canvas, and it belongs to no one view, so its tag and the "Showing:"
filter call it General. Blue spotlight chips are only for an answer whose
papers are on the graph it was asked beside. Typed on a view, the bubble's
"Ask from … instead" puts the question back there, answered with that
view's context.

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
that the astronaut opens it; and
`test/App.test.tsx` one assistant beside every view, docked right or bottom.

Quick response stamps `ChatMsg.quickResponse` when the replacement turn starts,
before streaming begins. All chat transcripts show a muted “Quick response”
label with a colored bolt beside the clock immediately, retaining it on the
finished/saved turn. Its tooltip says “Answered from the model’s own knowledge.”

The dock's trash button expands right into **Delete this chat?**, replacing
the icon with compact text, the Reader’s theme-aware red outline and hover tint. A second click deletes. Escape, a click elsewhere,
four seconds, or switching chats dismisses it. Reduced motion skips the animation.
