import { openChat, openTag, selectScope } from '../store/workspace'
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The unified assistant — a slim shell around one conversation, rendered in
 * two shapes and at two capability levels. The shapes:
 *   • `landing` — no graph yet, so the chat owns the whole body as a centred
 *     column. This is the app's front door, and needs neither a graph nor an
 *     uploaded library to be useful.
 *   • docked — a graph is open, so it collapses to a resizable side panel
 *     beside the map.
 * The capability, independently:
 *   • No graph → the researcher, seedless: the literature plus whatever
 *     sources the reader has uploaded.
 *   • A graph is open → the streaming lecture + agentic Q&A over it.
 *
 * **The two shapes are one component instance, deliberately.** The shell keeps
 * it at a single position in the tree and only swaps the `landing` flag, so
 * entering graph mode collapses the chat into the panel without remounting —
 * the conversation, its scroll position and its run state all survive. That
 * is the whole point of clicking a cited paper: the answer you were reading is
 * still there when its graph arrives. (`epoch`, which the parent keys on, no
 * longer bumps on a graph load for the same reason — only Home and a session
 * restore remount.)
 *
 * **Docked, the panel is a stack of folding sections** (v7.10.0): *Lectures*
 * — the four mode buttons and whichever lecture is shown — and *Chat*, the
 * conversation, whose caret row also carries every control that binds the ask:
 * the 🎓/📚 scope pickers and the 🔍/▽ search controls, because those scope
 * the researcher answering there rather than the lecturer above.
 * Before this the two shared one scroll and took turns: playing a lecture hid
 * the chat, asking a question hid the lecture. Sections let a reader keep a
 * lecture open and ask about it. With no graph there is nothing to divide, so
 * the conversation simply is the panel.
 *
 * **The ask bar itself holds nothing but the question** (v7.11.0). Those four
 * controls all used to sit inside the pill, which made the one thing you came
 * here to use — a box to type in — read as a toolbar with a text field wedged
 * in it. Without a graph they moved out to a chip row directly beneath the
 * bar; with one, up to the Chat row above it. Either way they stay adjacent to
 * the ask they modify, and the bar goes back to looking like a bar.
 *
 * The conversation itself lives in the store (transcript slice) and the
 * stream orchestration in useConversation; this component owns only what it
 * alone renders — the input box, the section folds, the scope picker's data,
 * the lightbox. A restored session's transcript arrives via the store, no
 * seeding props needed.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AnimationEvent, CSSProperties, FormEvent, KeyboardEvent } from 'react'
import {
  DEFAULT_SEARCH_OPTIONS,
  type AnswerFigure,
  type Beat,
  type ChatMsg,
  type MentionPaper,
  type SearchOptions,
  type TurnTag,
} from '../api'
import { useAppDispatch, useAppSelector } from '../store'
import { failedTurnDropped, selectChatKey, selectConversation } from '../store/transcript'
import { quotedMessage, type PassageQuote } from '../assistant/askAssistant'
import DockChatPicker from '../assistant/DockChatPicker'
import { anchorTurn, takeTurnAnchor, useTurnTags } from '../assistant/useTurnTags'
import TagFilter, { tagKey, type TagChoice } from '../assistant/TagFilter'
import { highlightSet, passagesLit } from '../store/highlight'
import { answerLight, beatLight } from '../reader/askReader'
import { TURN_TOOL_NAMES, tagLabel } from '../store/chats'
import { explorationChats, paperTag } from '../store/chats'
import { threadTool } from '../store/explorations'
import { useCourseView } from '../knowledge/assistant/useCourseView'
import { useReaderView } from '../reader/useReaderView'
import { conversationHistory } from './history'
import HopDots from './HopDots'
import ComposerNotes from './ComposerNotes'
import SourcePicker from './SourcePicker'
import { useSourceScope } from './useSourceScope'
import SearchControls from '../search/SearchControls'
import { useDirectSearch } from '../search/useDirectSearch'
import { ID_RE } from '../graph/model'
import MentionSuggestions from '../mentions/MentionSuggestions'
import AttachedChips from '../mentions/AttachedChips'
import {
  attachedMessage,
  attachmentKey,
  withAttachment,
  withoutMention,
} from '../mentions/attachments'
import { mentionText, readMessage } from '../mentions/parse'
import type { MentionChoice } from '../mentions/parse'
import { useMentionSuggestions } from '../mentions/useMentionSuggestions'
import { DRAFT_EVENT, draftWaiting, takeDraft } from './composerDraft'
import ModelPicker from './ModelPicker'
import Lightbox from '../figures/Lightbox'
import ChatMessage from './transcript/ChatMessage'
import { useConversation } from './useConversation'
import { useResizablePanel } from '../ui/useResizablePanel'
import { useTheme } from '../ui/theme'
import { usePresence } from '../ui/usePresence'
import SendGlyph from '../ui/SendGlyph'
import ClearGlyph from '../ui/ClearGlyph'
import './teacher.css'

/**
 * Whether the reader has asked the OS for less motion.
 *
 * The CSS entrances answer this with a `prefers-reduced-motion` block; the
 * composer's FLIP is scripted, so it has to ask directly. Read at call time,
 * never at module scope — this module is imported by tests running in the
 * node environment, where there is no `window` at all.
 *
 * @returns True when motion should be skipped.
 */
function prefersStill(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** Each chat's lecture folds the reader chose, by turn (see `toggleFold`),
 *  for the sitting: kept here because the panel remounts on every view. */
const lectureFolds = new Map<string, Record<number, boolean>>()
/** A stable empty fold record, for a chat with none chosen. */
const NO_FOLDS: Record<number, boolean> = {}

/** Where the docked assistant sits (v9.0.0): beside the view, or under it. */
export type AssistantDock = 'right' | 'bottom'

/** How long the panel takes to morph from one edge to the other, ms. */
const DOCK_MORPH_MS = 420

/** Below this width the docked panel covers the view rather than squeezing
 *  it (teacher.css holds the same breakpoint). */
export const NARROW_QUERY = '(max-width: 900px)'

/**
 * Whether two tags name the same place: both General, or one paper's tool.
 *
 * @param left One tag.
 * @param right The other.
 * @returns True when a question asked at one was asked at the other.
 */
function sameTag(left: TurnTag | undefined, right: TurnTag | undefined): boolean {
  if (!left || !right) return !left && !right
  return left.threadId === right.threadId && left.tool === right.tool
}

/**
 * The dock-flip glyph: a window with its panel along the edge it would move
 * to, so the button shows where the assistant goes.
 *
 * @param props Component props.
 * @param props.to The edge it moves the panel to.
 * @returns The inline glyph.
 */
function DockGlyph({ to }: { to: AssistantDock }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" />
      {to === 'bottom' ? (
        <rect x="2.5" y="9" width="11" height="4" fill="currentColor" opacity="0.6" />
      ) : (
        <rect x="9.5" y="3" width="4" height="10" fill="currentColor" opacity="0.6" />
      )}
    </svg>
  )
}

/**
 * Render the assistant panel: the conversation and the ask form.
 *
 * @returns The docked, resizable assistant panel.
 */
