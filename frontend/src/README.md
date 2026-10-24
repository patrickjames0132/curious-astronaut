# `src` — the Curious Astronaut frontend

React + TypeScript (strict) + Vite. State follows one rule: **a component's
state lives where the component lives; only genuinely cross-cutting state
goes to the Redux store** (`store/` — five slices: explorations, workspace, transcript,
highlight, library). Structure follows the hybrid rule: feature folders at the root
for anything with multiple consumers or render sites; single-parent
components nest inside their parent's folder (e.g. `teacher/transcript/`).

## The render-tree map (find a component by where you see it)

```
<App>                            App.tsx        — the shell
├─ left rail (collapsible)         shell/SideBar.tsx
│  ├─ brand row (the whole row collapses the rail): "Curious Astronaut"
│  ├─ ✎ New Exploration
│  ├─ threads (General + papers)   shell/ThreadList.tsx
│  ├─ explorations (⋮ → rename / delete)  shell/useSessions.ts
│  │                       autosaved by  shell/useExplorations.ts
│  └─ data source · 📚 Library · ⚙ Settings · theme · ? tour
│                                   — the header died here in v7.8.0; the
│                                   search box had already left in v7.6.0, so
│                                   the chat bar is the app's only text input
├─ Library modal (📚)              library/Sources.tsx
├─ Settings modal (⚙)             settings/SettingsModal.tsx (config-file editor)
├─ guided tour overlay (?)         tour/Tour.tsx (four phases in tour/steps.ts —
│                                   search on first launch, a paper's cards on
│                                   the first one, graph tools on the first
│                                   graph, the course on the first one; each
│                                   auto-runs once)
└─ body                            three states: in General the assistant IS
   │                                 the body (a centred landing chat) and the
   │                                 overlays get their own layer; a paper
   │                                 thread shows its card home or the tool a
   │                                 card opened; the assistant docks beside
   │                                 the Citation Graph, the course assistant
   │                                 (v8.25.0) beside the Knowledge Graph, each
   │                                 hidden elsewhere with its own chat.
   │                                 Teacher stays at one position in the tree
   │                                 across all three, so the switch never
   │                                 remounts it — see teacher/README.md.
   ├─ card home (paper threads)    tools/ToolCards.tsx — the paper, then a
   │                                 card per tool (Citation Graph, Knowledge
   │                                 Graph, Reader)
   ├─ Reader                       reader/Reader.tsx — the paper itself from
   │  │                              its ar5iv render (v8.37.0)
   │  ├─ contents rail             (in Reader.tsx; follows the reading)
   │  ├─ highlight menu            selection/SelectionMenu.tsx (shared:
   │  │                              Explain · Simplify · Chat, v8.38.0)
   │  ├─ the PDF view              reader/PdfView.tsx (pdf.js, lazy-loaded;
   │  │                              v8.40.0), with the Text/PDF switch
   │  └─ the text                  reader/ReaderBody.tsx — blocks and runs:
   │                                 equations (notation/ TeX), figures,
   │                                 tables, citations, refs, footnotes
   ├─ knowledge network            knowledge/KnowledgeNetwork.tsx — a short
   │  │                              course on the paper's prerequisites
   │  ├─ controls (folded)         knowledge/KnowledgeControls.tsx (2D / 3D /
   │  │                              Pyramid, release, fit, clear)
   │  ├─ the graph                 knowledge/KnowledgeGraph.tsx (2D, and the
   │  │                              pyramid, v8.42.0), or KnowledgeGraph3D.tsx
   │  │                              (lazy-loaded)
   │  ├─ legend                    knowledge/KnowledgeLegend.tsx
   │  ├─ find control (🔍 → pill)  graph/controls/FindBar.tsx (shared)
   │  ├─ lesson panel (on click)   knowledge/KnowledgePanel.tsx
   │  │  ├─ lesson images          figures/FigCard.tsx (shared, v8.24.0)
   │  │  └─ highlight menu         selection/SelectionMenu.tsx (shared:
   │  │                              Explain · Expand · Chat here, v8.25.0)
   │  └─ image lightbox            figures/Lightbox.tsx
   ├─ Knowledge Graph Assistant    knowledge/assistant/CourseAssistant.tsx —
   │                                 docked beside the Knowledge Graph; its
   │                                 own chat (store/chats.ts). The panel is
   │                                 assistant/DockedAssistant.tsx (shared)
   ├─ Reader Assistant             reader/ReaderAssistant.tsx — docked
   │                                 beside the Reader (v8.38.0), the same
   │                                 shared panel, its own chat
   ├─ graph area                   graph/GraphExplorer.tsx
   │  ├─ overlays (from the shell): loading / error, and the ↑ back up to
   │  │                              the paper's cards  (App.tsx)
   │  ├─ controls panel (folded)   graph/controls/GraphControls.tsx
   │  ├─ find control (🔍 → pill)  graph/controls/FindBar.tsx
   │  ├─ the canvas                graph/canvas/GraphCanvas.tsx
   │  ├─ legend                    graph/controls/Legend.tsx
   │  ├─ detail panel (on select)  detail/DetailPanel.tsx
   │  └─ figure lightbox           figures/Lightbox.tsx
   └─ assistant (🎓)               teacher/Teacher.tsx — landing or docked,
      │                             and since v7.21.0 the SAME shape either
      │                             way. Two folding sections (Lecture above
      │                             Chat) from v7.10.0 until a `/lecture`
      │                             command replaced the button and left a
      │                             caret whose only job was hiding the panel's
      │                             contents (the command itself went in
      │                             v7.23.0: a lecture is asked for in words)
      ├─ notes over the bar        teacher/ComposerNotes.tsx (one line each,
      │                             an ⓘ with them in full when cut, v8.25.0)
      ├─ chat turns                teacher/transcript/ChatMessage.tsx (each
      │  │                          answer's clock at its top right,
      │  │                          teacher/ResponseTimer.tsx, v8.33.0)
      │  ├─ lecture beats          teacher/transcript/BeatList.tsx (a turn
      │  │                          whose answer IS a lecture, behind its own
      │  │                          caret — newest open, older ones folded)
      │  └─ inline figures         figures/FigCard.tsx
      ├─ ask bar                    the question (🗑 clear and send beside it;
      │  │                          docked, the 📚 library-filters icon, v8.28.0,
      │  │                          and the network-icon Model picker, teacher/ModelPicker.tsx,
      │  │                          v8.33.0)
      │  └─ @ suggestions          mentions/MentionSuggestions.tsx — opens
      │                             UPWARD out of the bar; anchored to it,
      │                             because it belongs to the text being typed
      │                             rather than to a control; sibling threads
      │                             above, paper results below
      ├─ tool row (landing only)    teacher/SourcePicker.tsx over ScopePicker.tsx
      │                             (📚 Library filters, useSourceScope.ts; with
      │                             the Knowledge Graph Assistant, v8.25.0), the
      │                             network-icon Model picker, and
      │                             search/SearchControls.tsx (▽ Paper filters —
      │                             year slider, field picker), labelled chips
      │                             under the bar (`.ask-tools`). Docked there
      │                             is no row: 📚 moves into the bar and the
      │                             filters aren't shown (v8.28.0)
      ├─ "working" dots            teacher/HopDots.tsx (the send control, and
      │                             a bubble awaiting its first token)
      └─ figure lightbox           figures/Lightbox.tsx (same instance type as above,
                                    but GraphExplorer and Teacher each own their own)
```

