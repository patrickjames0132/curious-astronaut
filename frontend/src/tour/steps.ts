/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The tour step lists: data only — the walking/spotlighting lives in
 * `Tour.tsx`; the `data-tour` attributes these selectors point at are planted
 * where each control renders (`search/Search.tsx`,
 * `graph/controls/GraphControls.tsx`, `detail/DetailPanel.tsx`,
 * `teacher/Teacher.tsx`).
 *
 * Six phases, because the app has six first-times: {@link HOME_TOUR}
 * covers the search surface and auto-runs on first launch, before any paper
 * is open; {@link CARDS_TOUR} covers a paper thread's card home (and meets Nova) and auto-runs
 * on the first one; {@link GRAPH_TOUR} covers the graph tools and auto-runs
 * on the first graph; {@link KNOWLEDGE_TOUR} covers the knowledge network and
 * auto-runs on the first course; {@link READER_TOUR} covers the Reader and
 * auto-runs on the first paper read; {@link CRITICISMS_TOUR} covers the
 * Criticisms card and auto-runs on the first one opened. `App.tsx` picks the
 * list (and the seen-flag) by which of the six is on screen.
 * One more list, {@link SETTINGS_TOUR}, belongs to the settings modal, which
 * mounts it itself (the ? beside its ✕): its steps *stage* the section or
 * sub-page they point at, so the walk drives the modal's own nav.
 * Within a list, steps whose control isn't on screen skip themselves (the
 * year/citation sliders only render when the graph spans a range, the detail
 * panel needs a selected paper, the ask bar needs the assistant open),
 * so each list describes its phase's *maximal* tour.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { TourStep } from './Tour'

/** localStorage keys remembering each tour phase has auto-run once. */
export const TOUR_KEYS = {
  /** The pre-graph search tour — first launch. */
  home: 'curious_astronaut.tour.home',
  /** A paper thread's card home — the first paper opened. */
  cards: 'curious_astronaut.tour.cards',
  /** The knowledge network — the first course opened. */
  knowledge: 'curious_astronaut.tour.knowledge',
  /** The Reader — the first paper read. */
  reader: 'curious_astronaut.tour.reader',
  /** The Criticisms card — the first one opened. Its key keeps the card's
   *  first name, as its tool id does. */
  reviews: 'curious_astronaut.tour.reviews',
  /** The graph-tools tour — first graph. */
  graph: 'curious_astronaut.tour.graph',
  /** The settings modal's tour — first time it is opened. */
  settings: 'curious_astronaut.tour.settings',
} as const

