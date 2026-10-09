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
   │                                 the Paper Graph only (hidden elsewhere).
   │                                 Teacher stays at one position in the tree
   │                                 across all three, so the switch never
   │                                 remounts it — see teacher/README.md.
   ├─ card home (paper threads)    tools/ToolCards.tsx — the paper, then a
   │                                 card per tool (Paper Graph, Knowledge Graph)
   ├─ knowledge network            knowledge/KnowledgeNetwork.tsx — a short
   │  │                              course on the paper's prerequisites
   │  ├─ controls (folded)         knowledge/KnowledgeControls.tsx (progress,
   │  │                              next lesson, 2D / 3D, labels, fit)
   │  ├─ the graph                 knowledge/KnowledgeGraph.tsx, or
   │  │                              KnowledgeGraph3D.tsx (lazy-loaded)
   │  ├─ legend                    knowledge/KnowledgeLegend.tsx
   │  └─ lesson panel (on click)   knowledge/KnowledgePanel.tsx
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
      ├─ chat turns                teacher/transcript/ChatMessage.tsx
      │  ├─ lecture beats          teacher/transcript/BeatList.tsx (a turn
      │  │                          whose answer IS a lecture, behind its own
      │  │                          caret — newest open, older ones folded)
      │  └─ inline figures         teacher/figures/FigCard.tsx
      ├─ ask bar                    the question, and the one control that
      │  │                          binds it most directly
      │  ├─ @ suggestions          mentions/MentionSuggestions.tsx — opens
      │  │                          UPWARD out of the bar; anchored to it,
      │  │                          because it belongs to the text being typed
      │  │                          rather than to a control; sibling threads
      │  │                          above, paper results below
      │  └─ filters                search/SearchControls.tsx (▽ — year slider,
      │                             field picker). Moved OUT of the pill in
      │                             v7.11.0 with three others and back in on
      │                             2026-09-14, once the other three were gone
      ├─ tool row                   teacher/ScopePicker.tsx (📚 source scope)
      │                             as a chip under the bar (`.ask-tools`) —
      │                             one home now, not one per panel shape
      ├─ "working" dots            teacher/HopDots.tsx (the send control, and
      │                             a bubble awaiting its first token)
      └─ figure lightbox           figures/Lightbox.tsx (same instance type as above,
                                    but GraphExplorer and Teacher each own their own)
```

`figures/Lightbox.tsx` is the frontend's first true multi-consumer, root-level
component (promoted from `teacher/figures/` once the detail panel became a
second caller) — see "the hybrid rule" above.

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
