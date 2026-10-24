/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A tool's docked assistant: a chat beside the tool, as the Citation Graph's
 * (`teacher/Teacher`) docks beside its graph, answering through the
 * researcher over what the tool shows. The Knowledge Graph's (v8.25.0,
 * `knowledge/assistant/CourseAssistant`) and the Reader's (v8.38.0,
 * `reader/ReaderAssistant`) are this one panel with different words and a
 * different `ask`: generalized from the Knowledge Graph's when the Reader
 * needed the same thing.
 *
 * **Its own chat, not the thread's.** Assistants are encapsulated per tool
 * (Patrick, 2026-10-09), so each writes to the thread's side chat for its
 * tool (`store/chats`), and the `@` list offers the exploration's other
 * chats, this thread's other tools' among them.
 *
 * Deliberately smaller than Teacher: no landing shape, no lecture routing,
 * no paper filters or paper lookups. It shares Teacher's 📚 source picker
 * and the notes over the bar (`teacher/SourcePicker`, `ComposerNotes`), and
 * Teacher's styles and transcript rendering, so they read as one assistant
 * in several places. A highlighted passage's **Chat** (v8.26.0) attaches it
 * to the bar as a quote, above the text, and the reader's question goes with
 * it. Like Teacher it stays mounted while collapsed, so a remount never drops
 * a half-typed question.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnimationEvent, CSSProperties, FormEvent, KeyboardEvent } from 'react'
import type { AnswerFigure } from '../api'
import Lightbox from '../figures/Lightbox'
import MentionSuggestions from '../mentions/MentionSuggestions'
import { type MentionChoice } from '../mentions/parse'
import AttachedChips from '../mentions/AttachedChips'
import {
  attachedMessage,
  attachmentKey,
  withAttachment,
  withoutMention,
} from '../mentions/attachments'
import { useMentionSuggestions } from '../mentions/useMentionSuggestions'
import { useAppDispatch, useAppSelector, type AppDispatch, type RootState } from '../store'
import { chatKey, explorationChats } from '../store/chats'
import { failedTurnDropped } from '../store/transcript'
import type { ThreadRecord } from '../store/explorations'
import { openChat, seedPaper } from '../store/workspace'
import HopDots from '../teacher/HopDots'
import { ClearGlyph } from '../teacher/Teacher'
import ComposerNotes from '../teacher/ComposerNotes'
import ModelPicker from '../teacher/ModelPicker'
import SourcePicker from '../teacher/SourcePicker'
import { useSourceScope } from '../teacher/useSourceScope'
import { conversationHistory } from '../teacher/history'
import ChatMessage from '../teacher/transcript/ChatMessage'
import { usePresence } from '../ui/usePresence'
import { useResizablePanel } from '../ui/useResizablePanel'
import {
  clearAssistantChat,
  quotedMessage,
  stopAssistant,
  type AssistantQuestion,
  type AssistantTool,
  type PassageQuote,
} from './askAssistant'
import '../teacher/teacher.css'

/** A stable empty transcript, for a chat that hasn't started. */
const NO_TURNS: never[] = []

/** What a tool's assistant says, and where it sits in the page. */
export interface AssistantCopy {
  /** The panel's title, e.g. "Knowledge Graph Assistant". */
  title: string
  /** Shown in an empty chat: what to ask, and what the highlight menu does. */
  hint: string
  /** The line over the bar saying what is asked about. */
  context: string
  /** The ⓘ tip beside that line. */
  tip: string
  /** The bar's placeholder with nothing attached. */
  placeholder: string
  /** The panel's own class (beside `teacher`), and its tour anchor. */
  className: string
  /** Where its dragged width is remembered. */
  widthKey: string
}

/**
 * Render a tool's docked assistant.
 *
 * @param props Component props.
 * @param props.thread The paper thread it answers over.
 * @param props.tool The tool whose side chat it writes to.
 * @param props.copy Its words, class and width key.
 * @param props.available Whether there is anything to ask over yet; the bar
 *   won't send until there is.
 * @param props.ask The tool's ask thunk (its `askAssistant` with a `prepare`).
 * @param props.collapsed Hidden, but kept mounted.
 * @param props.onClose Collapse the panel (its ✕).
 * @param props.quote A passage a highlight's Chat attached to the bar, with a
 *   `seq` that changes each time one is attached.
 * @param props.onQuoteClear Let go of the attached passage (its ✕, or sent).
 * @returns The docked panel.
 */