/** The startup tour: the chat bar, before any graph is loaded. */
export const HOME_TOUR: TourStep[] = [
  {
    target: '[data-tour="ask"]',
    title: 'Start here',
    body:
      'One box for everything. Ask a research question and Nova goes looking — ' +
      'through the literature, and through your own uploaded sources if you have any. ' +
      'Or paste an arXiv id or URL to open that paper straight away. No graph or ' +
      'library needed to begin; just saying hello stays a conversation.',
  },
  {
    // Anchored to the bar itself: `@` is typed INTO it, so there is no control
    // to point at — which is the improvement over the toggle this replaced.
    target: '[data-tour="ask"]',
    title: 'Type @ to name a paper or a thread',
    body:
      'Start any word with @ and suggestions appear as you type: this exploration’s ' +
      'other chats first, then papers. In a chat the top row is “Search for …”: press ' +
      'Enter and Curious Astronaut searches properly for what you typed and lists what it ' +
      'found. Arrow down onto a paper or chat and Enter attaches it as a chip over the bar, ' +
      'for the question you type next; Backspace in an empty bar lets the last chip go. To ' +
      'open a paper in its own thread instead, click its Open button, or press Shift+Enter on it. Searching lives here, in your chats: beside a ' +
      'graph, @ names papers already on that graph, and other chats.',
  },
  {
    target: '[data-tour="search-filters"]',
    title: 'Paper filters',
    body:
      'Restrict a paper search to a publication-year window, a field of study, or ' +
      'both. These are hard limits, not hints — and they apply to Nova’s own ' +
      'searches too, not just the direct lookup. They narrow papers, never your library ' +
      '(that’s the 📚 Library chip beside them), and they live here, on ' +
      'your chats: over a graph Nova works from the graph instead of searching. ' +
      'Citation links on the graph are never filtered: those are edges somebody ' +
      'actually wrote.',
  },
  {
    target: '[data-tour="provider"]',
    title: 'Pick the data source',
    body:
      'The academic database the whole map is built from — Semantic Scholar or OpenAlex, ' +
      'chosen per graph. Each has different strengths (see the note under the graph ' +
      'controls once a map is up). Switching moves the paper you are in to the other source, ' +
      'its chats and course included, rather than opening it again beside itself; its graph ' +
      'rebuilds now if it is on screen, otherwise when you next open it.',
  },
  {
    target: '[data-tour="library-btn"]',
    title: 'Your library',
    body:
      'Bring your own material: textbooks, PDFs, web pages. Nova can search it, ' +
      'cite passages by page, and pull figures out of your uploaded PDFs into its ' +
      'answers, right alongside the papers on the graph.',
  },
  {
    target: '[data-tour="library-panel"]',
    stage: 'library',
    title: 'Inside the library',
    body:
      'Drop in many PDFs at once (or paste a URL) — each ingests with its own progress ' +
      'row. Everything is chunked and embedded locally: your books never leave this ' +
      'machine. Remove a source any time; Nova only ever cites what’s here.',
  },
  {
    target: '[data-tour="assistant-panel"]',
    title: 'Every answer is a way in',
    body:
      'Click a paper citation to highlight it on the current graph. A graph icon opens ' +
      'that paper in its own thread — onto its graph if you are already on one, onto its ' +
      'cards otherwise. A paper keeps no conversation of its own: beside its graph, its ' +
      'course or its Reader, Nova talks in the chat you were last in, and each ' +
      'question there is tagged with where you asked it — click a tag to go back. An answer ' +
      'asked from another paper’s view takes you there when you click it, its citations or ' +
      'its quotes, and lights them there. Ask about another paper by name and the question goes ' +
      'there, answered from that paper while you stay put (ask for a lecture on it and you go ' +
      'there to be taught); ask about several at once — compare them, connect them — and it is ' +
      'answered across those papers, each title in its tag a link to that paper. ' +
      '“Ask from … instead” under its tag ' +
      'asks it where you typed it. Once a chat spans several places, the Showing menu ' +
      'at its top shows only the questions asked from one. Type @ and pick another chat to ' +
      'bring it into the one you are in.',
  },
  {
    target: '[data-tour="rail"]',
    title: 'Your explorations live here',
    body:
      'Every exploration saves itself — there is no Save button. Ask a question or open ' +
      'a paper and a row appears here, named after what you were asking about and kept ' +
      'up to date as you work. Its threads nest underneath in two groups: Chats, your ' +
      'conversations, each named after its first question; and Papers, one per paper you ' +
      'open, to read and explore. Chats’ ＋ starts another chat, so one can keep its ' +
      'search results while you talk about something else; Papers’ ＋ opens a chat with @ ' +
      'typed, ready to find a paper. Use the carets to fold them, and each ⋮ menu to ' +
      'rename or delete a thread (the last chat stays), or re-summarize a chat whose ' +
      'talk has moved on from its name. Click a thread to resume it where you left it. ✎ starts a new ' +
      'exploration; the one you leave is already saved. Hover a row for ⋮ to rename or ' +
      'delete it, and collapse the whole rail when the map wants the room — click the ' +
      'helmet at the top, or drag its right edge; the drag folds it away and pulls it back open. ' +
      'When the rail is collapsed, the Explorations bubble opens the same expandable list in a small modal.',
  },
  {
    target: '[data-tour="settings-btn"]',
    title: 'Settings',
    body:
      "The app's configuration — data providers, API keys, the citations corpus — " +
      'editable in place. Changes are validated and applied live, no restart.',
  },
]

/**
 * A paper thread's card home: the paper, its tools, and the way back to the
 * cards once a tool is open. Short on purpose — the graph's own tour takes
 * over the moment its card is opened.
 */
export const CARDS_TOUR: TourStep[] = [
  {
    target: '[data-tour="tool-home"]',
    title: 'One paper, several ways in',
    body:
      'Every paper you open gets a thread of its own, and lands here first: the paper ' +
      'at the top, and a card for each tool that works on it. Nothing is built until ' +
      'you open a card, so looking costs nothing.',
  },
  {
    target: '[data-tour="tool-cards"]',
    title: 'Pick a tool',
    body:
      'The Citation Graph maps the papers this one built on and the ones it spawned. The ' +
      'Knowledge Graph is a short course on the ideas you need to ' +
      'know first. The Reader is the paper itself. Criticisms gathers what later papers ' +
      'objected to in it. Clicking the thread in the sidebar ' +
      'always brings you back to these cards, and so does the ↑ at the top of each tool.',
  },
  {
    // Nova from the first paper on (v9.0.0, Patrick): the launcher is
    // already here on the cards, so it is met before any tool is opened.
    target: '[data-tour="assistant-btn"]',
    presentIf: '[data-tour="assistant-btn"]',
    title: 'Meet Nova',
    body:
      'The floating astronaut is Nova: your AI assistant! Click to open Nova beside these ' +
      'cards or any tool — the graph, the course, the Reader — and ask about this paper, ' +
      'or ask Nova to compare it with the others you have open. Nova talks in the chat you ' +
      'were last in, so the conversation follows you from paper to paper. Drag the astronaut ' +
      'anywhere you like; the ↺ on hover puts it back.',
  },
]

/**
 * The Criticisms card: where its critiques come from, the numbered criticisms
 * and their quotes, the contents, and the way back to the cards.
 */
