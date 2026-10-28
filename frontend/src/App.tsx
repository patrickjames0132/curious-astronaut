/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Curious Astronaut — the shell. Composes the header, the drawers, and the body; owns only
 * what it alone renders: drawer visibility, the seed-search instance (its
 * three render sites — the header form, the hit-list overlay, the submit
 * routing — all live here), and the loading/error overlays.
 *
 * **The body has three states, and the seams matter.** In General (no seed)
 * the assistant is the landing surface (a centred chat, the app's front door)
 * and the overlays get their own layer over the body. A paper thread shows
 * either its **card home** (`tools/ToolCards`) or the tool a card opened.
 * Since v9.0.0 (the OnePager's "One assistant", stage 3) **one assistant**
 * docks beside every view, against the right edge or the bottom, or waits
 * behind a floating 🎓 when closed; each view lends it its words and how it
 * asks (`assistant/views`). The `Teacher` element stays at one position in
 * the tree across all of it.
 * Thread navigation remounts the graph and chat with distinct keys; their
 * durable state lives in the store.
 *
 * Everything cross-cutting lives in the store (see `store/README.md`):
 * the workspace (graph + discoveries + layout), the transcript, and the
 * highlight ids. The old shell's transcript-duplicating refs and remount
 * plumbing died with that move — Save reads the store, not a hoisted copy.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSettings } from './api'
import { getBuildShape, sameBuild, useBuildShape } from './graph/buildShape'
import { applyConfiguredDefault, setTheme, useTheme } from './ui/theme'
import { useAppDispatch, useAppSelector } from './store'
import { errorSet, loadGraph, openTool, providerSet, switchProvider } from './store/workspace'
import { threadTool, type ThreadTool } from './store/explorations'
import SideBar from './shell/SideBar'
import { useExplorations } from './shell/useExplorations'
import './shell/shell.css'

/** localStorage key remembering whether the left rail is expanded. */
const RAIL_KEY = 'ca.railOpen'
/** localStorage key remembering whether the docked assistant is open. */
const ASSISTANT_KEY = 'ca.assistantOpen'
/** Which edge the assistant docks against (v9.0.0), remembered. */
const DOCK_KEY = 'ca.assistantDock'
/** The way-back pill's words, by the tool it returns to: the Reader (from a
 *  lesson its notes opened, v8.44.0) or Peer Reviews (from a citing paper it
 *  showed in the Citation Graph). Both reopen where the reader left off. */
const RETURN_PILLS: Partial<Record<ThreadTool, { label: string; title: string }>> = {
  reader: { label: 'Back to reading', title: 'Back to where you were in the paper' },
  reviews: { label: 'Back to Peer Reviews', title: 'Back to where you were in the Peer Reviews' },
}
import GraphExplorer from './graph/GraphExplorer'
import Teacher, { type AssistantDock } from './teacher/Teacher'
import AssistantLauncher from './assistant/AssistantLauncher'
import { KEEP_CHAT_EVENT } from './assistant/keepChatInView'
import Sources from './library/Sources'
import SettingsModal from './settings/SettingsModal'
import Tour from './tour/Tour'
import {
  CARDS_TOUR,
  GRAPH_TOUR,
  HOME_TOUR,
  KNOWLEDGE_TOUR,
  READER_TOUR,
  REVIEWS_TOUR,
  TOUR_KEYS,
} from './tour/steps'
import ToolCards from './tools/ToolCards'
import Reader from './reader/Reader'
import PeerReviews from './reviews/PeerReviews'
import KnowledgeNetwork from './knowledge/KnowledgeNetwork'
import { FigureLayerContext } from './figures/figureLayer'
import type { PassageQuote } from './assistant/askAssistant'
import { lessonSource } from './knowledge/assistant/askCourse'
import './app.css'

/**
 * Render the app shell: header, drawers, and the graph area with its overlays.
 *
 * @returns The whole application tree.
 */
export default function App() {
  const dispatch = useAppDispatch()
  // Which conversation is on screen, and which explorations still have a
  // stream running (the rail marks those as working).
  const { graph, epoch, loading, buildProgress, error, provider, seedRef, openRequestId } =
    useAppSelector((state) => state.workspace)
  // The thread on screen, and which of its surfaces is up: null in General
  // (no seed, so no cards), else its card home or the tool a card opened.
  const activeThread = useAppSelector((state) => {
    const record = state.explorations.byId[state.explorations.activeId]
    return record?.threads.find((thread) => thread.id === record.activeThreadId)
  })
  const tool = threadTool(activeThread)
  const paperThread = tool !== null
  const showGraph = !!graph && tool === 'graph'

  // Moving between a paper's cards and one of its tools reads as a scroll:
  // the cards come down from above, a tool comes up from below. Only within
  // one thread — arriving at a thread from the rail keeps its plain fade.
  // Derived during render (the previous surface held in state), so the class
  // is on the very first frame of the new surface.
  const [lastSurface, setLastSurface] = useState({ threadId: activeThread?.id, tool })
  const [scroll, setScroll] = useState<'up' | 'down' | null>(null)
  if (lastSurface.threadId !== activeThread?.id || lastSurface.tool !== tool) {
    const sameThread = lastSurface.threadId === activeThread?.id
    setLastSurface({ threadId: activeThread?.id, tool })
    setScroll(sameThread && lastSurface.tool && tool ? (tool === 'cards' ? 'up' : 'down') : null)
  }

  // Modal visibility + the assistant toggle — shell-local UI. Both modals sit
  // over a workspace that stays MOUNTED — the graph and the conversation are
  // expensive, live state, and a visit to either is a detour, not a teardown
  // (the same reasoning that keeps Teacher at one tree position).
  const [showLibrary, setShowLibrary] = useState(false)
  // The rail's expanded/collapsed state, remembered — it's a workspace
  // preference, not a per-visit one.
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== '0')
  const [showSettings, setShowSettings] = useState(false)
  const theme = useTheme()
  // Whether the assistant docks open beside a paper's view: one for every
  // view since v9.0.0, where each tool kept its own (the Citation Graph's,
  // v8.25.0's course, v8.38.0's Reader).
  // **Closed by default, and remembered** like the rail (Patrick, 2026-10-09:
  // it should stay hidden until asked for — a docked chat beside a canvas is
  // clutter until it is wanted). Closed, the floating 🎓 opens it, and so do
  // the highlight menus' Explain and Chat, and the full-screen chat taking
  // the reader to a paper (`assistant/keepChatInView`). A chat is unaffected: there the
  // assistant is the landing surface and never collapses.
  const [assistantOpen, setAssistantOpen] = useState(
    () => localStorage.getItem(ASSISTANT_KEY) === '1',
  )
  // Which edge it docks against (v9.0.0): right, or the bottom, which the
  // graph, the course and the paper (all wider than tall) give up less to.
  const [dock, setDock] = useState<AssistantDock>(() =>
    localStorage.getItem(DOCK_KEY) === 'bottom' ? 'bottom' : 'right',
  )
  // A passage a highlight's Chat attached to the bar (v8.26.0: a lesson's;
  // v8.38.0: the Reader's), for the thread it came from; `seq` tells a repeat
  // of the same passage from nothing new, so the bar takes focus again.
  const [quote, setQuote] = useState<(PassageQuote & { threadId: string; seq: number }) | null>(
    null,
  )
  // Where enlarged figures go: the middle of the shell, never the side panels
  // (v8.38.0, figures/figureLayer). The element is set by the layer's ref.
  const [figureLayer, setFigureLayer] = useState<HTMLElement | null>(null)
  // Latest graph, readable from the mount-only effect below without making it
  // a dependency (that would re-fire the settings fetch on every graph load).
  const graphRef = useRef(graph)
  graphRef.current = graph

  // The build shape as it was when the settings modal opened. The modal's shape
  // rows write through immediately (they're browser state, not config draft), so
  // this snapshot is the only way to tell on close whether the graph on screen
  // was built the way the user now wants it built.
  const shapeOnOpen = useRef(getBuildShape())
  useEffect(() => {
    if (showSettings) shapeOnOpen.current = getBuildShape()
  }, [showSettings])

  /**
   * Rebuild the current graph when the settings modal changed how it'd be built.
   *
   * Runs on *close*, which is right for the band-shape number inputs: they
   * write on every character, and rebuilding per keystroke would hammer the
   * provider. The `adaptive` switch is handled separately below — one click is
   * a complete intent, so it shouldn't wait for the modal to close.
   *
   * No `refresh` flag either way: a changed shape is part of the cache key, so
   * it misses the old snapshot on its own, and switching back is a cache hit.
   */
  const rebuildIfShapeChanged = useCallback(() => {
    // Only a graph on screen is rebuilt; a thread on its cards builds fresh,
    // with the new shape, whenever its graph card is opened.
    if (!graph || !seedRef || sameBuild(shapeOnOpen.current, getBuildShape())) return
    dispatch(loadGraph({ seed: seedRef }))
    shapeOnOpen.current = getBuildShape()
  }, [dispatch, graph, seedRef])

  // The adaptive switch rebuilds immediately. Watched here rather than wired
  // through the modal so the modal stays a settings editor that knows nothing
  // about the graph — it just writes the store, and this notices.
  const { adaptive } = useBuildShape()
  const previousAdaptive = useRef(adaptive)
  useEffect(() => {
    if (previousAdaptive.current === adaptive) return // mount, or an unrelated edit
    previousAdaptive.current = adaptive
    // Keep the close-time comparison honest: this rebuild already applied the
    // switch, so closing the modal mustn't rebuild a second time for it.
    shapeOnOpen.current = getBuildShape()
    if (seedRef && graphRef.current) dispatch(loadGraph({ seed: seedRef }))
  }, [adaptive, seedRef, dispatch])

  // Seed browser-level defaults from config: the header's data-source
  // selector and (for a browser with no saved choice) the colour theme. The
  // store's initial value is a placeholder — the honest default lives in
  // config (`providers.default_provider`, editable in the settings modal),
  // and without this the setting would be inert: the dropdown always started
  // on 's2' and the frontend names a provider on every request, so the
  // backend's own fallback never fired either. Only applied before anything
  // is loaded, so it can't yank a restored session onto another provider.
  useEffect(() => {
    let cancelled = false
    void getSettings()
      .then((settings) => {
        if (cancelled) return
        const configured = settings.config.providers.default_provider
        if (!graphRef.current && configured) dispatch(providerSet(configured))
        // Only fills a browser that has never chosen a theme — see the store.
        applyConfiguredDefault(settings.config.ui.default_theme)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  // The assistant stays as the reader left it across thread and exploration
  // switches. Until v8.14.0 every switch (each bumps the epoch) re-opened a
  // collapsed panel, so clicking a thread in the rail kept popping it back
  // open (Patrick, 2026-10-09). It opens only on its own button or a tour stop.

  // The guided tour, in six phases keyed by what's on screen: the HOME
  // tour (the search surface) auto-runs once on first launch, the CARDS tour
  // on the first card home, the GRAPH tour (the graph tools) on the first
  // graph, the KNOWLEDGE tour on the first course, the READER tour on the
  // first paper read, the REVIEWS tour on the first Peer Reviews. Each phase auto-runs once ever (its own localStorage flag); the
  // header's "?" re-runs the current phase any time.
  const hasGraph = showGraph && graph.nodes.length > 0
  const tourPhase = hasGraph
    ? 'graph'
    : tool === 'cards'
      ? 'cards'
      : tool === 'knowledge'
        ? 'knowledge'
        : tool === 'reader'
          ? 'reader'
          : tool === 'reviews'
            ? 'reviews'
            : 'home'
  const tourSteps = {
    graph: GRAPH_TOUR,
    cards: CARDS_TOUR,
    knowledge: KNOWLEDGE_TOUR,
    reader: READER_TOUR,
    reviews: REVIEWS_TOUR,
    home: HOME_TOUR,
  }[tourPhase]
  const [tourOpen, setTourOpen] = useState(false)
  const [tourStage, setTourStage] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!localStorage.getItem(TOUR_KEYS[tourPhase])) setTourOpen(true)
  }, [tourPhase])
  const closeTour = useCallback(() => {
    // Done, Skip, ✕, and Esc all count as "seen" — the auto-run never nags
    // twice; a re-run is a deliberate "?" click. Drawers a step staged open
    // are put away (the assistant panel stays — it invites use).
    localStorage.setItem(TOUR_KEYS[tourPhase], '1')
    setShowLibrary(false)
    setTourStage(undefined)
    setTourOpen(false)
  }, [tourPhase])
  /** Stage what a tour step asks for: open the named drawer/panel; a step
   *  wanting nothing (undefined) puts the drawers away as the walk moves on.
   *  The assistant only ever opens — collapsing it mid-walk would hide the
   *  graph tour's own ask stops. 'details' and 'controls' pass through to
   *  GraphExplorer (via tourStage), which selects the seed when nothing is /
   *  expands a collapsed controls panel. 'assistant' used to reach Teacher
   *  too, through a `stagedOpen` prop that unfolded its folded Lecture
   *  section; the panel has no sections left to unfold (v7.21.0), so opening
   *  it is the whole job. */
  const onTourStage = useCallback((stage?: string) => {
    setTourStage(stage)
    setShowLibrary(stage === 'library')
    if (stage === 'assistant' || stage === 'course-assistant') setAssistantOpen(true)
  }, [])

  useEffect(() => {
    localStorage.setItem(RAIL_KEY, railOpen ? '1' : '0')
  }, [railOpen])
  useEffect(() => {
    localStorage.setItem(ASSISTANT_KEY, assistantOpen ? '1' : '0')
  }, [assistantOpen])
  useEffect(() => {
    localStorage.setItem(DOCK_KEY, dock)
  }, [dock])
  // The full-screen chat taking the reader to a paper opens the dock there,
  // so the conversation stays in view (`assistant/keepChatInView`).
  useEffect(() => {
    const open = () => setAssistantOpen(true)
    window.addEventListener(KEEP_CHAT_EVENT, open)
    return () => window.removeEventListener(KEEP_CHAT_EVENT, open)
  }, [])

  // The saved-graph list in the rail, and which of them is on screen. The id
  // is tracked here rather than in the store because it is a fact about this
  // *session of use* — which row to mark, and which one a re-save overwrites
  // — not about the graph itself.
  const {
    sessions,
    activeId: openSessionId,
    open: openExploration,
    create: goHome,
    rename: renameSessionRow,
    resummarize: resummarizeSessionRow,
    remove: removeSessionRow,
    working: workingSessionIds,
  } = useExplorations()

  // The floating layer over whichever surface is up — search hits, the build
  // progress, the error. Built once here rather than inline so the graph and
  // landing branches below can't drift apart. (The old "Search for a paper…"
  // hint is gone: the landing chat says what to do by being a chat.)
  // The way back to the tool a lesson was opened from (v8.44.0).
  const returnTo = activeThread?.returnTo
  const overlays = (
    <>
      {/* The 🎓 that opens the assistant while it is closed (v9.0.0): one
          for every view, in the view's own layer, top-right of its canvas.
          Not over the body: the graphs' detail panels are siblings of their
          canvas, and a body-anchored 🎓 sat on their ✕ and options
          (Patrick, as it did once before). */}
      {paperThread && !assistantOpen && <AssistantLauncher onOpen={() => setAssistantOpen(true)} />}
      {/* Dim whatever is behind — a graph mid-re-seed, or the chat you were
          reading. The card alone was only ever legible against an empty canvas;
          over live content it has to push that content back to read at all. */}
      {/* The way back from a tool to its paper's cards. Rendered for the tool
          rather than the graph, so a build that failed still has an exit. */}
      {/* Not over the Reader or Peer Reviews: their pages scroll, so they
          draw their own (`tools/ScrollNav`), the ↑ at the top and Back to
          top below it (Patrick: a lone ↑ floating over a scrolled page read
          as "back to the top"). */}
      {paperThread && tool !== 'cards' && tool !== 'reader' && tool !== 'reviews' && (
        <div className="tool-nav">
          {/* Where a tool was opened from another for one thing (a concept's
              lesson from the Reader, a citing paper from Peer Reviews), the
              way back takes the ↑'s place (v8.44.0, Patrick: the two side by
              side looked like a pair): one click to the same place, which
              that tool keeps, and its own ↑ leads to the cards. */}
          {returnTo && tool === returnTo.from ? (
            <button
              type="button"
              className="tool-return"
              data-tour="tool-return"
              data-return={returnTo.tool}
              onClick={() => void dispatch(openTool(returnTo.tool))}
              title={RETURN_PILLS[returnTo.tool]?.title ?? 'Back to where you were'}
              aria-label={RETURN_PILLS[returnTo.tool]?.label ?? 'Back'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M6 4 2.5 7.5 6 11M3 7.5h6.5a4 4 0 0 1 0 8H8"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="tool-return-label">
                {RETURN_PILLS[returnTo.tool]?.label ?? 'Back'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="tool-back"
              data-tour="tool-back"
              onClick={() => void dispatch(openTool('cards'))}
              title={`Back up to the cards for ${activeThread?.title ?? 'this paper'}`}
              aria-label="Back to this paper’s cards"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      )}
      {(loading || openRequestId || error) && <div className="canvas-scrim" />}
      {openRequestId && !loading && (
        <div className="overlay overlay-card">
          <div className="overlay-loading">
            <span className="spin" /> Opening paper…
          </div>
        </div>
      )}
      {loading && (
        <div className="overlay overlay-card">
          <div className="overlay-loading">
            <span className="spin" /> {buildProgress?.label ?? 'Building graph…'}
          </div>
          {buildProgress && (
            <div
              className="build-progress"
              role="progressbar"
              aria-valuenow={buildProgress.done}
              aria-valuemin={0}
              aria-valuemax={buildProgress.total}
            >
              <div
                className="build-progress-fill"
                style={{
                  width: `${Math.round((buildProgress.done / buildProgress.total) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="overlay error overlay-card">
          {error}
          {/* A build failure used to be a dead end: the card and its scrim sat
              over the page with nothing to dismiss them, so the only way back
              was to start another build. */}
          <button
            type="button"
            className="overlay-close"
            onClick={() => dispatch(errorSet(null))}
            aria-label="Dismiss"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
    </>
  )

  return (
    <div className="shell-root">
      <SideBar
        open={railOpen}
        onToggle={() => setRailOpen((prev) => !prev)}
        onOpenLibrary={() => setShowLibrary(true)}
        onNewGraph={goHome}
        sessions={sessions}
        openSessionId={openSessionId}
        workingSessionIds={workingSessionIds}
        onOpenSession={(id) => {
          void openExploration(id)
        }}
        onRenameSession={(id, name) => void renameSessionRow(id, name)}
        onResummarizeSession={(id) => void resummarizeSessionRow(id).catch(() => {})}
        onDeleteSession={(id) => void removeSessionRow(id)}
        onOpenSettings={() => setShowSettings(true)}
        onStartTour={() => setTourOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        provider={provider}
        onProviderChange={(next) => dispatch(switchProvider(next))}
        loadingGraph={loading}
      />

      <div className="shell-main">
        {tourOpen && <Tour steps={tourSteps} onClose={closeTour} onStage={onTourStage} />}

        <SettingsModal
          open={showSettings}
          onClose={() => {
            setShowSettings(false)
            rebuildIfShapeChanged()
          }}
        />

        <Sources open={showLibrary} onClose={() => setShowLibrary(false)} />

        <FigureLayerContext.Provider value={figureLayer}>
          <div className={`shell-body${paperThread && dock === 'bottom' ? ' dock-bottom' : ''}`}>
            {/* The overlays belong to whichever surface is up: over the canvas in
              graph mode, over the card home, over the landing chat in General.
              A graph tool still building has nothing to draw yet, so the
              overlays get an empty pane of their own. */}
            {paperThread ? (
              <div
                key={`surface:${activeThread?.id}:${tool}`}
                className={`tool-surface${scroll ? ` scroll-${scroll}` : ''}`}
                // Played once: a surface that later swaps its own content (a
                // graph arriving after its build) mustn't scroll in again.
                onAnimationEnd={(event) => {
                  if (event.target === event.currentTarget) setScroll(null)
                }}
              >
                {showGraph ? (
                  <GraphExplorer
                    key={`graph:${epoch}`}
                    tourStage={tourOpen ? tourStage : undefined}
                  >
                    {overlays}
                  </GraphExplorer>
                ) : tool === 'cards' && activeThread ? (
                  <ToolCards
                    key={`cards:${epoch}`}
                    thread={activeThread}
                    onOpen={(next) => void dispatch(openTool(next))}
                  >
                    {overlays}
                  </ToolCards>
                ) : tool === 'knowledge' && activeThread ? (
                  <KnowledgeNetwork
                    key={`knowledge:${epoch}`}
                    thread={activeThread}
                    onAssistant={(lesson) => {
                      setAssistantOpen(true)
                      if (lesson)
                        setQuote({
                          text: lesson.text,
                          from: lessonSource(lesson.lesson),
                          threadId: activeThread.id,
                          seq: Date.now(),
                        })
                    }}
                  >
                    {overlays}
                  </KnowledgeNetwork>
                ) : tool === 'reader' && activeThread ? (
                  <Reader
                    key={`reader:${epoch}`}
                    thread={activeThread}
                    onAssistant={(passage) => {
                      setAssistantOpen(true)
                      if (passage)
                        setQuote({ ...passage, threadId: activeThread.id, seq: Date.now() })
                    }}
                  >
                    {overlays}
                  </Reader>
                ) : tool === 'reviews' && activeThread ? (
                  <PeerReviews key={`reviews:${epoch}`} thread={activeThread}>
                    {overlays}
                  </PeerReviews>
                ) : (
                  <div className="tool-pending">{overlays}</div>
                )}
                {/* Enlarged figures, over the tool alone. */}
                <div className="figure-layer" ref={setFigureLayer} />
              </div>
            ) : (
              <div className="landing-overlays">{overlays}</div>
            )}

            {/* Graph and chat have distinct sibling keys. Both remount on thread
              navigation while their durable state stays with the thread. */}
            {/* One assistant for every view (v9.0.0): the landing chat with
                no paper open, else docked beside the paper's view (right or
                bottom) and closable to the floating 🎓. */}
            <Teacher
              key={`teacher:${epoch}`}
              landing={!paperThread}
              collapsed={paperThread && !assistantOpen}
              onClose={paperThread ? () => setAssistantOpen(false) : undefined}
              dock={dock}
              onDockChange={setDock}
              quote={quote?.threadId === activeThread?.id ? quote : null}
              onQuoteClear={() => setQuote(null)}
            />
            {/* In General the chat is the middle: enlarged figures cover it,
              not the rail. */}
            {!paperThread && <div className="figure-layer" ref={setFigureLayer} />}
          </div>
        </FigureLayerContext.Provider>
      </div>
    </div>
  )
}