export default function DockedAssistant({
  thread,
  tool,
  copy,
  available,
  ask,
  collapsed,
  onClose,
  quote = null,
  onQuoteClear,
}: {
  thread: ThreadRecord
  tool: AssistantTool
  copy: AssistantCopy
  available: boolean
  ask: (
    request: AssistantQuestion,
  ) => (dispatch: AppDispatch, getState: () => RootState) => Promise<void>
  collapsed: boolean
  onClose: () => void
  quote?: (PassageQuote & { seq: number }) | null
  onQuoteClear?: () => void
}) {
  const dispatch = useAppDispatch()
  const key = chatKey(thread.id, tool)
  const chat = useAppSelector((state) => state.transcript.byKey[key]?.chat ?? NO_TURNS)
  const asking = useAppSelector((state) => !!state.transcript.byKey[key]?.running.length)
  const provider = thread.data.provider ?? 's2'

  // The exploration's other chats, for the `@` list.
  const record = useAppSelector((state) => state.explorations.byId[state.explorations.activeId])
  const conversations = useAppSelector((state) => state.transcript.byKey)
  const otherChats = useMemo(
    () =>
      record
        ? explorationChats(record, { byKey: conversations })
            .filter((entry) => entry.key !== key)
            .map((entry) => ({ id: entry.key, title: entry.label }))
        : [],
    [record, conversations, key],
  )
  const mentions = useMentionSuggestions(provider, otherChats, false)
  const mentionsPanel = usePresence(mentions.open)
  const lastMentions = useRef(mentions)
  if (mentions.open) lastMentions.current = mentions
  const shownMentions = mentions.open ? mentions : lastMentions.current

  const [input, setInput] = useState('')
  // Chats the `@` list attached, as chips over the bar (v8.29.0), as in the
  // Citation Graph's (see `mentions/attachments.ts`).
  const [attached, setAttached] = useState<MentionChoice[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [lightbox, setLightbox] = useState<AnswerFigure | null>(null)
  // Which uploaded sources its answers may search (the 📚 picker, v8.25.0).
  const sources = useSourceScope()
  // Which of the bar's popovers is open: one at a time.
  const [openPopover, setOpenPopover] = useState<'sources' | 'model' | null>(null)
  const { width, onHandlePointerDown, dragging } = useResizablePanel(copy.widthKey, 340)

  // Closing and reopening slide the panel, as Teacher's does.
  const dock = usePresence(!collapsed)
  const [wasCollapsed, setWasCollapsed] = useState(collapsed)
  const [reopening, setReopening] = useState(false)
  if (collapsed !== wasCollapsed) {
    setWasCollapsed(collapsed)
    setReopening(!collapsed)
  }
  const onDockAnimationEnd = (event: AnimationEvent) => {
    dock.onAnimationEnd(event)
    if (reopening && event.target === event.currentTarget && event.animationName === 'panel-in')
      setReopening(false)
  }

  // Follow the bottom while an answer builds, only while the reader is there;
  // a new question (from here or from a highlight's Explain) re-arms it.
  const scrollRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const onTranscriptScroll = () => {
    const box = scrollRef.current
    if (box) following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40
  }
  const lastLength = useRef(chat.length)
  useEffect(() => {
    const box = scrollRef.current
    if (chat.length > lastLength.current) following.current = true
    lastLength.current = chat.length
    if (box && following.current) box.scrollTop = box.scrollHeight
  }, [chat])

  // Grow the textarea with its text; empty, it is one line by its CSS.
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

  // A passage just attached (a highlight's Chat): the bar takes focus, ready
  // for the question.
  const quoteSeq = quote?.seq
  useEffect(() => {
    if (quoteSeq) inputRef.current?.focus()
  }, [quoteSeq])

  const submit = (text: string = input) => {
    const typed = text.trim()
    // Chips alone send nothing (v8.29.0): they are context for a question.
    if (!typed || asking || !available) return
    const question = attachedMessage(attached, quote ? quotedMessage(typed, quote) : typed)
    setAttached([])
    setInput('')
    mentions.reset()
    onQuoteClear?.()
    void dispatch(ask({ threadId: thread.id, question, provider, sourceIds: sources.scope }))
  }
  const onAsk = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const pickMention = (choice: MentionChoice) => {
    const field = inputRef.current
    if (!field || !mentions.active) return
    const { text: next, caret } = withoutMention(input, mentions.active)
    setAttached((current) => withAttachment(current, choice))
    setInput(next)
    mentions.reset()
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(caret, caret)
    })
  }
  const syncComposer = (field: HTMLTextAreaElement) =>
    mentions.onInput(field.value, field.selectionStart ?? field.value.length)

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        mentions.move(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && mentions.choice) {
        event.preventDefault()
        pickMention(mentions.choice)
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
      submit()
    }
    // Backspace in an empty bar lets go of the attached passage, as it
    // deletes a chip in most composers.
    if (event.key === 'Backspace' && !input) {
      if (attached.length) setAttached((current) => current.slice(0, -1))
      else if (quote) onQuoteClear?.()
    }
  }

  /**
   * Ask a failed question again, with the history up to it — or, for ⚡
   * Quick response, a question still being answered, with no tools.
   *
   * @param index The failed (or working) assistant turn.
   * @param quick Stop the working answer and ask for a quick response.
   */
  const retry = (index: number, quick = false) => {
    const question = chat[index - 1]
    if (!question || question.role !== 'user') return
    const history = conversationHistory(chat.slice(0, index - 1))
    // A quick response stops the answer still working first, so nothing
    // more of it lands once its turn is gone.
    if (quick) stopAssistant(thread.id, tool)
    dispatch(failedTurnDropped(index, key))
    void dispatch(
      ask({
        threadId: thread.id,
        question: question.text,
        provider,
        history,
        sourceIds: sources.scope,
        quick,
        startedAt: quick ? chat[index]?.startedAt : undefined,
      }),
    )
  }

  return (
    <section
      className={`teacher ${copy.className}${collapsed && !dock.present ? ' collapsed' : ''}${dock.closing ? ' closing' : ''}${reopening ? ' reopening' : ''}`}
      data-tour={copy.className}
      style={{ width, '--panel-width': `${width}px` } as CSSProperties}
      onAnimationEnd={onDockAnimationEnd}
    >
      <div
        className={`panel-resize-handle${dragging ? ' dragging' : ''}`}
        onPointerDown={onHandlePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
      />
      <div className="teacher-head">
        <div className="teacher-head-top">
          <span className="teacher-title">{copy.title}</span>
          <div className="teacher-head-right">
            <button className="link-btn" onClick={onClose} aria-label={`Close the ${copy.title}`}>
              ✕
            </button>
          </div>
        </div>
      </div>

      <div className="teacher-scroll" ref={scrollRef} onScroll={onTranscriptScroll}>
        {chat.map((message, index) => (
          <ChatMessage
            key={`c${index}`}
            message={message}
            active={false}
            streaming={asking}
            working={asking && index === chat.length - 1}
            onRetry={message.failed ? () => retry(index) : undefined}
            // ⚡ Quick response (v8.30.0): the same question again, with no
            // tools, in place of the answer still searching.
            onQuick={asking && index === chat.length - 1 ? () => retry(index, true) : undefined}
            onThreadOpen={(id) => void dispatch(openChat(id))}
            onPaperSeed={(nodeId, refProvider) =>
              void dispatch(seedPaper({ seed: nodeId, provider: refProvider }))
            }
            provider={provider}
            onEnlarge={setLightbox}
          />
        ))}
        {chat.length === 0 && <div className="teacher-hint">{copy.hint}</div>}
      </div>

      <div className="ask-dock">
        <ComposerNotes
          notes={[
            ...(sources.checkedIds.length > 0
              ? [
                  `Answers also draw on ${sources.checkedIds.length} source${sources.checkedIds.length > 1 ? 's' : ''} (📚).`,
                ]
              : []),
            copy.context,
          ]}
          tip={copy.tip}
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
        <form className="teacher-ask" onSubmit={onAsk}>
          {mentionsPanel.present && (
            <MentionSuggestions
              threads={shownMentions.threads}
              papers={[]}
              highlighted={shownMentions.highlighted}
              loading={false}
              step={null}
              onPick={pickMention}
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
            onKeyUp={(event) => syncComposer(event.currentTarget)}
            onClick={(event) => syncComposer(event.currentTarget)}
            onBlur={() => mentions.reset()}
            onKeyDown={onInputKeyDown}
            rows={1}
            placeholder={
              quote
                ? 'Ask anything about this passage…'
                : attached.length
                  ? 'Now ask your question about what you attached…'
                  : copy.placeholder
            }
            aria-label={`Ask the ${copy.title} a question`}
          />
          {/* Model (v8.33.0), to 📚's left as in the Citation Graph's bar. */}
          <ModelPicker
            conversationKey={key}
            open={openPopover === 'model'}
            onOpenChange={(nowOpen) => setOpenPopover(nowOpen ? 'model' : null)}
          />
          {/* 📚 Library, inside the bar as under the Citation Graph's
              (v8.28.0; a chip under it from v8.25.0). */}
          <SourcePicker
            scope={sources}
            open={openPopover === 'sources'}
            onOpenChange={(nowOpen) => setOpenPopover(nowOpen ? 'sources' : null)}
          />
          {chat.length > 0 && (
            <button
              type="button"
              className="ask-clear"
              onClick={() => dispatch(clearAssistantChat(thread.id, tool))}
              title="Clear the chat — start a fresh conversation"
              aria-label="Clear chat"
            >
              <ClearGlyph />
            </button>
          )}
          <button
            type={asking ? 'button' : 'submit'}
            className={asking ? 'is-stop' : undefined}
            disabled={!asking && (!input.trim() || !available)}
            onClick={asking ? () => stopAssistant(thread.id, tool) : undefined}
            title={asking ? 'Stop generating' : undefined}
            aria-label={asking ? 'Stop generating' : 'Ask'}
          >
            {asking ? (
              <>
                <HopDots />
                <span className="stop-glyph" aria-hidden="true" />
              </>
            ) : (
              '↑'
            )}
          </button>
        </form>
      </div>

      <Lightbox figure={lightbox} onClose={() => setLightbox(null)} />
    </section>
  )
}
