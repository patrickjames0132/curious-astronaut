# `src/selection`

The **highlight menu**: select text and a small pill of actions appears over
it, after SpatialRead's (Patrick's reference). It began in the Knowledge
Graph's lessons (v8.25.0) and moved here when the Reader became its second
user (v8.38.0).

```
selection/
  SelectionMenu.tsx   — the pill: a row of text buttons, each tool's own
  useTextSelection.ts — reads the selection in a container and places the pill
  formulas.ts         — what a selection over typeset math says: LaTeX, parts in context
  selection.css       — the pill's look (colours: index.css --selection-menu-*)
```

| Where | Actions |
| --- | --- |
| A finished Knowledge Graph lesson | Explain · Expand · Chat |
| The Reader | Explain · Simplify · Chat |

The Reader has no Expand: in the Knowledge Graph it adds a concept to the
course, and the Reader has no graph to add to. A SpatialRead-style canvas of
ideas spun off the paper would give it one (Patrick, 2026-10-24).

## Decisions worth knowing

- **The pill opens when the reader lets go**, not mid-drag
  (`selectionchange` alone fires while dragging), sits above the passage in
  fixed coordinates (below it near the top of the window), stays inside the
  window's sides, follows a scroll, and closes when the selection collapses
  or leaves the container.
- **Buttons act on mouse-down with the default prevented**, so pressing one
  doesn't first clear the selection it acts on.
- **Formulas read as LaTeX** (`formulas.ts`). KaTeX renders each formula
  twice, a hidden MathML copy (with its LaTeX) and the visible glyphs, so
  `toString()` reads it twice. A formula selected whole reads as its
  `<annotation>` LaTeX; **part of one** reads as the glyphs selected and the
  whole formula for context, `∇ϕ log πϕ (part of $…$)`, so a reader can point
  at one term and the assistant still sees where it sits.
- **A highlighted formula must keep its DOM.** Patrick's equations lost
  their highlight while the menu stayed up (2026-10-24). Reproduced live:
  showing the menu re-rendered the Reader, and React rewrote every KaTeX
  span's injected HTML (168 subtrees), removing the selected nodes. The fix
  is in `notation/MathText` (the span is memoized). A first fix widened any
  selection touching a formula to the whole formula; it wasn't the cause,
  and it stopped part of an equation being highlighted, so it was dropped. Both tools get both, so a lesson's
  passage with math now reaches the assistant as LaTeX too. A container can
  pass its own `readText` on top (the Reader adds its own breaks and leaves
  out footnote marks, `reader/selectionText`).

## Verified by

`test/knowledge/KnowledgeNetwork.test.tsx` (a lesson's Explain, Expand and
Chat), `test/reader/Reader.test.tsx` (the Reader's three, and a formula read
back as LaTeX) and `test/selection/formulas.test.ts` (whole formulas,
parts of one, and a range ending mid-formula).
