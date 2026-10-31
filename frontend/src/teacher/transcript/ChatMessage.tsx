/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * One chat turn: the library-retrieval summary (graph-free mode), the
 * researcher's trace chips, the prose interleaved with its `<<FIG n>>` figures,
 * and the cited-papers footer. Clickable when the answer carries citations —
 * clicking re-lights the papers it was grounded in.
 *
 * Since v7.20.0 a turn's answer may be a **lecture** rather than prose — the
 * router sent the message to the lecturer — in which case the same `BeatList`
 * the panel's lecture section uses renders here instead, under a line naming
 * which assistant answered and offering the other.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState } from 'react'
import { PROVIDER_LABEL } from '../../api'
import type { AnswerFigure, Beat, ChatMsg, Provider, TraceEvent } from '../../api'
import MathText from '../../notation/MathText'
import FigCard from '../../figures/FigCard'
import HopDots from '../HopDots'
import { splitAnswer } from '../../figures/split'
import AnswerMarkdown from './AnswerMarkdown'
import BeatList from './BeatList'
import { provenanceLine } from './provenance'
import { describeScope } from '../../scope/resolve'
import Fold from '../../ui/Fold'
import QuickResponse from '../../ui/QuickResponse'
import AttachedChips from '../../mentions/AttachedChips'
import { splitAttached } from '../../mentions/attachments'
import ResponseTimer from '../ResponseTimer'

/**
 * Why a failed search never turned anything up, in plain words — "the budget
 * ran out" and "Semantic Scholar errored" read very differently to someone
 * watching the trace. Undefined `reason` (older saved sessions, or a passing
 * search) renders nothing extra, same as before this field existed.
 *
 * @param reason The trace's failure-reason code, when one was sent.
 * @returns The plain-words explanation, or null for nothing extra.
 */
function searchFailReason(reason: TraceEvent['reason']): string | null {
  switch (reason) {
    case 'budget_exhausted':
      return 'search budget used up'
    case 'steps_exhausted':
      return 'out of steps'
    case 'empty_query':
      return 'empty query'
    case 'error':
      return 'search failed'
    default:
      return null
  }
}

/**
 * One trace chip: a human line per researcher action, failures included.
 *
 * @returns The rendered trace line.
 */