export const CRITICISMS_TOUR: TourStep[] = [
  {
    target: '[data-tour="criticisms"]',
    title: 'What the field objected to',
    body:
      'Not conference reviews: the weaknesses later papers found in this one, gathered from ' +
      'the sentences in which they cite it. Each criticism is a numbered heading, with how ' +
      'many papers raise it and a short summary.',
  },
  {
    target: '[data-tour="criticisms-source"]',
    title: 'Where they come from',
    body:
      'This line says what was read. Usually that’s the most-cited papers that cite this ' +
      'one, which is where the field’s real answers are; for a paper outside the offline ' +
      'corpus, it’s the most recent citers instead, and the line says so.',
  },
  {
    target: '[data-tour="criticisms-list"]',
    title: 'Every quote is real',
    body:
      'Each quote is the citing paper’s own sentence, word for word. Open a citing paper as ' +
      'its own thread, or show it in this paper’s Citation Graph. Often the paper that names ' +
      'a weakness is also the one that fixed it.',
  },
  {
    target: '[data-tour="criticisms-contents"]',
    title: 'Contents',
    body:
      'Every criticism by its number, following along as you read. Click one to go straight ' +
      'there. Drag the panel’s right edge to resize it. The bump on that edge folds it away ' +
      'to a thin line at the left (so does dragging it narrow enough); the line’s bump brings ' +
      'it back.',
  },
  {
    target: '[data-tour="tool-back"]',
    presentIf: '[data-tour="tool-back"]',
    title: 'Back up to the paper’s cards',
    body:
      'At the top of the criticisms, the ↑ over them takes you back up to this paper’s cards ' +
      'and its other tools. Scrolled down, it becomes “Back to top”.',
  },
]

/**
 * The knowledge network: the graph (click, double-click), the legend, the
 * course controls, the find bar, and the lesson panel.
 */
export const KNOWLEDGE_TOUR: TourStep[] = [
  {
    target: '[data-tour="knowledge"]',
    title: 'Everything this paper rests on',
    body:
      'The paper sits in gold; every violet node is a concept it needs, and arrows point ' +
      'from an item to what it needs. Double-click any node to break it down into what ' +
      'it needs in turn, as deep as you like. A concept two items both need ' +
      'is one node with two arrows into it.',
  },
  {
    target: '[data-tour="knowledge-legend"]',
    title: 'Reading the graph',
    body:
      'The legend names it all: the paper, concepts, the “depends on” arrow, and a ' +
      'concept’s states — grey and new until you open or break it down, then violet, and ' +
      'green once you know it. Zoomed out, only the paper and the item you have open ' +
      'are named; zoom in to name them all, or point at any node for its name.',
  },
  {
    target: '[data-tour="knowledge-controls"]',
    title: 'The course controls',
    body:
      'Open these controls to fly through the course in 3D, or to stack it as a Pyramid: ' +
      'foundations at the bottom, the paper on top, and whatever your check-offs let you ' +
      'skip faded. They also hold ' +
      'Release (unpin the nodes you dragged), Fit (the whole course in view) and Clear ' +
      '(drop a selection). In 3D, navigation hints appear below the graph; on narrow ' +
      'panels, hover or focus the ⓘ beside search, or click it to keep the hints open.',
  },
  {
    target: '[data-tour="knowledge-find"]',
    title: 'Find a concept',
    body:
      'Type part of a name to spotlight the concepts that match; the rest dim. Enter (or ' +
      '“select”) picks every match, ready to check off with “✓ I know these”. Esc or ✕ ' +
      'clears the find.',
  },
  {
    target: '[data-tour="knowledge"]',
    title: 'Click a node for its lesson',
    body:
      'A panel opens with what it is, why the course needs it, and its lesson — written ' +
      'for this course the first time you open it and kept after that. It opens on a picture ' +
      'of the idea itself when the tutor finds one, and comes with a few more ' +
      'images from your library, the paper or the web where they help, each credited and ' +
      'described (click one to enlarge it); a line says what the tutor is doing until it’s ready ' +
      '(click it for every step so far), ' +
      'and “Quick response” skips the images to have the lesson now. The ⋮ beside the ✕ ' +
      'writes a finished lesson again, and holds Hide, Delete and “Break it down again”. Its links stay lit ' +
      'while it’s open: point at a lit one to see its links in turn. Click it again, or press ' +
      'Esc, to close it. Press its 🤔 to light the 💡: known, the course skips it, with ' +
      'everything beneath it. Already know several? ' +
      'Shift-click them, or hold Alt and drag a box around them, then “✓ I know these”. ' +
      'Pick two or more concepts (or syntheses) and “◆ Synthesize” adds a synthesis to ' +
      'the course: how they combine, taught just before what they build toward. Don’t ' +
      'want some? Hide them from the panel’s ⋮ or the ' +
      'selection (or press Delete), and what only they needed goes too; the item above ' +
      'shows a red count of what’s hidden, and double-clicking it (or “Unhide” in its ⋮) ' +
      'brings them back. “Delete permanently” takes one off for good, and “Break it down ' +
      'again” asks for a fresh breakdown; both ask first.',
  },
  {
    target: '[data-tour="lesson-pane"]',
    presentIf: '[data-tour="lesson-pane"]',
    title: 'Highlight a passage',
    body:
      'Select a word or a passage in a finished lesson and a small menu appears over it. ' +
      '“Explain” asks Nova about it, without adding anything to the graph. ' +
      '“Expand” adds the idea it names as a new concept this lesson’s item needs (or links ' +
      'it, if the course already has it), ready to open and learn in turn. “Chat” opens the ' +
      'Nova with the passage attached to its bar, so you can ask anything about it.',
  },
  {
    target: '[data-tour="assistant-btn"]',
    presentIf: '[data-tour="assistant-btn"]',
    title: 'Nova, beside the course',
    body:
      'The floating astronaut is Nova: your AI assistant! Click to open Nova beside the course. Nova reads the whole course: every concept, ' +
      'what each needs, what you have checked off, and the lessons written so far. Ask what a ' +
      'concept means, how two connect, or what to study next. It talks in the chat you were ' +
      'last in, as it does beside every view; type @ to bring another chat into a question. ' +
      'The 📚 in its bar picks which of your sources it may search.',
  },
  {
    target: '[data-tour="tool-return"][data-return="reader"]',
    presentIf: '[data-tour="tool-return"][data-return="reader"]',
    title: 'Back to reading',
    body:
      'You came here from the Reader to read a lesson. This takes you back to the same ' +
      'place in the paper; the Reader’s own ↑ leads up to the paper’s cards.',
  },
]