`assistant/` (the docked assistants' shared panel and stream engine) and
`selection/` (the highlight menu) joined it in v8.38.0, when the Reader
became the second user of what the Knowledge Graph had built.

`figures/` is the frontend's first true multi-consumer, root-level folder:
`Lightbox.tsx` was promoted from `teacher/figures/` once the detail panel became
a second caller, and `FigCard.tsx` + `split.ts` followed it in v8.24.0, when
lesson images made the knowledge panel a third (`teacher/figures/` is gone) —
see "the hybrid rule" above.

Non-visual folders: `api/` (the typed backend client — the only layer that
knows URLs and SSE frames), `store/` (the five slices + typed hooks),
`notation/` (the cross-cutting math renderer — `<MathText>` for the DOM
surfaces, `latexToUnicode` for canvas node labels), `graph/hooks/` +
`graph/model.ts`/`theme.ts` (the sim machinery), `ui/` (cross-cutting UI
utilities — `useResizablePanel` for both right-docked panels),
`mentions/` (the chat bar's `@` lookup for papers and sibling threads — its
grammar, typeahead and dropdown), `scope/` (which papers a turn is about — the message → selection →
visible priority list both agents share), `search/useDirectSearch.ts`,
`shell/useSessions.ts`, `detail/useSelection.ts`,
`teacher/useConversation.ts` (each feature's state/logic hooks).

(`commands/` sat here from v7.21.0 to v7.23.0 — the `/lecture` command's
grammar and menu. It went when the router learned to read a lecture's scope
off the words, which a two-value command could never express; its shape —
`mentions/` minus the network half — is in `docs/history.md` if a command
system is ever wanted again.)

Every folder has its own README with the full story — this file is just the
map. Verified by `npm run build` (strict tsc + Vite) and oxlint; behavior
by the end-of-phase browser milestone.

One oxlint rule is worth calling out because it encodes a house convention
rather than a correctness check: **`id-length`** (`min: 2`) is the frontend
half of CLAUDE.md's no-single-letter-identifiers rule — the backend half is
`check_identifiers.py`. It runs over `src/` and `test/` alike. Two
deliberate settings:

- **`properties: "never"`** — object-literal keys and member access are
  exempt, because those names are usually not ours: react-force-graph's
  `node.x`/`.y`, a `VLink`'s `_s`/`_t`, react-markdown's `a:` component
  override, `latexToUnicode`'s subscript map keyed by the LaTeX character
  itself. The cost is that a destructured `const { a } = obj` slips
  through — an accepted trade for not drowning in false positives.
- **`exceptions: ["_"]`** — the pure-discard idiom, `.map((_, index) => …)`.

TypeScript property *signatures* are still checked (they're declarations, not
accesses), so the handful of genuinely external field names declared in our
own types carry a scoped `oxlint-disable` with a comment saying whose name it
is — see `graph/model.ts` (`x`/`y`) and `api/search.ts` (the `q` wire key).

Thread navigation remounts the canvas and chat with distinct sibling keys
(`graph:<epoch>` and `teacher:<epoch>`). The shell regression test cycles
between General and two graphs and checks that only one explorer and one
chat panel remain mounted. General renders no explorer.