function TraceLine({ trace }: { trace: TraceEvent }) {
  if (trace.action === 'figure')
    return (
      <div className={`trace-line ${trace.ok ? '' : 'fail'}`}>
        🖼 {trace.ok ? 'Showed' : 'Tried'} <b>{trace.label ?? `Figure ${trace.figure}`}</b>
        {trace.title ? (
          <>
            {' '}
            of <b>{trace.title}</b>
          </>
        ) : null}
      </div>
    )
  if (trace.action === 'search_sources')
    return (
      <div className={`trace-line ${trace.ok ? '' : 'fail'}`}>
        📚 {trace.ok ? 'Searched your sources' : 'Tried your sources'}
        {trace.query ? (
          <>
            {' '}
            for <b>“{trace.query}”</b>
          </>
        ) : null}
        {trace.ok && (
          <em>{trace.found ? `${trace.found} passage${trace.found > 1 ? 's' : ''}` : 'nothing'}</em>
        )}
      </div>
    )
  if (trace.action === 'search_web')
    return (
      <div className={`trace-line ${trace.ok ? '' : 'fail'}${trace.pending ? ' pending' : ''}`}>
        🌐 {trace.pending ? 'Searching the web' : trace.ok ? 'Searched the web' : 'Tried the web'}
        {trace.need ? (
          <>
            {' '}
            for <b>“{trace.need}”</b>
          </>
        ) : null}
        {trace.pending ? (
          <span className="spin trace-spin" role="img" aria-label="Searching" />
        ) : (
          trace.ok && (
            <em>{trace.found ? `${trace.found} page${trace.found > 1 ? 's' : ''}` : 'nothing'}</em>
          )
        )}
      </div>
    )
  if (trace.action === 'search') {
    // "Searching OpenAlex for …" names the corpus while it runs, then
    // "Searched OpenAlex for …" once it has. The name comes off the event,
    // never the dropdown: a turn saved under one provider and replayed under
    // the other still says where it looked. Turns from before the field
    // existed have no name to give and read as they always did.
    const corpus = trace.provider ? PROVIDER_LABEL[trace.provider] : null
    const verb = trace.pending ? 'Searching' : trace.ok ? 'Searched' : 'Tried'
    return (
      <div className={`trace-line ${trace.ok ? '' : 'fail'}${trace.pending ? ' pending' : ''}`}>
        🔎 {corpus ? `${verb} ${corpus} for` : trace.pending ? 'Searching for' : verb}{' '}
        <b>“{trace.query}”</b>
        {trace.year_from || trace.year_to ? (
          <span>
            {' '}
            ({trace.year_from ?? '…'}–{trace.year_to ?? 'now'})
          </span>
        ) : null}
        {trace.pending && <span className="spin trace-spin" role="img" aria-label="Searching" />}
        {!trace.pending && trace.ok && (
          <em>{trace.found ? `${trace.found} new` : 'nothing new'}</em>
        )}
        {!trace.ok && searchFailReason(trace.reason) && <em>{searchFailReason(trace.reason)}</em>}
      </div>
    )
  }
  if (trace.action === 'expand')
    return (
      <div className={`trace-line ${trace.ok ? '' : 'fail'}`}>
        🔗 {trace.ok ? 'Expanded' : 'Tried'} <b>{trace.relation}</b> of{' '}
        <b>{trace.title || `paper #${trace.index}`}</b>
        {trace.ok && <em>{trace.found ? `${trace.found} new` : 'nothing new'}</em>}
      </div>
    )
  return (
    <div className={`trace-line ${trace.ok ? '' : 'fail'}`}>
      📖 {trace.ok ? 'Read' : 'Tried'} <b>{trace.title || `paper #${trace.index}`}</b>
      <em>{trace.detail === 'full' ? 'full text' : 'summary'}</em>
    </div>
  )
}

/**
 * The agent's tool trace, collapsible, and self-collapsing when it finishes.
 *
 * Watching the agent work is the interesting part *while it works*; once the
 * answer is there the trace is a wall of chips above the thing the reader
 * actually came for. So it opens on its own when a run starts and folds away
 * when the run ends — and a reader who wants it back (or wants it gone early)
 * has the caret.
 *
 * **A reader's own click wins.** Once they have opened or closed it by hand,
 * the automatic collapse stops fighting them for the rest of that turn: the
 * point of the affordance is to be in control of it.
 *
 * **⚡ Quick response rides its header** (v8.30.0) while the agent is still
 * searching: the one place a reader is already looking when the wait feels
 * long, as on the lesson's step line.
 *
 * @param props Component props.
 * @param props.trace   The steps to show.
 * @param props.working This turn's agent is still running.
 * @param props.onQuick Stop searching and answer now, when that's on offer.
 * @returns The collapsible trace block.
 */
function TraceBlock({
  trace,
  working,
  onQuick,
}: {
  trace: TraceEvent[]
  working: boolean
  onQuick?: () => void
}) {
  const [open, setOpen] = useState(working)
  const chosenByReader = useRef(false)
  useEffect(() => {
    if (!chosenByReader.current) setOpen(working)
  }, [working])
  const steps = trace.length
  return (
    <div className={`chat-trace${open ? '' : ' collapsed'}`}>
      <div className="trace-head">
        <button
          type="button"
          className="trace-toggle"
          aria-expanded={open}
          onClick={(event) => {
            // The bubble itself re-lights this answer's papers; toggling the
            // trace is not that.
            event.stopPropagation()
            chosenByReader.current = true
            setOpen((prev) => !prev)
          }}
        >
          <span className={`trace-caret${open ? ' open' : ''}`} aria-hidden="true">
            ▸
          </span>
          {working ? 'Working' : `${steps} step${steps > 1 ? 's' : ''}`}
        </button>
        {working && onQuick && (
          <QuickResponse
            onClick={onQuick}
            title="Stop searching: an answer now, from what's already here and the model's own knowledge"
          />
        )}
      </div>
      <Fold open={open}>
        <div className="trace-steps">
          {trace.map((event, index) => (
            <TraceLine key={index} trace={event} />
          ))}
        </div>
      </Fold>
    </div>
  )
}