/**
 * The Reader: the contents, the live parts of the text (citations, refs,
 * footnotes), the highlight menu, the Knowledge Graph notes (v8.44.0, only
 * when there are some) and the Reader Assistant (v8.38.0). Short,
 * like the cards' tour: reading needs no lesson.
 */
export const READER_TOUR: TourStep[] = [
  {
    target: '[data-tour="reader-page"]',
    title: 'The paper itself',
    body:
      'This is the paper’s own text, from arXiv’s HTML render, with its equations typeset ' +
      'and its figures and tables in place. Hover a citation like [13] to see the paper it ' +
      'cites, and click it to keep that card open: from there you can open the paper, read ' +
      'it, find it in the Citation Graph or go to its entry in the references. A figure or ' +
      'equation number jumps to that figure or equation, and a small raised number opens ' +
      'its footnote in place.',
  },
  {
    target: '[data-tour="reader-contents"]',
    title: 'Contents',
    body:
      'The sections, following along as you read. Click one to go straight there. Drag ' +
      'the panel’s right edge to resize it. The bump on that edge folds it away to a thin ' +
      'line at the left (so does dragging it narrow enough); the line’s bump brings it back.',
  },
  {
    target: '[data-tour="reader-page"]',
    title: 'Highlight a passage',
    body:
      'Select a word, a sentence or an equation and a small menu appears over it. ' +
      '“Explain” asks Nova what it means, “Simplify” asks for it in plain ' +
      'words, and “Chat” opens Nova with the passage attached to its bar, so you ' +
      'can ask anything about it. For what won’t select as text, a figure, a whole equation ' +
      'or a table, hold ⌥ (Alt) and drag a box over it: the same menu asks about it, and the ' +
      'Nova sees it, a picture of it in the PDF, its LaTeX and images in the text.',
  },
  {
    target: '[data-tour="reader-notes"]',
    presentIf: '[data-tour="reader-notes"]',
    title: 'Notes from your Knowledge Graph',
    body:
      'Once you’ve started this paper’s Knowledge Graph course, each section shows the ' +
      'concepts from it that the section builds on, a ✓ on the ones you know. Click one for ' +
      'why the paper needs it, the start of its lesson, and a check-off; “Read lesson in ' +
      'Knowledge Graph” takes you to the whole lesson there, and “Back to reading” there ' +
      'brings you back to your place in the paper.',
  },
  {
    target: '[data-tour="reader-criticisms"]',
    presentIf: '[data-tour="reader-criticisms"]',
    title: 'Notes from Criticisms',
    body:
      'Once this paper’s Criticisms card has been gathered, a criticism the field raised ' +
      'about something the paper says or does is noted beside that passage, by its number. ' +
      'Hover the note to light the passage; click a criticism for its summary and a quote ' +
      'from the paper that raised it. “Read in Criticisms” opens the card at it, and “Back ' +
      'to reading” there brings you back here.',
  },
  {
    target: '[data-tour="reader-view-switch"]',
    presentIf: '[data-tour="reader-view-switch"]',
    title: 'Text or PDF',
    body:
      'Switch between the paper’s text (typeset equations, live citations) and its PDF, ' +
      'the original layout. The choice is remembered for this paper. A paper with no ' +
      'text opens as its PDF, and the highlight menu and Nova work on either. In ' +
      'the PDF, − and + beside it zoom, and the percentage goes back to fitting the width. ' +
      'The ⓘ at its end sums up the controls.',
  },
  {
    target: '[data-tour="assistant-btn"]',
    presentIf: '[data-tour="assistant-btn"]',
    title: 'Nova, beside the paper',
    body:
      'The floating astronaut is Nova: your AI assistant! Click to open Nova beside the paper. Nova reads the paper, starting with the ' +
      'section you’re in, and searches your library and the web only when a question reaches ' +
      'past it. Nova talks in the chat you were last in, as it does beside every view; type @ ' +
      'to bring another chat into a question. The 📚 in its bar picks which of your sources ' +
      'it may search. ' +
      'The paper’s words it quotes light up in the paper; click an answer, or one of its ' +
      'quotes, to go there, and Esc to put the light out. Ask it for a lecture and it gives ' +
      'one on the whole paper, as Give Lecture On Paper does.',
  },
  {
    target: '[data-tour="reader-lecture"]',
    presentIf: '[data-tour="reader-lecture"]',
    title: 'Give Lecture On Paper',
    body:
      'A lecture on the whole paper, from Nova: the paper taught step by step ' +
      'in its own order, each step lit in the paper as you go. Back and Next on the step ' +
      'you’re on, or click any step. In the PDF it sits in the margin by the title.',
  },
  {
    target: '[data-tour="tool-back"]',
    presentIf: '[data-tour="tool-back"]',
    title: 'Back up to the paper’s cards',
    body:
      'At the top of the paper, the ↑ over it takes you back up to this paper’s cards and ' +
      'its other tools. Scrolled down, it becomes “Back to top”, which takes you back to ' +
      'the paper’s start.',
  },
]