export default function Teacher({
  collapsed = false,
  landing = false,
  onClose,
  dock = 'right',
  onDockChange,
  quote = null,
  onQuoteClear,
}: {
  /** Hidden (but kept mounted, so the conversation survives) when collapsed. */
  collapsed?: boolean
  /**
   * This is the landing surface, not a docked side panel: no graph is open, so
   * the conversation gets the whole body as a centred column. Deliberately the
   * *same component instance* as the docked panel — the shell keeps it at one
   * position in the tree and only swaps this flag, so entering graph mode
   * collapses the chat into the side panel without remounting it, and the
   * answer you were reading keeps its scroll position.
   */
  landing?: boolean
  /** Collapse the panel (the header ✕). */
  onClose?: () => void
  /** Which edge it docks against beside a view (v9.0.0). */
  dock?: AssistantDock
  /** Move it to the other edge (the header's dock button). */
  onDockChange?: (dock: AssistantDock) => void
  /** A passage a highlight's Chat attached to the bar (the course's or the
   *  Reader's), with a `seq` that changes each time one is attached. */
  quote?: (PassageQuote & { seq: number }) | null
  /** Let go of the attached passage (its ✕, or sent). */
  onQuoteClear?: () => void
}) {
  const chat = useAppSelector((state) => selectConversation(state).chat)
  // The graph on screen, so a turn answered over a different one can say which.
  const subject = useAppSelector((state) =>
    state.explorations.byId[state.explorations.activeId]?.threads.find(
      (thread) => thread.id === state.transcript.activeKey,
    ),
  )
  // The view it is docked beside, and what that view lends it (v9.0.0, one
  // assistant): the course's and the Reader's asking, words and passages
  // (`assistant/views`). The Citation Graph's and a chat's asking are this
  // panel's own (`useConversation`), so their view is null here.
  const tool = landing ? null : threadTool(subject)
  const course = useCourseView(tool === 'knowledge' ? subject : undefined)
  const reader = useReaderView(tool === 'reader' ? subject : undefined)
  const view = course ?? reader
  const passages = view?.passages
  // The default scope's size — the selection, else what passes the filters
  // (`scope/resolve.ts`'s last two rungs; the message's rung is per turn).
  const scopeCount = useAppSelector((state) => selectScope(state).nodes.length)
  // How many nodes the user has hand-picked on the graph (alt-drag / shift-click)
  // to scope the teacher; 0 means it grounds in every paper passing the filters.
  const pickedCount = useAppSelector((state) => state.workspace.selectedNodeIds.length)
  const {
    hasGraph,
    asking,
    error,
    activeChat,
    activeChatBeat,
    onChatBeatClick,
    onChatClick,
    onRefClick,
    onPaperSeed,
    provider,
    send,
    reroute,
    retryAnswer,
    quickAnswer,
    stopAsk,
    clearChat,
  } = useConversation()

  // The other chats in this exploration (`store/chats`), offered as `@` rows
  // above the paper results so a question can carry one along. The chat on
  // screen is the active one, or beside a graph the dock's (v9.0.0).
  const explorationRecord = useAppSelector(
    (state) => state.explorations.byId[state.explorations.activeId],
  )
  const activeKey = useAppSelector(selectChatKey)
  const siblingThreads = useMemo(
    () =>
      explorationRecord
        ? explorationChats(explorationRecord)
            .filter((entry) => entry.key !== activeKey)
            .map((entry) => ({ id: entry.key, title: entry.label }))
        : [],
    [explorationRecord, activeKey],
  )
  const tags = useTurnTags(activeKey, chat)
  // Where a question asked here is tagged (v9.0.0): the view's paper and tool,
  // the Citation Graph's, or General. An answer is this view's to retry,
  // re-ask or light when its question was asked here: the chat also holds
  // turns asked beside other views, which need their own context.
  // Without a view of its own (the graph, the cards, Peer Reviews), a paper
  // whose graph is loaded asks over that graph, as `useConversation` stamps it.
  const screenTag: TurnTag | undefined = view
    ? paperTag(view.thread, view.tool)
    : hasGraph && subject?.identity
      ? paperTag(subject, 'graph')
      : undefined
  const owns = (index: number) => sameTag(chat[index - 1]?.tag, screenTag)
  // A view's own provider, for the papers its searches find.
  const viewProvider = view?.thread.data.provider ?? 's2'
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dispatch = useAppDispatch()
  // Which uploaded sources the assistant may search (the 📚 picker), shared
  // with the Knowledge Graph's assistant since v8.25.0: `useSourceScope`.
  const sources = useSourceScope()
  const libraryItems = sources.items
  // The papers picked from the `@` dropdown in the message being composed,
  // keyed by the text inserted for each. A ref rather than state because
  // nothing renders from it — it is read once, at send — and re-rendering the
  // composer on every pick would fight the textarea's own caret handling.
  const resolvedMentions = useRef<Map<string, MentionPaper>>(new Map())
  // What the `@` picks attached, as chips over the bar (v8.29.0) rather than
  // titles spliced into the question — the reader couldn't tell where an
  // inline `@Title` ended and their own words began. Sent as the message's
  // leading `Attached:` line (`mentions/attachments.ts`).
  const [attached, setAttached] = useState<MentionChoice[]>([])
  // Docked over a graph, `@` looks nothing up (v8.28.0): no provider
  // lookups, so no quick search on a bare `@words` either — finding papers is
  // the General chat's job. Since v8.29.0 it does offer the papers already on
  // the graph, matched locally, below the chats: naming one of those isn't a
  // search, it's pointing, and the question then grounds in it first.
  const graphNodes = useAppSelector((state) => state.workspace.graph?.nodes)
  const foundNodes = useAppSelector((state) => state.workspace.discoveredNodes)
  const graphPapers = useMemo(
    (): MentionPaper[] =>
      [...(graphNodes ?? []), ...foundNodes].map((node) => ({
        id: node.id,
        arxiv_id: node.arxiv_id ?? null,
        title: node.title,
        authors: node.authors ?? null,
        venue: node.venue ?? null,
        year: node.year ?? null,
        citation_count: node.citation_count ?? null,
        url: node.url ?? null,
      })),
    [graphNodes, foundNodes],
  )
  // Beside the course or the Reader, `@` offers chats only (as their own
  // panels did): that assistant has no numbered papers to attach one to.
  const mentions = useMentionSuggestions(
    provider,
    siblingThreads,
    landing,
    landing || view ? undefined : graphPapers,
  )
  // The `@` list fades out rather than vanishing (ui/usePresence). Closing
  // usually clears the hook's results in the same render, so the exit plays
  // over the last list that was actually on screen, not an emptied one.
  const mentionsPanel = usePresence(mentions.open)
  const lastMentions = useRef(mentions)
  if (mentions.open) lastMentions.current = mentions
  const shownMentions = mentions.open ? mentions : lastMentions.current
  // Which scope picker's popover is open — one shared slot, so opening either
  // picker closes the other (their popovers overlap when both are open).
  const [openScope, setOpenScope] = useState<'lectures' | 'sources' | 'filters' | 'model' | null>(
    null,
  )
  // The bar's filters. They bind every paper search — the reader's `@`
  // lookups excepted (see routes/search.py's api_mentions) and the
  // assistant's own included — which is why they sit beside the input rather
  // than inside any one search control. The "Find papers" toggle they used to
  // sit outside is gone in v7.18.0: a search is now something you say, with
  // `@`, not a mode you arm.
  const [searchOptions, setSearchOptions] = useState<SearchOptions>(DEFAULT_SEARCH_OPTIONS)
  // The answer figure opened full-screen (null = closed).
  const [lightbox, setLightbox] = useState<AnswerFigure | null>(null)
  // The paper scout's own failure slot. Separate from the conversation's
  // `error` because only a transport failure lands here — the scout
  // degrades internally, so a rate-limited provider arrives as a normal
  // result whose summary says so.
  const [searchError, setSearchError] = useState<string | null>(null)
  // Sized along whichever edge it docks against (v9.0.0): its width beside
  // the view, its height under it. Each is remembered on its own.
  const besideSize = useResizablePanel('atlas.teacherWidth', 340)
  const underSize = useResizablePanel('ca.assistantHeight', 320, {
    side: 'bottom',
    min: 180,
    max: 900,
    maxFraction: 0.7,
  })
  const { width: size, onHandlePointerDown, dragging } = dock === 'bottom' ? underSize : besideSize
  // Closing and reopening slide the docked panel (panel-out / panel-in,
  // index.css). It must stay mounted — that is what keeps the conversation —
  // so `display: none` (.collapsed) only lands once the slide-out has
  // played, and the slide-in is tied to the *reopen*, not to the class: a
  // panel arriving with its graph is the graph's entrance, not this one.
  const panel = usePresence(!collapsed)
  const [wasCollapsed, setWasCollapsed] = useState(collapsed)
  const [reopening, setReopening] = useState(false)
  if (collapsed !== wasCollapsed) {
    setWasCollapsed(collapsed)
    setReopening(!collapsed)
  }
  const onDockAnimationEnd = (event: AnimationEvent) => {
    panel.onAnimationEnd(event)
    if (
      reopening &&
      event.target === event.currentTarget &&
      (event.animationName === 'panel-in' || event.animationName === 'panel-in-bottom')
    )
      setReopening(false)
  }
  // **Moving it to the other edge morphs** (Patrick): the panel slides and
  // reshapes from where it was into where it lands, a FLIP. Its box is
  // measured at the click (never per render: this re-renders per streamed
  // token), the move lays it out on the other edge, and before that paints
  // it is drawn back in the old box and animated into the new one. Its
  // contents fade through the middle, so the stretch of a scaled box never
  // reads as squashed text.
  const sectionRef = useRef<HTMLElement>(null)
  const dockedFrom = useRef<DOMRect | null>(null)
  const moveDock = (next: AssistantDock) => {
    dockedFrom.current = sectionRef.current?.getBoundingClientRect() ?? null
    onDockChange?.(next)
  }
  useLayoutEffect(() => {
    const panelBox = sectionRef.current
    const from = dockedFrom.current
    dockedFrom.current = null
    if (!panelBox || !from || prefersStill()) return
    const to = panelBox.getBoundingClientRect()
    if (!to.width || !to.height) return
    const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
    // `animate` is optional-called: jsdom has no Web Animations API.
    panelBox.animate?.(
      [
        {
          transformOrigin: 'top left',
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transformOrigin: 'top left', transform: 'none' },
      ],
      { duration: DOCK_MORPH_MS, easing },
    )
    for (const part of panelBox.children)
      part.animate?.([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], {
        duration: DOCK_MORPH_MS,
        easing,
      })
  }, [dock])
  // Over a narrow window the docked panel covers the view (v9.0.0,
  // teacher.css), so Esc from inside it puts it away again, back to the view.
  const onPanelKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === 'Escape' &&
      !landing &&
      onClose &&
      !event.defaultPrevented &&
      window.matchMedia?.(NARROW_QUERY).matches
    )
      onClose()
  }
  // A scout run shares the bar's busy state with the researcher: one bar, one
  // spinner, and neither can be fired while the other is running.
  // **Paper filters live on the General chat alone** (v8.28.0). Docked over a
  // graph nothing searches papers — not the assistant, not a bare `@words` —
  // so the defaults go out there, and filters set on the landing chat can't
  // ride along out of sight.
  const activeOptions = landing ? searchOptions : DEFAULT_SEARCH_OPTIONS
  const { searching, runSearch } = useDirectSearch(provider, activeOptions, setSearchError)

  // "No scope" (search the whole library) only when every source is checked;
  // any other state is sent as an explicit id list (empty = search nothing).
  const scopeIds = sources.checkedIds
  const scopeArg = sources.scope

  // One bar, four destinations. The first three are decided HERE on plain
  // facts — a pasted id is exact, a picked mention is a paper they already
  // chose, an unresolved `@phrase` is a search — so they cost nothing and
  // cannot be wrong. Only the fourth asks a model, because "teach me these
  // papers" and "which of these used dropout" differ in their words and
  // nowhere else; `send` owns that, and the turn it produces says which
  // assistant it picked so the reader can take the other in one click.
  //
  // There was a fifth until v7.23.0: a `/lecture` command, the deterministic
  // way to name the lecturer (and its framing) without a classify. It went
  // because the router already reads all of that off the words — and, since
  // the same version, reads *which papers* too ("lecture me on the
  // references"), which a two-value command could never say. What survives
  // of it is the router's own no-model fast path for "lecture me on these".
  const submitQuestion = (text: string = input) => {
    const typed = text.trim()
    // **Chips alone send nothing** (Patrick, v8.29.0): a chip is context for
    // a question, so Send waits for the words. Searching has its own row in
    // the `@` list, and a chip used to double as one when sent alone — which
    // made Enter mean two things depending on whether anything was typed.
    if (!typed || asking || searching) return
    // Beside the course or the Reader, the view asks (v9.0.0): with any
    // passage a highlight's Chat attached, and the passage's place and
    // labels for the Reader to light.
    if (view) {
      if (!view.available) return
      const question = attachedMessage(attached, quote ? quotedMessage(typed, quote) : typed)
      setAttached([])
      setInput('')
      mentions.reset()
      onQuoteClear?.()
      followNextTurn()
      void dispatch(
        view.ask({
          threadId: view.thread.id,
          question,
          provider: viewProvider,
          sourceIds: scopeArg,
          places: quote?.places,
          figures: quote?.figures,
          labels: quote?.labels,
        }),
      )
      return
    }
    const question = attachedMessage(attached, typed)
    setAttached([])
    setInput('')
    mentions.reset()
    followNextTurn()
    // A pasted arXiv id/URL is a statement of intent, not a question: land on
    // that exact paper. First in the tree because it needs no lookup at all —
    // the id IS the answer, where every branch below has to resolve something.
    if (ID_RE.test(question)) {
      onPaperSeed(question)
      return
    }
    // What the words turn out to be. `readMessage` is a substring check and a
    // startsWith — the three branches below stay free and exact. What changed
    // in v7.18.0 is that the reader says which of them they meant, with `@`,
    // instead of arming a mode beforehand. A `@thread[…]` mention always
    // reads as `ask`; `send` finds the named threads and attaches them.
    const intent = readMessage(question, resolvedMentions.current)
    resolvedMentions.current = new Map()
    if (intent.kind === 'seed' && !landing) {
      // Docked, `@Title` alone points at a paper on the graph rather than
      // opening it in a thread of its own: it is a question about that paper.
      void send(question, scopeArg, activeOptions, [intent.paper])
      return
    }
    if (intent.kind === 'seed') {
      // A resolved mention alone: we already hold the exact paper, so seed on
      // its id rather than re-resolving the title we just looked up.
      onPaperSeed(intent.paper.arxiv_id || intent.paper.id)
      return
    }
    if (intent.kind === 'find' && landing) {
      // `@words` that resolved to nothing, alone on the line — the dropdown's
      // fallback. This is what the "Find papers" toggle used to do, now said
      // rather than switched to.
      void runSearch(intent.query)
      return
    }
    // Anything else: a message whose destination is genuinely unknown. `send`
    // classifies it and streams from the lecturer or the researcher.
    void send(question, scopeArg, activeOptions, intent.kind === 'ask' ? intent.mentioned : [])
  }

  const onAsk = (event: FormEvent) => {
    event.preventDefault()
    submitQuestion()
  }

  /**
   * Ask a view's failed question again, with the history up to it — or, for
   * ⚡ Quick response, a question still being answered, with no tools.
   *
   * @param index The failed (or working) assistant turn.
   * @param quick Stop the working answer and ask for a quick response.
   */
  const retryInView = (index: number, quick = false) => {
    const question = chat[index - 1]
    if (!view || !question || question.role !== 'user') return
    const history = conversationHistory(chat.slice(0, index - 1))
    // A quick response stops the answer still working first, so nothing
    // more of it lands once its turn is gone.
    if (quick) stopAsk()
    dispatch(failedTurnDropped(index, activeKey))
    void dispatch(
      view.ask({
        threadId: view.thread.id,
        question: question.text,
        provider: viewProvider,
        history,
        sourceIds: scopeArg,
        quick,
        startedAt: quick ? chat[index]?.startedAt : undefined,
        places: question.places,
        figures: question.boxedFigures,
        labels: question.labels,
      }),
    )
  }

  // The ask box is a textarea so long questions wrap and stay readable. Keep
  // the chat convention: Enter sends, Shift+Enter drops a newline (letting a
  // question run multiple lines without hitting the Ask button).
  /**
   * Accept a suggestion: attach it as a chip (v8.29.0) and cut the `@query`
   * out of the draft. A paper's resolution is remembered so `readMessage`
   * finds it again in the sent `Attached:` line. A thread needs no such
   * record — its `@thread[Title]` token is the whole reference, and `send`
   * resolves it against the exploration's threads.
   *
   * @param choice The picked paper or thread.
   */
  const pickMention = (choice: MentionChoice) => {
    const field = inputRef.current
    if (!field || !mentions.active) return
    const { text: next, caret } = withoutMention(input, mentions.active)
    if (choice.kind === 'paper') resolvedMentions.current.set(mentionText(choice), choice.paper)
    setAttached((current) => withAttachment(current, choice))
    setInput(next)
    mentions.reset()
    // The caret has to be restored after React paints the new value, or the
    // browser parks it at the end of the message and the reader's sentence
    // continues in the wrong place.
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(caret, caret)
    })
  }

  /**
   * Open a paper from the `@` list in a thread of its own: its Open button, or
   * Shift+Enter on its row (v8.29.0). The General chat's alone — docked, `@`
   * points at papers on the graph rather than opening them. The `@query`
   * leaves the bar; chips stay.
   *
   * @param paper The paper to open.
   */
  const openMention = (paper: MentionPaper) => {
    if (mentions.active) setInput(withoutMention(input, mentions.active).text)
    mentions.reset()
    resolvedMentions.current = new Map()
    onPaperSeed(paper.arxiv_id || paper.id)
  }

  /**
   * Run the `@` list's search row: the full paper search on what was typed
   * after `@`, its results listed in the transcript. The `@query` leaves the
   * bar; any chips stay attached for the question that follows.
   *
   * @param query What to search for.
   */
  const searchMention = (query: string) => {
    if (!mentions.active || asking || searching) return
    setInput(withoutMention(input, mentions.active).text)
    mentions.reset()
    resolvedMentions.current = new Map()
    followNextTurn()
    void runSearch(query)
  }

  /**
   * Re-read the composer after any change that could move the caret, so the
   * `@` dropdown follows it. The draft's resolved mentions go along so a
   * picked title ends its mention instead of the question typed after it
   * becoming an ever-longer query.
   *
   * @param field The textarea, read for both its value and its caret.
   */
  const syncComposer = (field: HTMLTextAreaElement) => {
    mentions.onInput(
      field.value,
      field.selectionStart ?? field.value.length,
      resolvedMentions.current.keys(),
    )
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // While the dropdown is open it owns the arrows and Escape, and Enter/Tab
    // whenever a row is selected: the search row by default on the General
    // chat's whole-message `@words`, a paper or chat only once arrowed onto.
    // With nothing selected, Enter falls through and the message goes out as
    // typed. Everything else still reaches the textarea, so typing never
    // stops.
    if (mentions.open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        mentions.move(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (landing && event.key === 'Enter' && event.shiftKey && mentions.choice?.kind === 'paper') {
        event.preventDefault()
        openMention(mentions.choice.paper)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && mentions.choice) {
        event.preventDefault()
        // Every pick attaches (v8.29.0); the paper opens from the search
        // list, not from the bar.
        pickMention(mentions.choice)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && mentions.searchChosen && mentions.search) {
        event.preventDefault()
        searchMention(mentions.search)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        mentions.dismiss()
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitQuestion()
    }
    // Backspace in an empty bar lets go of the last chip, as in most
    // composers, and then of an attached passage.
    if (event.key === 'Backspace' && !input) {
      if (attached.length) setAttached((current) => current.slice(0, -1))
      else if (quote) onQuoteClear?.()
    }
  }

  // A passage just attached (a highlight's Chat): the bar takes focus, ready
  // for the question.
  const quoteSeq = quote?.seq
  useEffect(() => {
    if (quoteSeq) inputRef.current?.focus()
  }, [quoteSeq])

  // A draft handed over from the rail (v8.31.0): the Papers ＋ opens a chat
  // with `@` typed, ready to search (`composerDraft`). Taken on mount — the
  // composer remounts with each thread — or when one arrives while already
  // here, and only on the General chat, the one whose `@` searches. Only
  // the draft addressed to this chat: the one being left hears it too.
  const onMentionInput = mentions.onInput
  const chatId = activeKey
  // A chat opened with its `@` typed arrives with the bar already in place
  // (`drafted`, teacher.css, v8.32.1): the list opens inside the bar's
  // block, and that block's entrance fade left the list see-through, the
  // picture showing through it, for most of the rise. Asked on the first
  // render so the entrance never starts; set again on taking, for a draft
  // that comes after.
  const [drafted, setDrafted] = useState(() => draftWaiting(chatId))
  useEffect(() => {
    if (!landing) return
    const take = () => {
      const draft = takeDraft(chatId)
      const field = inputRef.current
      if (draft === null || !field) return
      setDrafted(true)
      setInput(draft)
      requestAnimationFrame(() => {
        field.focus()
        field.setSelectionRange(draft.length, draft.length)
        onMentionInput(draft, draft.length)
      })
    }
    take()
    window.addEventListener(DRAFT_EVENT, take)
    return () => window.removeEventListener(DRAFT_EVENT, take)
  }, [landing, chatId, onMentionInput])

  // Grow the textarea to fit its content (up to the CSS max-height, past which
  // it scrolls): reset to auto so it can shrink back, then match scrollHeight.
  // Runs on every input change, including the reset to '' after a submit.
  //
  // **An empty composer is one line by construction, never by measurement.**
  // The inline height is cleared and the effect returns, leaving the CSS
  // `min-height` to floor it at exactly one line. Everything that can make
  // `scrollHeight` lie about an empty field — measuring inside a
  // `display:none` panel (it reports 0), measuring mid-layout, a stale inline
  // height from a longer draft — then cannot make the bar open several lines
  // tall with nothing in it, which is the one state a reader is guaranteed to
  // see and the one where being wrong looks like a broken control.
  useEffect(() => {
    const field = inputRef.current
    if (!field) return
    if (!input) {
      field.style.height = ''
      return
    }
    field.style.height = 'auto'
    if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight}px`
  }, [input])

  // Follow the bottom while an answer builds. Trace chips, tokens and beats all
  // arrive at the end of the transcript, and without this they simply grow past
  // the fold — the reader watches the agent work right up until the moment the
  // work scrolls out of sight.
  //
  // Conditional on purpose: it follows only while the reader is already AT the
  // bottom. Scroll up mid-answer to re-read something and the transcript stops
  // chasing, because yanking someone back down is worse than the problem this
  // solves; scroll back down and it resumes. The threshold is generous — a few
  // pixels of rounding, or a half-line of overshoot, still counts as "at the
  // bottom", and `.chat`'s entrance transform means the last element is briefly
  // 16px lower than its resting place while it animates in.
  const scrollRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const onTranscriptScroll = () => {
    const box = scrollRef.current
    if (box) following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  }
  useEffect(() => {
    const box = scrollRef.current
    if (!box || !following.current) return
    // Instant, never smooth: a smooth scroll can't keep up with SSE frames, and
    // several in flight at once fight each other into a visible judder.
    box.scrollTop = box.scrollHeight
  }, [chat])
  // The one exception to "only while already at the bottom": starting a turn
  // is a request to watch it. A reroute is clicked on an older turn — by
  // definition from further up — and a question is sent from the bar with
  // the transcript wherever it was left, and either way the new turn opened
  // below the fold, with the agent thinking out of sight. Re-arming here
  // lets the `[chat]` effect above take the very next frame to the bottom.
  const followNextTurn = () => {
    following.current = true
  }
  // A tag clicked keeps its place (Patrick): going where it was asked
  // remounts this panel, which would otherwise follow the bottom, so the
  // question it was on is brought back into view, and following stops until
  // the reader scrolls down again (`assistant/useTurnTags`). Before paint,
  // and before the follow effect above reads `following`.
  useLayoutEffect(() => {
    if (collapsed) return
    const index = takeTurnAnchor(activeKey)
    const box = scrollRef.current
    const turn = index === null ? null : box?.querySelector(`[data-turn="${index}"]`)
    if (!box || !turn) return
    following.current = false
    // Just under the "Showing" line when there is one: it sticks over the
    // top of the transcript, and a question scrolled to the very top sat
    // half hidden behind it (Patrick).
    const covered = box.querySelector<HTMLElement>('.tag-filter')?.offsetHeight ?? 0
    box.scrollTop +=
      turn.getBoundingClientRect().top - box.getBoundingClientRect().top - covered - 8
  }, [activeKey, collapsed, landing])

  // The composer's drop, on the first question of a landing session. Empty, it
  // sits optically centred with the greeting; the moment a conversation starts
  // it belongs at the bottom with the transcript filling in above. That move is
  // a flex-layout change, which CSS cannot transition — so this is a FLIP:
  // remember where the bar *was* on the last commit, and once the browser has
  // put it in its new place, animate it from the old position to the new one.
  // Nothing in the layout is faked; only a transform is played over the top.
  //
  // Keyed on `empty` alone, and deliberately not on every render: reading
  // getBoundingClientRect forces layout, and this component re-renders on every
  // streamed token.
  const askRef = useRef<HTMLDivElement>(null)
  const askTop = useRef<number | null>(null)
  const wasEmpty = useRef(false)
  const empty = landing && chat.length === 0
  useLayoutEffect(() => {
    const bar = askRef.current
    if (!bar) return
    const from = askTop.current
    if (wasEmpty.current && !empty && from !== null && !prefersStill()) {
      const travelled = from - bar.getBoundingClientRect().top
      // `animate` is optional-called: jsdom has no Web Animations API, so a
      // component test would otherwise die on a purely decorative flourish.
      if (travelled) {
        bar.animate?.(
          [{ transform: `translateY(${travelled}px)` }, { transform: 'translateY(0)' }],
          // Paced with the CSS entrances (`rise-in`, teacher.css) and eased
          // the same way — this travels much further than any of them, so it
          // gets the longer end of the range. Retune the two together.
          { duration: 560, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
        )
      }
    }
    wasEmpty.current = empty
    askTop.current = bar.getBoundingClientRect().top
  }, [empty])

  // A theme switch on the empty landing replays its entrance — the picture,
  // the greeting and the bar rise in together again, so the page reads as
  // re-lit rather than recoloured underneath you. The CSS animations are
  // restarted in place through the Web Animations API (cancel, then play)
  // instead of by remounting: a remount would throw away a half-typed
  // question. Reduced motion needs no check here — teacher.css sets those
  // animations to `none`, so there is nothing to replay. Optional-called for
  // jsdom, which has no getAnimations.
  const theme = useTheme()
  const lastTheme = useRef(theme)
  useEffect(() => {
    if (lastTheme.current === theme) return
    lastTheme.current = theme
    if (!empty) return
    const landingParts = [
      ...(scrollRef.current?.querySelectorAll('.landing-hero, .landing-greeting') ?? []),
      askRef.current,
    ]
    for (const part of landingParts)
      for (const animation of part?.getAnimations?.() ?? []) {
        animation.cancel()
        animation.play()
      }
  }, [theme, empty])

  // What the ask bar invites, which is not always the same offer. The old copy
  // promised books and PDFs whenever there was no graph — fine back when a
  // library was the price of admission, and a lie now that the assistant is
  // the landing surface for everyone. Only name the library when there is one.
  // The placeholder is where `@` is taught, because it is the only help
  // surface a reader is already looking at when they would need it. Every
  // variant names it: the gesture is the same with a graph, without one, and
  // with a library. The graph variant also teaches the lecture, and only that
  // one does — a lecture needs papers on screen to be about, so offering it
  // with no graph would advertise something the bar cannot do.
  //
  // **`@` is named again** (v8.25.0, Patrick). All three used to end "…or @
  // a paper", and for a while the graph variant taught `/` too; a verb and
  // two prefixes in one line read as a legend, so the prefix went, leaving
  // the tour to teach it. With chats per tool, `@` reaches more (a paper, or
  // another chat), and Patrick wanted it in view again. One prefix, no `/`
  // (a lecture is asked for in words); a narrow panel cuts the line with an
  // ellipsis, and the ⓘ over the bar (`ComposerNotes`) keeps the full tip.
  // With chips waiting, the bar asks for the question they wait on: chips
  // alone send nothing (v8.29.0), and a greyed Send shouldn't be the only
  // sign of why.
  const askPlaceholder = quote
    ? 'Ask anything about this passage…'
    : attached.length
      ? 'Now ask your question about what you attached…'
      : view
        ? view.copy.placeholder
        : hasGraph
          ? 'Ask about these papers or for a lecture; @ a paper or chat…'
          : libraryItems.length > 0
            ? 'Ask your books, PDFs or the literature; @ a paper or chat…'
            : 'Ask a research question, or @ a paper or chat…'

  // The one-line "Answers also draw on …" note above the ask bar, naming the
  // 📚 picker's state. It had a second half until v7.21.0 — "the lecture
  // (🎓)" — which went with that picker: a lecture is a turn now, so the
  // conversation itself says what the answer can draw on.
  //
  // Every panel shape since v8.28.0. It was graph mode only while the landing
  // chip wore its own count ("2 sources") a centimetre below; now the chip is
  // just its name, "Library filters", and this line is where the state is
  // spelled out everywhere (docked, the picker is a bare icon in the bar).
  const askContextParts: string[] = []
  if (scopeIds.length > 0) {
    askContextParts.push(`${scopeIds.length} source${scopeIds.length > 1 ? 's' : ''} (📚)`)
  }

  // Which sources the researcher may search: 📚 Library. ONE picker, rendered
  // in one of two places depending on the shape the panel is in (v8.28.0):
  //   • landing — a labelled chip in the tool row directly under the bar,
  //     beside the paper filters, with the room to wear its label;
  //   • docked — a round icon inside the bar beside 🗑, never lit; narrowed,
  //     it wears the same corner count badge as the chip, because a row of icon-only
  //     chips under a ~340px bar read as clutter.
  // It left the bar in v7.11.0, when the pill held three controls and a
  // textarea; one quiet icon is a different thing.
  // At ONE source too, not two. The gate used to be `> 1` on the reading that
  // a lone source leaves no choice to make — but "use it / don't" is a choice,
  // and it's the one a reader with a single uploaded book most wants: without
  // the picker there was no way to ask a question *without* their textbook in
  // play. The empty scope (`scopeArg = []`) was already plumbed end to end.
  const sourcePicker = (
    <SourcePicker
      scope={sources}
      dataTour="source-scope"
      open={openScope === 'sources'}
      onOpenChange={(nowOpen) => setOpenScope(nowOpen ? 'sources' : null)}
    />
  )

  // Model (v8.33.0): the researcher's model for this conversation, first of
  // the bar's pickers wherever they are (Patrick), to 📚's left — a chip
  // leading the landing row, an icon in the docked bar.
  const modelPicker = (
    <ModelPicker
      conversationKey={activeKey}
      dataTour="model-picker"
      open={openScope === 'model'}
      onOpenChange={(nowOpen) => setOpenScope(nowOpen ? 'model' : null)}
    />
  )

  // The paper filters, beside the library picker in the landing chat's tool
  // row — and only there (v8.28.0; see `activeOptions`). Its popover anchors
  // to that row (`.ask-tools` is positioned), so it spans the panel rather
  // than the button that opened it. It was two controls until v7.18.0, when
  // the "Find papers" toggle beside it was replaced by typing `@`.
  const searchControls = (
    <SearchControls
      options={searchOptions}
      onOptions={setSearchOptions}
      provider={provider}
      open={openScope === 'filters'}
      onOpenChange={(nowOpen) => setOpenScope(nowOpen ? 'filters' : null)}
    />
  )

  // Which lecture turn is expanded. **Derived, with an override** rather than
  // stored per turn: the rule is "the newest lecture is open, the ones behind
  // it are folded", which is a fact about the whole conversation and would
  // need an effect per arriving lecture to maintain as state. So the default
  // is computed here and `openByReader` holds only the turns whose state the
  // reader has actually changed — nothing to keep in sync, and a lecture that
  // arrives while they are reading an older one folds that older one without
  // touching their choice about it.
  //
  // Keyed by turn index, like `activeChatBeat`. Indices move when a failed
  // turn is dropped, so the map is cleared whenever the conversation is (see
  // `clearConversation`) rather than tracked through every mutation — a stale
  // entry would fold the wrong lecture, and the cost of being wrong here is a
  // caret the reader clicks once.
  //
  // **Kept per chat, outside the panel** (v9.0.0, Patrick): going to another
  // view remounts the panel (it is keyed on the workspace epoch), and the
  // choices lived in its state, so a lecture folded away opened again on
  // every switch. `lectureFolds` holds them for the sitting.
  const [, refold] = useState(0)
  const openByReader = lectureFolds.get(activeKey) ?? NO_FOLDS
  const newestLecture = chat.reduce(
    (latest, message, index) => (message.beats?.length ? index : latest),
    -1,
  )
  /**
   * Fold a lecture turn the reader has, or open it, and remember that.
   *
   * @param index The lecture's turn.
   */
  const toggleFold = (index: number) => {
    lectureFolds.set(activeKey, {
      ...openByReader,
      [index]: !(openByReader[index] ?? index === newestLecture),
    })
    refold((count) => count + 1)
  }

  /** Clear the conversation, and the fold choices that addressed its turns. */
  const clearConversation = () => {
    lectureFolds.delete(activeKey)
    refold((count) => count + 1)
    clearChat()
  }

  // The conversation's turns, rendered identically wherever they land — in
  // the Q&A section beside a graph, or as the whole panel without one.
  // **A turn asked beside another view links there** (v9.0.0, stage 4a). What
  // it would light (its graph's papers, its passages in the Reader) is in
  // that view, so clicking the answer, a `[n]`, a quote or a beat goes there
  // first, keeping the turn in view (`anchorTurn`), then lights it. The
  // navigation's own resets have happened by then: the highlight clears on
  // a thread switch and a graph load (`store/highlight`).
  const goLight = (index: number, tag: TurnTag, light: () => void) => {
    anchorTurn(activeKey, index)
    void dispatch(openTag({ tag, chatId: activeKey })).then(light)
  }
  const elsewhere = (message: ChatMsg, index: number) => {
    const tag = chat[index - 1]?.tag
    if (message.role !== 'assistant' || message.failed || !tag || owns(index)) return {}
    if (!explorationRecord?.threads.some((thread) => thread.id === tag.threadId)) return {}
    const beats = message.beats ?? []
    if (tag.tool === 'graph') {
      const grounded = message.cited?.length
        ? message.cited
        : [...new Set(beats.flatMap((beat) => beat.node_ids))]
      const glow = (ids: string[]) => () => dispatch(highlightSet(ids))
      return {
        active: false,
        activeBeat: null,
        onActivate: grounded.length ? () => goLight(index, tag, glow(grounded)) : undefined,
        onRefClick: (nodeId: string) => goLight(index, tag, glow([nodeId])),
        onBeatClick: beats.length
          ? (_beatIndex: number, beat: Beat) => goLight(index, tag, glow(beat.node_ids))
          : undefined,
        onBeatStep: undefined,
      }
    }
    if (tag.tool === 'reader') {
      const show = (lit: Omit<Parameters<typeof passagesLit>[0], 'threadId' | 'scroll'>) => () =>
        dispatch(passagesLit({ threadId: tag.threadId, scroll: true, ...lit }))
      return {
        active: false,
        activeBeat: null,
        onActivate: beats.length
          ? undefined
          : () => goLight(index, tag, show({ answer: index, ...answerLight(chat, index) })),
        onQuote: (quote: string) =>
          goLight(
            index,
            tag,
            show({ answer: null, passage: null, places: [], labels: [], quotes: [quote] }),
          ),
        onBeatClick: beats.length
          ? (beatIndex: number) =>
              goLight(
                index,
                tag,
                show({
                  answer: index,
                  beat: beatIndex,
                  ...beatLight(beats[beatIndex]),
                  places: [],
                  quotes: [],
                }),
              )
          : undefined,
        onBeatStep: undefined,
      }
    }
    return {}
  }

  // **Filtered by where it was asked** (v9.0.0, stage 4a): once a chat
  // crosses views, a menu over it picks one place, and only the exchanges
  // asked there show. Per chat, and forgotten on leaving it.
  const [filter, setFilter] = useState<{ chat: string; tag: string } | null>(null)
  const shownTag = filter?.chat === activeKey ? filter.tag : null
  const tagChoices = useMemo(() => {
    const seen = new Map<string, TagChoice>()
    for (const message of chat) {
      const key = tagKey(message.tag)
      if (message.role !== 'user' || seen.has(key)) continue
      const label = tagLabel(explorationRecord, message.tag)
      const split = label.lastIndexOf(' › ')
      seen.set(key, {
        key,
        label,
        paper: message.tag ? label.slice(0, split) : null,
        tool: message.tag ? TURN_TOOL_NAMES[message.tag.tool] : null,
      })
    }
    return [...seen.values()]
  }, [chat, explorationRecord])
  const shown = (index: number) => {
    if (shownTag === null || tagChoices.length < 2) return true
    const question = chat[chat[index]?.role === 'user' ? index : index - 1]
    return tagKey(question?.tag) === shownTag
  }

  const chatTurns = chat.map((message, index) => {
    if (!shown(index)) return null
    // Beside the course or the Reader, a turn is that view's: its answers
    // light passages there when they are its own (`owns`), and its own are
    // the ones it can retry or answer quickly (v9.0.0).
    if (view) {
      const lights = !!passages && owns(index)
      return (
        <ChatMessage
          key={`c${index}`}
          message={message}
          {...tags(message, index)}
          onThreadOpen={(id) => void dispatch(openChat(id))}
          // A lecture's turn is its beats (v8.50.0): nothing of its own to
          // light, so it is neither clicked nor shown lit as a whole.
          active={!message.beats?.length && lights && passages?.active === index}
          onActivate={
            passages &&
            lights &&
            message.role === 'assistant' &&
            !message.failed &&
            !message.beats?.length
              ? () => passages.onActivate(index)
              : undefined
          }
          onQuote={lights ? passages?.onQuote : undefined}
          activeBeat={
            lights && passages?.activeBeat?.answer === index ? passages.activeBeat.beat : null
          }
          beatsOpen={openByReader[index] ?? index === newestLecture}
          onToggleBeats={message.beats?.length ? () => toggleFold(index) : undefined}
          onBeatClick={
            lights && passages?.onBeat
              ? (beatIndex) => passages.onBeat?.(index, beatIndex)
              : undefined
          }
          onBeatStep={
            lights && passages?.onBeat
              ? (beatIndex, step) => passages.onBeat?.(index, beatIndex + step)
              : undefined
          }
          streaming={asking}
          working={asking && index === chat.length - 1}
          onRetry={message.failed && owns(index) ? () => retryInView(index) : undefined}
          onQuick={
            asking && index === chat.length - 1 && owns(index) && !message.beats?.length
              ? () => retryInView(index, true)
              : undefined
          }
          onPaperSeed={onPaperSeed}
          provider={viewProvider}
          onEnlarge={setLightbox}
          turn={index}
          {...elsewhere(message, index)}
        />
      )
    }
    // Clicking the bubble re-lights the answer's whole grounding set — so it's
    // only a control while at least one of those papers is actually on the
    // graph. Since the conversation now outlives the graph it was written
    // against, an older answer can cite nothing that's still loaded, and a
    // clickable bubble that highlights nothing is the same dead pointer its
    // `[n]` chips grey out for. Partial overlap still counts: lighting the
    // papers that *are* here is useful.
    //
    // A lecture turn has no `cited` — its papers live on its beats — so the
    // whole-turn set is every beat's papers, deduped. Clicking the bubble
    // lights the lecture's full scope; clicking a beat lights that beat's.
    const grounded =
      message.cited && message.cited.length > 0
        ? message.cited
        : [...new Set((message.beats ?? []).flatMap((beat) => beat.node_ids))]
    const clickable = message.role === 'assistant' && grounded.length > 0
    return (
      <ChatMessage
        key={`c${index}`}
        message={message}
        {...tags(message, index)}
        onThreadOpen={(id) => void dispatch(openChat(id))}
        active={activeChat === index}
        streaming={asking || searching}
        // Only the LAST turn can be the one being generated, so only it gets
        // the live trace treatment; every earlier turn's trace stays folded.
        working={(asking || searching) && index === chat.length - 1}
        onActivate={clickable ? () => onChatClick(index, grounded) : undefined}
        // Retried and re-asked only where it was asked (v9.0.0): a turn from
        // another view needs that view's context.
        onRetry={message.failed && owns(index) ? () => retryAnswer(index) : undefined}
        // ⚡ Quick response, on the answer still searching (v8.30.0). A
        // lecture has no tools to skip, and a direct search is not an answer.
        onQuick={
          asking && index === chat.length - 1 && owns(index) && !message.beats?.length
            ? () => quickAnswer(index)
            : undefined
        }
        onRefClick={onRefClick}
        onPaperSeed={onPaperSeed}
        provider={provider}
        onEnlarge={setLightbox}
        // A lecture answered in the chat: this turn's beats, lit one at a
        // time. `activeChatBeat` addresses a beat by turn as well as index,
        // since a conversation can hold more than one lecture.
        activeBeat={activeChatBeat?.turn === index ? activeChatBeat.beat : null}
        beatsOpen={openByReader[index] ?? index === newestLecture}
        onToggleBeats={message.beats?.length ? () => toggleFold(index) : undefined}
        onBeatClick={
          message.beats?.length
            ? (beatIndex, beat) => onChatBeatClick(index, beatIndex, beat)
            : undefined
        }
        // Only offered on a turn a *model* routed, and only while nothing
        // else is running — a reroute sends a new message, and two at once
        // would abort each other.
        onReroute={
          message.routedTo && owns(index) && !asking && !searching
            ? () => {
                followNextTurn()
                reroute(index)
              }
            : undefined
        }
        turn={index}
        {...elsewhere(message, index)}
      />
    )
  })

  // Docked, its size goes on whichever axis it docks along, and the slide
  // keyframes read it (`--panel-width` / `--panel-height`, index.css).
  const dockStyle = landing
    ? undefined
    : dock === 'bottom'
      ? ({ height: size, '--panel-height': `${size}px` } as CSSProperties)
      : ({ width: size, '--panel-width': `${size}px` } as CSSProperties)
  const title = view ? view.copy.title : hasGraph ? 'Citation Graph Assistant' : 'Ask the assistant'
  return (
    <section
      ref={sectionRef}
      className={`teacher${landing ? ' landing' : ` dock-${dock}`}${view ? ` ${view.copy.className}` : ''}${landing && chat.length === 0 ? ' empty' : ''}${drafted ? ' drafted' : ''}${collapsed && !panel.present ? ' collapsed' : ''}${panel.closing ? ' closing' : ''}${reopening ? ' reopening' : ''}`}
      data-tour="assistant-panel"
      style={dockStyle}
      onAnimationEnd={onDockAnimationEnd}
      onKeyDown={onPanelKeyDown}
    >
      {/* Nothing to resize against on the landing surface — it owns the body. */}
      {!landing && (
        <div
          className={`panel-resize-handle${dock === 'bottom' ? ' horizontal' : ''}${dragging ? ' dragging' : ''}`}
          onPointerDown={onHandlePointerDown}
          role="separator"
          aria-orientation={dock === 'bottom' ? 'horizontal' : 'vertical'}
          aria-label="Resize panel"
        />
      )}
      <div className="teacher-head">
        {/* The landing surface has no panel title and nothing to close — the
            row would be an empty strip of chrome. */}
        {!landing && (
          <div className="teacher-head-top">
            <span className="teacher-title">{title}</span>
            <div className="teacher-head-right">
              {onDockChange && (
                <button
                  type="button"
                  className="link-btn dock-flip"
                  onClick={() => moveDock(dock === 'right' ? 'bottom' : 'right')}
                  title={
                    dock === 'right'
                      ? 'Dock the assistant along the bottom'
                      : 'Dock the assistant on the right'
                  }
                  aria-label={
                    dock === 'right'
                      ? 'Dock the assistant along the bottom'
                      : 'Dock the assistant on the right'
                  }
                >
                  <DockGlyph to={dock === 'right' ? 'bottom' : 'right'} />
                </button>
              )}
              {onClose && (
                <button
                  className="link-btn"
                  onClick={onClose}
                  aria-label="Close the assistant panel"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
        {!landing && <DockChatPicker chatId={activeKey} />}
      </div>

      {/* One scroller, holding the conversation and nothing else.
          It held **sections** from v7.10.0 to v7.21.0 — a Lecture section
          above a Chat one, each behind its own caret — because the panel had
          two things in it that had to be able to coexist. Deleting the lecture
          half left one section, and a caret whose only job was folding away
          the whole point of the panel: a "CHAT" header over the chat, in a
          panel already titled "AI Teacher & Discovery" (since v8.25.0 "Citation
          Graph Assistant"), with a ✕ next to it
          that does the same job more honestly. So the sections are gone and
          the two shapes are now the same shape. The follow-the-bottom effect
          above watches this box, so a streaming answer keeps itself in view. */}
      <div className="teacher-scroll" ref={scrollRef} onScroll={onTranscriptScroll}>
        {tagChoices.length > 1 && (
          <TagFilter
            tags={tagChoices}
            value={shownTag}
            onChange={(tag) => setFilter(tag === null ? null : { chat: activeKey, tag })}
          />
        )}
        {chatTurns}
        {chat.length === 0 &&
          (view ? (
            <div className="teacher-hint">{view.copy.hint}</div>
          ) : landing ? (
            <>
              {/* Decorative — the greeting below is the content, so the
                  picture stays out of the accessibility tree. Two cuts of the
                  same painting, one per theme (teacher.css picks). */}
              <img
                className="landing-hero landing-hero-dark"
                src="/curious-astronaut-dark.webp"
                alt=""
              />
              <img
                className="landing-hero landing-hero-light"
                src="/curious-astronaut-light.webp"
                alt=""
              />
              <h1 className="landing-greeting">What do you want to explore?</h1>
            </>
          ) : hasGraph ? (
            <div className="teacher-hint">
              Ask a question about the papers on the graph — or ask for a lecture on them, on the
              references, or on a paper by name.
            </div>
          ) : (
            <div className="teacher-hint">
              Ask a question and I’ll answer straight from your uploaded sources — books, PDFs, and
              pages — citing them by page. No graph needed.
            </div>
          ))}
        {(error || searchError) && <div className="teacher-error">{error ?? searchError}</div>}
      </div>

      {/* Bar and tool row move as one thing — which is why the FLIP below
          measures this wrapper rather than the form: on the landing surface
          the whole group drops from the optical centre to the bottom on the
          first question, and a row that snapped down while the bar above it
          slid would read as two separate controls. */}
      <div className="ask-dock" ref={askRef}>
        {/* One line each, cut short with an ⓘ for the whole when the panel
            is narrow (v8.25.0, `ComposerNotes`). */}
        <ComposerNotes
          notes={[
            ...(!view && hasGraph && pickedCount > 0
              ? [
                  `Scoped to ${pickedCount} hand-picked paper${pickedCount > 1 ? 's' : ''} — lectures and answers focus on your selection, whatever the filters show (clear it on the graph to widen), unless a message names its own papers.`,
                ]
              : []),
            ...(askContextParts.length > 0
              ? [`Answers also draw on ${askContextParts.join(' · ')}.`]
              : []),
            view
              ? view.copy.context
              : hasGraph && subject?.identity
                ? `Asking about ${subject.title} · ${scopeCount} papers`
                : subject?.identity
                  ? `Asking from ${subject.title} · Search and discuss across your exploration`
                  : // A chat names itself (v8.31.0: Chats in the rail, each
                    // titled from its first question), not a fixed "General".
                    `${subject?.title ?? 'Chat'} · Search and discuss across your exploration`,
          ]}
          tip={
            view
              ? view.copy.tip
              : landing
                ? 'Type @ and press Enter to search for papers, or arrow down to attach a paper or another chat from this exploration to your question. A paper’s Open button (or Shift+Enter) opens it in a thread of its own.'
                : 'Type @ to name a paper on this graph (the answer starts from it) or to bring another chat from this exploration into your question. To find or open papers not on the graph, use a chat (Chats in the rail). The chat’s name under the title switches which chat you talk in.'
          }
        />
        {/* The passage a highlight's Chat attached (v8.26.0), over the bar. */}
        {quote && (
          <div className="course-quote" role="group" aria-label="Attached passage">
            <div className="course-quote-body">
              <p className="course-quote-text">“{quote.text.trim()}”</p>
              <p className="course-quote-from">From {quote.from}</p>
            </div>
            <button
              type="button"
              className="link-btn course-quote-clear"
              onClick={() => {
                onQuoteClear?.()
                inputRef.current?.focus()
              }}
              aria-label="Remove the attached passage"
              title="Remove the attached passage"
            >
              ✕
            </button>
          </div>
        )}
        <AttachedChips
          chips={attached.map((choice) => ({
            key: attachmentKey(choice),
            kind: choice.kind,
            title: choice.kind === 'paper' ? choice.paper.title : choice.thread.title,
          }))}
          onRemove={(key) => {
            setAttached((current) => current.filter((choice) => attachmentKey(choice) !== key))
            inputRef.current?.focus()
          }}
        />
        <form className="teacher-ask" data-tour="ask" onSubmit={onAsk}>
          {/* The `@` dropdown, anchored to the bar (which is positioned) and
              opening upward — the composer sits at the bottom of the panel, so
              a list below it would open off-screen. */}
          {mentionsPanel.present && (
            <MentionSuggestions
              threads={shownMentions.threads}
              papers={shownMentions.papers}
              search={shownMentions.search}
              highlighted={shownMentions.highlighted}
              loading={shownMentions.loading}
              step={shownMentions.step}
              onPick={pickMention}
              onSearch={searchMention}
              onOpen={landing ? openMention : undefined}
              closing={mentionsPanel.closing}
              onAnimationEnd={mentionsPanel.onAnimationEnd}
            />
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              syncComposer(event.target)
            }}
            // Clicking and arrowing move the caret without changing the text,
            // and a mention is defined relative to the caret — so the dropdown
            // has to re-read on both, or it goes on offering candidates for a
            // mention the reader has navigated out of.
            onKeyUp={(event) => syncComposer(event.currentTarget)}
            onClick={(event) => syncComposer(event.currentTarget)}
            onBlur={() => mentions.reset()}
            onKeyDown={onInputKeyDown}
            rows={1}
            placeholder={askPlaceholder}
            aria-label={
              view ? `Ask the ${view.copy.title} a question` : 'Ask the assistant a question'
            }
          />
          {/* Docked, 📚 Library rides inside the bar as one round icon beside
              🗑 (v8.28.0): the 340px panel has no room for a labelled row
              under the bar, and a row of icon-only chips there read as
              clutter. Paper filters don't come along — they belong to the
              General chat, the one that searches papers. */}
          {/* Model first, then 📚 (Patrick, v8.33.0), as in the landing row. */}
          {!landing && modelPicker}
          {!landing && sourcePicker}
          {/* Clear, inside the bar beside the send rather than floating above the
              transcript — same round shape and size, but muted rather than
              accent: it's the destructive one, and it shouldn't compete with the
              control you actually came here to press. Contextual, as it always
              was: with a lecture on screen it clears that instead of the chat,
              which the tooltip says since the icon can't. */}
          {chat.length > 0 && (
            <button
              type="button"
              className="ask-clear"
              onClick={clearConversation}
              title="Clear the chat — start a fresh conversation"
              aria-label="Clear chat"
            >
              <ClearGlyph />
            </button>
          )}
          {/* One button, two jobs. While an answer streams it shows the same
              hopping dots the lecture buttons wear — and hovering turns it into a
              stop, so the control that says "working" is also the one that ends
              it. Deliberately not disabled mid-flight: that was the old ellipsis,
              which looked inert and offered no way out of a long run. */}
          <button
            type={asking || searching ? 'button' : 'submit'}
            className={asking ? 'is-stop' : undefined}
            disabled={(!asking && (!input.trim() || (!!view && !view.available))) || searching}
            onClick={asking ? stopAsk : undefined}
            title={asking ? 'Stop generating' : undefined}
            aria-label={asking ? 'Stop generating' : 'Ask'}
          >
            {asking ? (
              <>
                <HopDots />
                <span className="stop-glyph" aria-hidden="true" />
              </>
            ) : searching ? (
              // A direct search is short and has no partial result worth
              // keeping, so it shows progress without offering a stop.
              <HopDots />
            ) : (
              <SendGlyph />
            )}
          </button>
        </form>
        {/* The landing chat's tool row: 📚 Library and ▽ Paper filters as
            labelled chips directly beneath the bar, near what they modify and
            out of the pill. There is room for the words here, and it's where
            a first-time reader meets them. Docked there is no row at all
            (v8.28.0) — 📚 moves into the bar and the filters stay behind.
            The funnel spent v7.21.0 → v8.27.0 inside the pill (Patrick,
            2026-09-14). The library picker renders nothing without a library,
            so the filters are often the row's only chip. */}
        {landing && (
          <div className="ask-tools">
            {modelPicker}
            {sourcePicker}
            {searchControls}
          </div>
        )}
      </div>

      <Lightbox figure={lightbox} onClose={() => setLightbox(null)} />
    </section>
  )
}