/** Between a paper's title and its tool's name in a tag (`store/chats`). */
const TAG_SEPARATOR = ' › '

/**
 * A tag's words, the paper's title giving way to a narrow bubble before the
 * tool's name does: the tool is the part that says where it was asked.
 *
 * @param props Component props.
 * @param props.label The tag's label, `General` or `<paper> › <tool>`.
 * @returns The two parts.
 */
export function TagText({ label }: { label: string }) {
  const at = label.lastIndexOf(TAG_SEPARATOR)
  if (at === -1) return <span className="chat-tag-paper">{label}</span>
  return (
    <>
      <span className="chat-tag-paper">{label.slice(0, at)}</span>
      <span className="chat-tag-tool">{label.slice(at)}</span>
    </>
  )
}

/**
 * Render one chat turn end-to-end.
 *
 * @returns The turn's bubble (retrieval line, trace chips, prose, figures).
 */
export default function ChatMessage({
  message,
  active,
  streaming,
  working,
  onActivate,
  onRetry,
  onRefClick,
  onPaperSeed,
  onThreadOpen,
  provider,
  onEnlarge,
  onQuote,
  activeBeat,
  onBeatClick,
  onBeatStep,
  onReroute,
  onQuick,
  tagLabel,
  onTagOpen,
  askInstead,
  onEdit,
  turn,
  // Defaults open: a caller that forgets to manage this shows the lecture
  // rather than silently hiding it, which is the right way round to fail.
  beatsOpen = true,
  onToggleBeats,
}: {
  message: ChatMsg
  /** This answer's cited papers are currently lit on the graph. */
  active: boolean
  /** An answer is streaming app-wide (drives the placeholder ellipsis). */
  streaming: boolean
  /** THIS turn's agent is still running — drives the trace's auto-collapse. */
  working?: boolean
  /** Re-light this answer's cited papers (undefined = not clickable). */
  onActivate?: () => void
  /** Ask this turn's question again (undefined = retry unavailable). */
  onRetry?: () => void
  /** Spotlight one paper from a clicked inline `[n]` marker. */
  onRefClick?: (nodeId: string) => void
  /** Paper ids still on the graph; a `[n]` outside it greys out. */
  /** Build a graph seeded on a cited paper (graph-free answers only). */
  onThreadOpen?: (id: string) => void
  onPaperSeed?: (nodeId: string, refProvider?: Provider) => void
  /** The selected backend, so a citation from the other one says so. */
  provider?: Provider
  onEnlarge: (figure: AnswerFigure) => void
  /** Light a ⟦quote⟧ of the paper being read (the Reader's, v8.45.0). */
  onQuote?: (quote: string) => void
  /** Which of this turn's beats is lit, when its answer is a lecture. */
  activeBeat?: number | null
  /** Light one of this turn's beats (undefined = beats render unclickable). */
  onBeatClick?: (index: number, beat: Beat) => void
  /** Step from the lit beat to the one before or after (v8.50.0, the
   *  Reader's guided read): shows Back / Next on it. */
  onBeatStep?: (index: number, step: -1 | 1) => void
  /** Send this turn's question to the other assistant — only wired when a
   *  model chose this one, so a reader's own choice carries no offer. */
  onReroute?: () => void
  /** Where this question was asked (v9.0.0): `General`, or a paper and its
   *  tool. Shown on the question; absent, nothing is. */
  tagLabel?: string
  /** Go where it was asked (undefined: the tag is plain text). */
  onTagOpen?: () => void
  /** The router placed this question elsewhere (v9.0.0, stage 4b): ask it
   *  where it was typed instead, named by `label`. */
  askInstead?: { label: string; onAsk: () => void }
  /** Edit this question and send it again in place of the exchange it
   *  began (undefined: not editable — only the chat's latest question is,
   *  so earlier history is never rewritten). Given the edited words. */
  onEdit?: (body: string) => void
  /** Its index in the chat, so the panel can find it again however the chat
   *  is filtered (`data-turn`). */
  turn?: number
  /** ⚡ Quick response: stop this working answer's search and answer now
   *  (v8.30.0). Offered only while it is still searching, before prose. */
  onQuick?: () => void
  /** The seed of the graph currently on screen, so a turn from another one can
   *  say which. Undefined graph-free, where nothing is on screen to differ. */
  /** Whether this turn's beats are expanded. */
  beatsOpen?: boolean
  /** Fold or unfold this turn's beats (undefined = not a lecture turn). */
  onToggleBeats?: () => void
}) {
  const clickable = !!onActivate
  const beats = message.beats ?? []
  // A question's `@` attachments (v8.29.0) ride on its leading `Attached:`
  // line; read them back into chips and show only the reader's own words.
  const { attached, body } =
    message.role === 'user' ? splitAttached(message.text) : { attached: [], body: message.text }
  // Editing the question in place: the draft while it is open, null shut.
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null && !!onEdit
  const resend = () => {
    const edited = draft?.trim()
    if (!edited || !onEdit) return
    setDraft(null)
    onEdit(edited)
  }
  // Focused once, as it opens, with the caret at the end ready to fix the
  // typo — never again per render, or a streaming answer would pull focus
  // back here on every token.
  const editField = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const field = editField.current
    if (!editing || !field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }, [editing])
  const borrowedId = (title: string) =>
    message.borrowedThreads?.find((thread) => thread.title === title)?.id
  const lectureHeader =
    message.role === 'assistant' && (message.routedTo === 'lecture' || beats.length > 0)
  const quickHeader = message.role === 'assistant' && !!message.quickResponse
  const metadata = (
    <>
      {(() => {
        // What the turn was scoped to, when that was anything other than
        // "what you were looking at": the message's ask ("the references,
        // 2010–2019 · 12 papers") or the hand-picked selection. The one
        // place the priority list is visible in the transcript, so a reader
        // can tell why an answer covered what it did — and why a filtered-out
        // paper turned up anyway.
        const scoped = message.scope ? describeScope(message.scope) : null
        return scoped ? <div className="chat-scoped">Scoped to {scoped}</div> : null
      })()}
      {message.routedTo && (
        // Which assistant answered, and the offer of the other. This line is
        // what makes routing by model acceptable at all: a misroute costs one
        // click rather than a wrong answer the reader has to notice and work
        // around. It is absent when the reader chose the destination
        // themselves, because there is then nothing to second-guess.
        <div className="chat-routed">
          <span>
            {message.routedTo === 'lecture' ? 'Answered as a lecture' : 'Answered as a question'}
          </span>
          {onReroute && (
            <button
              type="button"
              className="chat-reroute"
              onClick={(event) => {
                event.stopPropagation()
                onReroute()
              }}
              title={
                message.routedTo === 'lecture'
                  ? 'Ask this as a question instead'
                  : 'Ask for a lecture on this instead'
              }
            >
              {message.routedTo === 'lecture' ? 'Answer it instead' : 'Lecture on it instead'}
            </button>
          )}
        </div>
      )}
    </>
  )
  const timer =
    message.role === 'assistant' ? (
      <ResponseTimer
        startedAt={message.startedAt}
        respondedIn={message.respondedIn}
        running={!!working}
      />
    ) : null
  return (
    <div
      className={`chat ${message.role}${clickable ? ' clickable' : ''}${active ? ' active' : ''}`}
      data-turn={turn}
      onClick={onActivate}
    >
      {lectureHeader || quickHeader ? (
        <div className="chat-lecture-header">
          <div className="chat-lecture-meta">
            {quickHeader ? (
              <span
                className="chat-quick-response"
                title="Answered from the model's own knowledge."
              >
                <svg
                  className="quick-bolt"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2L13.5 2Z" />
                </svg>
                Quick response
              </span>
            ) : (
              metadata
            )}
          </div>
          {timer}
        </div>
      ) : (
        timer
      )}
      {tagLabel &&
        (onTagOpen ? (
          <button
            type="button"
            className="chat-tag"
            onClick={(event) => {
              event.stopPropagation()
              onTagOpen()
            }}
            title={`Asked from ${tagLabel}: go there`}
            aria-label={tagLabel}
          >
            <TagText label={tagLabel} />
          </button>
        ) : (
          <span className="chat-tag" title={tagLabel}>
            <TagText label={tagLabel} />
          </span>
        ))}
      {tagLabel && askInstead && (
        // The router's choice of place is visible and correctable, as its
        // choice of lecture or answer is: one click asks it where it was
        // typed, beside the answer it got where it was placed.
        <button
          type="button"
          className="chat-tag-instead"
          onClick={(event) => {
            event.stopPropagation()
            askInstead.onAsk()
          }}
          title={`Nova took this to be about where its tag says; ask it from ${askInstead.label} instead`}
        >
          Ask from {askInstead.label} instead
        </button>
      )}
      <AttachedChips
        chips={attached.map((item, index) => {
          const threadId = item.kind === 'thread' ? borrowedId(item.title) : undefined
          return {
            key: `${item.kind}:${index}`,
            kind: item.kind,
            title: item.title,
            onOpen: threadId && onThreadOpen ? () => onThreadOpen(threadId) : undefined,
          }
        })}
      />
      {/* The chips above already name (and open) the chats a question
          attached; this line stays for turns from before them. */}
      {!!message.borrowedThreads?.length && attached.length === 0 && (
        <div className="chat-borrowed">
          Context from{' '}
          {message.borrowedThreads.map((thread) =>
            onThreadOpen ? (
              <button
                type="button"
                key={thread.id}
                onClick={(event) => {
                  event.stopPropagation()
                  onThreadOpen(thread.id)
                }}
              >
                {thread.title}
              </button>
            ) : (
              <span key={thread.id}>{thread.title}</span>
            ),
          )}
        </div>
      )}
      {/* Library-chat retrieval summary (graph-free mode). */}
      {message.retrieve && (
        <div className="chat-trace">
          <div className={`trace-line ${message.retrieve.found ? '' : 'fail'}`}>
            📚 Searched your library
            <em>
              {message.retrieve.found
                ? `${message.retrieve.found} passage${message.retrieve.found > 1 ? 's' : ''}`
                : 'nothing'}
            </em>
            {message.retrieve.sources.length > 0 && (
              <span className="trace-srcs"> from {message.retrieve.sources.join(', ')}</span>
            )}
          </div>
        </div>
      )}
      {message.trace && message.trace.length > 0 && (
        <TraceBlock
          trace={message.trace}
          working={!!working}
          onQuick={!body ? onQuick : undefined}
        />
      )}
      {message.failed && !message.text && (
        <div className="chat-failed" role="status">
          <span className="chat-failed-msg">⚠ {message.failed}</span>
          {onRetry && (
            <button
              type="button"
              className="chat-retry"
              onClick={(event) => {
                event.stopPropagation()
                onRetry()
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {(!lectureHeader || quickHeader) && metadata}
      {beats.length > 0 && (
        // A lecture delivered as this answer, behind its own caret. Twelve
        // beats are fine as the newest thing on screen and unusable as the
        // third lecture you have scrolled past — and the Lecture section that
        // could once fold them away is gone (v7.21.0), so the turn folds
        // itself. Which one is open is decided by the caller: the newest
        // lecture, until the reader says otherwise.
        <div className="chat-beats" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`beats-toggle${beatsOpen ? ' open' : ''}`}
            onClick={onToggleBeats}
            aria-expanded={!!beatsOpen}
            title={beatsOpen ? 'Fold this lecture away' : 'Show this lecture'}
          >
            <span className="beats-caret" aria-hidden="true">
              ▸
            </span>
            {beats.length} beat{beats.length > 1 ? 's' : ''}
          </button>
          {/* Kept mounted rather than unmounted: a folded lecture keeps its
              beats' figures loaded, so unfolding it is instant rather than a
              flash of re-fetched images. */}
          <Fold open={!!beatsOpen} keepMounted>
            <BeatList
              beats={beats}
              activeBeat={activeBeat ?? null}
              sourceRefs={message.sourceRefs}
              onBeatClick={(index, beat) => onBeatClick?.(index, beat)}
              onStep={onBeatStep}
              onRefClick={onRefClick}
              onEnlarge={onEnlarge}
            />
          </Fold>
        </div>
      )}
      {editing ? (
        <form
          className="chat-edit"
          onClick={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault()
            resend()
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            // As the ask bar: Enter sends, Shift+Enter is a new line, and
            // Esc puts the question back as it was.
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                resend()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setDraft(null)
              }
            }}
            ref={editField}
            rows={Math.min(8, Math.max(2, (draft ?? '').split('\n').length))}
            spellCheck
            autoCorrect="on"
            aria-label="Edit your question"
          />
          <div className="chat-edit-actions">
            <button type="button" className="chat-retry" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="chat-retry chat-resend"
              disabled={!draft?.trim()}
              title="Send the edited question in place of this one and its answer"
            >
              Resend
            </button>
          </div>
        </form>
      ) : (
        (() => {
          if (!body) {
            // Waiting on the first token, with nothing else yet to show. The
            // same hopping dots the send button and a generating lecture use —
            // one "working" rhythm across the panel, rather than a static `…`
            // here and a cascade everywhere else.
            return message.role === 'assistant' &&
              streaming &&
              !message.failed &&
              !message.trace?.length &&
              !message.retrieve &&
              beats.length === 0 ? (
              <HopDots label="Thinking" />
            ) : (
              ''
            )
          }
          // Interleave the prose with the figures the agent placed via
          // <<FIG n>> markers; unplaced figures fall back to the end.
          const { parts, leftover } = splitAnswer(body, message.figures)
          return (
            <>
              {parts.map((part, index) =>
                typeof part === 'string' ? (
                  message.role === 'assistant' ? (
                    // Agent prose: full Markdown + math + clickable [n] citations.
                    <AnswerMarkdown
                      key={index}
                      text={part}
                      graphRefs={message.graphRefs}
                      sourceRefs={message.sourceRefs}
                      paperRefs={message.paperRefs}
                      onRefClick={onRefClick}
                      onPaperSeed={onPaperSeed}
                      provider={provider}
                      onQuote={onQuote}
                    />
                  ) : (
                    // The user's own question — plain text, math typeset, no Markdown.
                    <span key={index}>
                      <MathText>{part}</MathText>
                    </span>
                  )
                ) : (
                  <div key={index} className="chat-figs chat-figs-inline">
                    <FigCard figure={part} onEnlarge={onEnlarge} />
                  </div>
                ),
              )}
              {leftover.length > 0 && (
                <div className="chat-figs">
                  {leftover.map((figure, index) => (
                    <FigCard key={index} figure={figure} onEnlarge={onEnlarge} />
                  ))}
                </div>
              )}
            </>
          )
        })()
      )}
      {onEdit && !editing && (
        <button
          type="button"
          className="chat-edit-open"
          onClick={(event) => {
            event.stopPropagation()
            setDraft(body)
          }}
          title="Edit this question and send it again (replaces its answer)"
          aria-label="Edit question"
        >
          ✎
        </button>
      )}
      {(() => {
        // The grounding line replaces the old cited-papers footer: same job,
        // but it counts what the answer actually cited (sources included) and
        // is honest when nothing grounded it. Old saves have no provenance —
        // fall back to the footer they were rendered with.
        // A lecture has no `provenance` — the backend's record counts tool
        // calls, and a lecture makes none. Its own grounding line comes from
        // the scope it narrated, which is the honest equivalent: an answer
        // says what it cited, a lecture says what it covered. The two use the
        // same class so they read alike.
        if (beats.length > 0) {
          return message.graph ? (
            <div className="chat-cited">narrated {message.graph.nodes} papers ✦</div>
          ) : null
        }
        if (!message.provenance) {
          return message.cited && message.cited.length > 0 ? (
            <div className="chat-cited">grounded in {message.cited.length} paper(s) ✦</div>
          ) : null
        }
        const line = provenanceLine(message.provenance)
        return line ? <div className="chat-cited">{line} ✦</div> : null
      })()}
    </div>
  )
}