/**
 * The graph-tools tour, following the eye's path across the screen
 * (re-sequenced with Patrick, v5.22.0): the top-left controls panel walked
 * top-to-bottom through its last row ("Open a paper"), then the
 * bottom-right find control, then the detail panel (a whole-panel overview
 * stop, then its sections), then the teacher — the astronaut that opens it (only
 * while it is tucked away; the Knowledge Graph's course assistant has its own
 * 🎓, introduced by the knowledge tour), the source scope under the ask
 * bar, then the bar itself, which carries two stops: what the researcher does
 * with a question, and how asking for a lecture reaches the other assistant.
 * The walk follows the eye down the panel and ends where the reader types.
 *
 * It used to open on a lecture grid at the top of the panel. That grid became
 * one button in v7.17.0, was folded behind a caret in v7.10.0, became a
 * `/lecture` command in v7.21.0 — which also deleted the panel's folding
 * sections entirely, so every teacher stop now hangs off the composer — and
 * became plain words in v7.23.0, when the command went.
 * (Find used to open the tour — a leftover from its top-right era; starting on
 * a tiny corner button read as a diagonal jump.)
 * The steps inside the controls panel stage `'controls'` so a
 * collapsed panel expands under the walk; the year/citation stops carry their
 * own target as `presentIf` — an existence check, which the collapsed panel's
 * `hidden` (still-in-DOM) body passes whenever the graph's data earns those
 * sliders at all. `'assistant'` does a narrower job for the teacher: it opens
 * the panel, and that is all it has to do now that nothing in there folds.
 */
