# `src/figures`

Figures, wherever the app shows them: the inline figure card, the
`<<FIG n>>` interleaver that places cards in streamed prose, and the
full-screen lightbox — click anywhere (or the ✕, or Escape) to close.

```
figures/
  FigCard.tsx  — one figure card: image, label, credit, caption (and a lesson
                 image's description and linked credit); click to enlarge
  split.ts     — the interleaver: pairs <<FIG n>> markers with attached figures
  Lightbox.tsx — the full-screen view
  figures.css  — the card's and the lightbox's styles (the lightbox's fade
                 lives in index.css with the other motion rules)
```

## Why it's here, not nested in a feature folder

The frontend's first true multi-consumer folder, so it lives at the root per
the hybrid structure rule (`src/README.md`): a component with more than one
render site gets its own folder; a single-parent one nests inside whichever
feature owns it.

All three started in `teacher/figures/`, built for the agent's cited answer
figures. `Lightbox` was promoted first, once the detail panel's own paper
figures (`detail/DetailPanel.tsx`) became a second, unrelated caller. `FigCard`
and `split.ts` followed in **v8.24.0**, when the knowledge panel's lesson images
made a third (`teacher/figures/` went with them), and their styles moved out of
`teacher/teacher.css` into `figures.css` so the card looks the same wherever it
is mounted.

## `split.ts` — the interleaver's edge cases

`splitAnswer(text, figures)` returns the prose split into interleaved
text/figure parts, plus the `leftover` figures whose marker never appeared
(those render at the end — the pre-inline fallback, which also covers old
saved sessions whose figures carry no slot). The details that earn their
keep:

- **`FIG_TAIL` holds back a partial marker** at the end of streaming prose
  (`<<FI`, `<<FIG 1`) so a marker split across token chunks never flashes
  raw before completing.
- **An invented slot's marker vanishes cleanly** — text accumulates in a
  buffer so a marker with no matching figure disappears without gluing its
  surrounding paragraphs together.
- **A slot renders at most once** — duplicate markers for the same figure
  are dropped after the first.

The knowledge panel uses it unchanged: the tutor writes a lesson's markers
itself, as the researcher does an answer's, each on its own line after the
paragraph its image illustrates (`tutor/images.py`'s `show_image`), so the
panel splits a finished lesson exactly as the chat splits a streamed answer.

## `FigCard` — deliberately dumb

Image (already proxied same-origin by the backend — the frontend never
hotlinks ar5iv, or a web image), its label (the float's own designation, else
`Figure N` by slot), the credit, and the caption (credit and caption through
`MathText` — captions carry LaTeX), and an `onEnlarge` callback the parent
wires to a `Lightbox`. Two optional fields serve **lesson images** (v8.24.0)
and nothing else sets them: `description`, the tutor's words on what to see,
shown first on its own line (and as the image's alt text), and `link`, which
turns the credit into a link to where the image came from — the web page, the
paper, or the reader's own book at the figure's page.

## `Lightbox` — design decisions worth knowing

- **One prop shape serves very different callers.** `AnswerFigure`
  (`api/agents.ts`) has only `image`/`caption`/`title` required — `figure`,
  `index`, and `slot` are optional because the detail panel's paper figures
  have none of them (they're just a list in DOM order, not individually
  numbered/cited the way an agent's `show_figure` attachment is). The
  caption line renders `Figure N` only when `figure` is a number (or the
  `label` when there is one), and joins whatever combination of
  label/`title`/`caption`/`description` is actually present rather than
  assuming all of them.
- **The detail panel passes `title: null`.** Showing the paper's own title
  in its own lightbox would be redundant — you're already looking at its
  detail panel. The teacher's answer figures need it (they can be for *any*
  cited paper, not just the one you're looking at).
- **Each caller owns its own lightbox state.** `Teacher.tsx`,
  `graph/GraphExplorer.tsx` and `knowledge/KnowledgeNetwork.tsx` each hold
  their own `useState<AnswerFigure | null>` and render their own
  `<Lightbox>` instance. Simpler than threading one shared instance through
  unrelated component trees for a view that's never open from two places at
  once. The knowledge network holds it outside its sliding lesson panel, so
  the panel's animation never becomes the fixed overlay's containing block.
- **It is always rendered, and takes `null` when closed (v8.10.0).** That
  lets it fade out: `ui/usePresence` holds it mounted through the exit, and
  it keeps the last figure it showed, because the caller has already set its
  state to null by then. The Escape listener is attached only while a figure
  is open.

## Who uses it, and how/why

- **`teacher/transcript/ChatMessage.tsx`** — interleaves an answer's prose
  with the figures the researcher attached (`show_figure` /
  `show_source_figure`); `teacher/transcript/BeatList.tsx` shows a lecture
  beat's single figure in the same card. `teacher/Teacher.tsx` owns their
  lightbox.
- **`knowledge/KnowledgePanel.tsx`** (v8.24.0) — interleaves a lesson with
  its images, each described and credited; `knowledge/KnowledgeNetwork.tsx`
  owns their lightbox.
- **`graph/GraphExplorer.tsx`** — enlarges one of the selected paper's own
  figures (ar5iv), rendered in `detail/DetailPanel.tsx`.

## How it's verified

`test/figures/split.test.ts` covers the interleaver's edge cases;
`test/knowledge/KnowledgeNetwork.test.tsx` checks a lesson image lands right
after its paragraph with its description and linked credit. Click-to-enlarge
and Escape-to-close are browser-milestone items.