export const GRAPH_TOUR: TourStep[] = [
  {
    target: '[data-tour="controls-head"]',
    title: 'The controls panel',
    body:
      'Everything that declutters the map lives behind this sliders button. It starts ' +
      'folded away so the canvas is yours — click it to open the panel, and click the ' +
      'panel’s header to fold it back. The next stops walk through what’s inside.',
  },
  {
    target: '[data-tour="layout"]',
    stage: 'controls',
    title: 'Two layouts',
    body:
      'Force lets connections cluster the papers; Timeline pins every paper to its ' +
      'publication date, oldest on the left. Switching layouts releases any pinned nodes.',
  },
  {
    target: '[data-tour="relations"]',
    stage: 'controls',
    title: 'Relation filters',
    body:
      'Each chip shows or hides one kind of node, and the chip colors match them. ' +
      'Gold is the seed paper itself — hide it and a lecture covers only the papers around ' +
      'it. Blue references are the papers this one built on; green citations are the ' +
      'papers that built on it — every one of them, from its most-cited classics to work ' +
      'published this year. Which of those you care about is yours to say: the year and ' +
      'citation-count sliders below draw that line however you like. The Surveys ' +
      'chip rings the surveys and reviews in orange: the field’s own overviews of a ' +
      'period.',
  },
  {
    target: '[data-tour="relations"]',
    stage: 'controls',
    // Only while the build is user-sized — Settings ▸ Graph with automatic
    // sizing switched off, which is what grows a slider under each chip. An
    // adaptive graph has none, so the step stays out of the way.
    presentIf: '.rel-cap-slider',
    title: 'How many of each',
    body:
      "Because you've turned off automatic sizing, the graph ships everything it can " +
      'and each chip now heads a count slider. Drag one to keep only that many of that ' +
      'relation, most-cited first — a display trim, so widening it back costs no ' +
      'rebuild. Turn automatic sizing back on in Settings ▸ Graph and the app ' +
      'picks these numbers per paper instead.',
  },
  {
    target: '[data-tour="years"]',
    stage: 'controls',
    presentIf: '[data-tour="years"]',
    title: 'Year window',
    body:
      'Drag the two knobs to keep only papers published inside a span — in Timeline the ' +
      'view zooms into those years.',
  },
  {
    target: '[data-tour="citations"]',
    stage: 'controls',
    presentIf: '[data-tour="citations"]',
    title: 'Citation window',
    body:
      'Bound how cited the visible papers are (a log scale, so the knobs stay useful next ' +
      'to a mega-paper). Trim the long tail, or hide the giants to see what’s underneath.',
  },
  {
    target: '[data-tour="links"]',
    stage: 'controls',
    title: 'Interconnected links',
    body:
      'The map draws each paper’s link to the seed. “Show interconnected links” links up the papers ' +
      'on screen too, the way Connected Papers does: the seed stays at the centre and ' +
      'papers that cite each other pull together around it. A citer’s links draw green, ' +
      'a reference’s blue, and they follow the graph as it grows. Force layout only: ' +
      'Timeline keeps its papers in date order.',
  },
  {
    target: '[data-tour="actions"]',
    stage: 'controls',
    title: 'Release · Fit · Refresh · Clear',
    body:
      'Release unpins every node you dragged and re-settles a drifted layout — without ' +
      'moving your zoom. Fit re-centers the whole graph. Refresh rebuilds this ' +
      'paper’s neighborhood fresh from the data provider. Clear drops every highlight ' +
      'at once — your hand-picked papers and Nova’s glow alike (Esc does the ' +
      'same).',
  },
  {
    target: '[data-tour="selector"]',
    stage: 'controls',
    title: 'Hand-pick what it answers over',
    body:
      'Hold ⌥ Alt and drag a box around papers to add them to Nova’s scope — ' +
      'sweep several clusters to build one. ⇧ Shift-click toggles a single paper. ' +
      'Drag any ringed paper and the whole selection moves with it, pinned where you ' +
      'drop it. ' +
      'Lectures and answers then ground in exactly those papers — even ones a filter ' +
      'later hides, which stay drawn with a dotted ring — unless a message names its own. ' +
      'The rings show what a turn is about while it runs and clear when the answer lands; ' +
      'the papers it cited stay lit. Esc clears every highlight at once.',
  },
  {
    target: '[data-tour="hint"]',
    stage: 'controls',
    title: 'Open a paper',
    body:
      'Click any paper to centre it and open its detail panel — abstract, figures, code ' +
      'links, tags — and hold its links in focus: everything it’s linked to stays lit, the rest dims, ' +
      'while the panel is open. Point at one of the lit papers to see its links in turn. ' +
      'Click the paper again, close the panel, or press Esc to let go (a first Esc clears ' +
      'any selection or highlight, the next lets go). Double-click a paper, or use ' +
      '“Explore in a thread” in its panel, to re-seed the whole map on it.',
  },
  {
    target: '[data-tour="find"]',
    title: 'Find a paper on screen',
    body:
      'Click the 🔍 and type part of a title or author. The matching papers light up ' +
      'and everything else dims — all on your screen, nothing is fetched. Pressing ' +
      'Enter (or “select” in the find bar) adds every match to Nova’s ' +
      'scope. Esc or ✕ clears the find and tucks it away. This only searches what is ' +
      'already drawn — to pull NEW papers in, expand a paper from its detail panel, or ' +
      'ask in the chat bar in Nova’s panel.',
  },
  {
    target: '[data-tour="tool-return"][data-return="reader"]',
    presentIf: '[data-tour="tool-return"][data-return="reader"]',
    title: 'Back to reading',
    body:
      'You came here from the Reader, to read a lesson or to see a cited paper on the ' +
      'graph. This takes you back to the same place in the paper; the Reader’s own ↑ ' +
      'leads up to the paper’s cards.',
  },
  {
    target: '[data-tour="tool-return"][data-return="reviews"]',
    presentIf: '[data-tour="tool-return"][data-return="reviews"]',
    title: 'Back to Criticisms',
    body:
      'You came here from Criticisms to see a citing paper. This takes you back to the ' +
      'same place in the criticisms; their own ↑ leads up to the paper’s cards.',
  },
  {
    target: '[data-tour="tool-back"]',
    presentIf: '[data-tour="tool-back"]',
    title: 'Back up to the paper’s cards',
    body:
      'The ↑ at the top takes you back up to this paper’s cards and its other tools; the ' +
      'graph stays as you left it. “Explore in a thread” in a paper’s panel opens that ' +
      'paper — it gets its own thread and lands straight on its graph.',
  },
  {
    target: '[data-tour="details"]',
    stage: 'details',
    title: 'The paper detail panel',
    body:
      'Everything about the selected paper lives here: how it’s classified, its ' +
      'abstract and TL;DR, links out, community code, and the paper’s own figures. ' +
      'Click any paper on the map to open it — the next stops walk each part.',
  },
  {
    target: '[data-tour="detail-tags"]',
    stage: 'details',
    title: 'Field tags',
    body:
      'How the paper is classified, labeled by who says so — arXiv’s own categories and ' +
      'the data provider’s field-of-study tags, each in its own section.',
  },
  {
    target: '[data-tour="detail-summary"]',
    stage: 'details',
    title: 'TL;DR & abstract',
    body:
      'A paper opens on its TL;DR when it has one — Semantic Scholar’s own, or one ' +
      'written earlier — with the full abstract a click away. When the TL;DR tab shows ' +
      'a ✦, clicking it asks Claude to write one. That happens once, and the summary ' +
      'is remembered for good. Math renders properly, subscripts and all.',
  },
  {
    target: '[data-tour="detail-actions"]',
    stage: 'details',
    title: 'Jump off from here',
    body:
      'Open the abstract page or the PDF, or Pin the node where you dragged it. On any ' +
      'paper but the seed, “Expand on this graph” adds all its references, or its citers ' +
      'picked the way the seed’s are, to this map and moves the paper, now pink, out with ' +
      'them: in Force, a cluster of its ' +
      'own laid out like the seed’s (references left, citers right), with the papers it ' +
      'shares with the seed sitting in between; in Timeline, a stream above the seed’s. ' +
      'The view refits to show where they went. A hop that has run wears a green ✓; ' +
      'click it again to take those papers back off. “Explore in a thread” opens a new ' +
      'map with it as the seed.',
  },
  {
    target: '[data-tour="detail-code"]',
    stage: 'details',
    title: 'Code & artifacts',
    body:
      'What the community built on this paper, via Hugging Face Papers: the linked ' +
      'GitHub repo (with stars) and the top models, datasets, and Spaces.',
  },
  {
    target: '[data-tour="detail-figures"]',
    stage: 'details',
    title: 'The paper’s own figures',
    body:
      'Real figures pulled from the paper itself, captions included (click one to ' +
      'enlarge). Journal papers get theirs mined straight from the open-access PDF — ' +
      'tables and algorithm boxes included. The teacher can pull these same figures ' +
      'into its answers.',
  },
  {
    target: '[data-tour="assistant-btn"]',
    title: 'Nova, when you want it',
    body:
      'The floating astronaut is Nova: your AI assistant! Click to open Nova beside every view — the graph, the ' +
      'course and the Reader alike; ✕ tucks it away again, and it stays the way you leave it. ' +
      'Drag the astronaut anywhere over the view and it stays there; the ↺ beside it on hover ' +
      'puts it back in the corner. ' +
      'Nova docks on the right or ' +
      'along the bottom: the button by its ✕ moves it. It ' +
      'talks in the chat you were last in, so a conversation can follow you across papers; ' +
      'the chat’s name under the title is a menu to switch to another, or start one, and ' +
      'the 🗑 beside it deletes it (click twice: it asks first).',
  },
  {
    target: '[data-tour="source-scope"]',
    stage: 'assistant',
    presentIf: '[data-tour="source-scope"]',
    title: 'Your library, in or out',
    body:
      'The 📚 in the bar scopes Nova’s reach into your library: all of your ' +
      'uploaded sources, a subset, or none at all. Checked means searchable — answers ' +
      'cite whatever passages they use by page. Untick everything and Nova ' +
      'leaves your library alone, which works with a single uploaded source too.',
  },
  {
    target: '[data-tour="model-picker"]',
    stage: 'assistant',
    presentIf: '[data-tour="model-picker"]',
    title: 'Pick the model for this chat',
    body:
      'The network icon beside it picks which model answers in this chat, from every model your ' +
      'providers list. A dot on it means this chat has its own pick; “Settings default” ' +
      'goes back to the one Settings → Agents sets for the Researcher. At the top right of ' +
      'each answer, a clock runs while it’s on its way and then says how long it took.',
  },
  {
    target: '[data-tour="ask"]',
    stage: 'assistant',
    presentIf: '[data-tour="assistant-btn"]',
    title: 'One bar, answers and lectures',
    body:
      'Ask anything about what’s on screen. The agent grounds in the papers you’ve ' +
      'selected — or in every visible paper when you haven’t picked any. It reads them ' +
      'in full, hops the graph along its citations, searches your uploaded library and the ' +
      'web, then answers with numbered citations (click one to highlight its paper on the ' +
      'graph). Papers its hops find join the map beside the paper they came from. It doesn’t search for ' +
      'new papers past the graph: that’s what your chats (Chats in the rail) are for. While it’s still ' +
      'searching, “Quick response” beside “Working” stops the search and answers now, ' +
      'from what’s on screen and the model’s own knowledge. Press Enter to send; ⇧ Shift+Enter starts a new line for longer questions. ' +
      'Spotted a typo after sending? The ✎ on the latest question you typed edits it and sends it again in place of its answer.',
  },
  {
    target: '[data-tour="ask"]',
    stage: 'assistant',
    presentIf: '[data-tour="assistant-btn"]',
    title: 'Ask to be taught, not answered',
    body:
      'Ask for a lecture in the same bar — “lecture me on these”, “what’s the story ' +
      'here?” — and Nova narrates the papers you have on screen instead, so you ' +
      'decide what it is about. Filter to the references and you get the story of how ' +
      'the field arrived here; keep only recent work and you get the current frontier; ' +
      'alt-drag a cluster and it narrates just those. Scope it to a single paper — any ' +
      'paper — and it teaches that one, chapter by chapter. Or say which papers in the ' +
      'message itself: “lecture me on the references”, “on the seed”, “on the Bekenstein ' +
      'paper and Hawking 1975”, “the whole graph”, “the papers between 2016 and 2017” — those become the ' +
      'selection, drawn even if a filter hides them, and are narrated; questions scope ' +
      'the same way, and each reply says what it was scoped to. When a ' +
      'lecture finishes the whole of it stays lit. Say “history” and it walks them oldest ' +
      'to newest; otherwise it groups them into their key themes. Papers light up on the ' +
      'map as each part of the story arrives, and the beats read as the reply, in the ' +
      'conversation with everything else. Every turn it guessed on says whether Nova ' +
      'answered or lectured, and offers the other in a click, so a wrong guess costs nothing.',
  },
]

/** Every staged settings step's presence proxy: the nav is always there. */
const SETTINGS_NAV = '[data-tour="settings-nav"]'

/** The settings modal's tour. Stages are `<section>` or `<section>/<page>`,
 *  which `SettingsModal` turns into a nav click before the step is measured. */
export const SETTINGS_TOUR: TourStep[] = [
  {
    target: '[data-tour="settings-search"]',
    title: 'Find any setting',
    body:
      'Type here and the sidebar narrows to the sections with a match while the pane ' +
      'shows only the matching rows — it reaches individual settings, wherever they live, ' +
      'including ones tucked away on a sub-page.',
  },
  {
    target: SETTINGS_NAV,
    title: 'The sections',
    body:
      'General, Graph, Data Providers, Agents and Library. Everything here is one ' +
      'config file, edited in place: change something and a Save bar appears at the ' +
      'bottom; nothing touches the file until you press Save, and a saved change applies ' +
      'to the running app without a restart.',
  },
  {
    target: '[data-tour="settings-location"]',
    title: 'Which config file',
    body:
      'The file every setting reads from and saves to. Type a path or browse with 📁 to ' +
      'switch — handy for keeping one file per machine or per experiment. This row applies ' +
      'immediately; it is a setting about the file, not part of it.',
    stage: 'general',
    presentIf: SETTINGS_NAV,
  },
  {
    target: '[data-tour="settings-adaptive"]',
    title: 'Graph size',
    body:
      'Left on, Curious Astronaut sizes each graph from the seed’s own citation pool. Turn it off to ' +
      'set the band shape yourself. These live in this browser, not the file, and apply as ' +
      'you change them — the current graph rebuilds when you close settings.',
    stage: 'graph',
    presentIf: SETTINGS_NAV,
  },
  {
    target: '[data-tour="settings-s2-key"]',
    title: 'Where the papers come from',
    body:
      'Semantic Scholar and OpenAlex both work with no key, on tighter public rate ' +
      'limits. A free S2 key is the single biggest speed-up available, and this is also ' +
      'where the optional offline citations corpus is pointed.',
    stage: 'providers',
    presentIf: SETTINGS_NAV,
  },
  {
    target: '[data-tour="settings-vendor-apply"]',
    title: 'The AI teacher’s vendors',
    body:
      'Model Providers holds the credentials for each vendor Curious Astronaut can reach — Google ' +
      'and a local Ollama cost nothing. Under each one, "Apply Default Models" puts the ' +
      'lecturer and researcher on its advanced model and the summarizer and scouts on its ' +
      'light one in one click, and takes you to Agent Settings to see it — the quick way ' +
      'onto a free tier, or off a vendor that is rate-limiting you.',
    stage: 'agents/providers',
    presentIf: SETTINGS_NAV,
  },
  {
    target: '[data-tour="settings-agent-model"]',
    title: 'One model per agent',
    body:
      'Agent Settings has a tab for each agent. Pick a tab to change its vendor, model and ' +
      'tuning knobs. Mixing is normal — a free local model for the lecturer while the web ' +
      'scout stays on a cloud one that can actually search the web.',
    stage: 'agents/agents',
    presentIf: SETTINGS_NAV,
  },
  {
    target: '[data-tour="settings-sources-enabled"]',
    title: 'Your library',
    body:
      'Uploaded PDFs and fetched pages are embedded and searched on this machine — no ' +
      'API, nothing leaves the computer. This switch is the gate: off, the library is ' +
      'still stored and searched by exact words, and the local model is never loaded.',
    stage: 'sources/general',
    presentIf: SETTINGS_NAV,
  },
  {
    target: '[data-tour="settings-search-k"]',
    title: 'How much a search hands over',
    body:
      'Retrieval sets how many passages Nova gets per search of your library. ' +
      'Embedding picks the local model and device; Chunking decides how the text is cut ' +
      'into passages — change the model and the library needs re-ingesting.',
    stage: 'sources/retrieval',
    presentIf: SETTINGS_NAV,
  },
  {
    target: '[data-tour="settings-help"]',
    title: 'Run this again',
    body: 'This walk is always one click away. Close settings with the ✕ beside it.',
  },
]
