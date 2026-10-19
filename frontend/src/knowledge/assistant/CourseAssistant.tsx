/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Knowledge Graph's assistant (v8.25.0): a docked chat beside a thread's
 * course, as the Citation Graph's (`teacher/Teacher`) docks beside its graph.
 * It answers from the course (its concepts, what each needs, the reader's
 * check-offs and every lesson written, the open one whole) through the
 * researcher, which still reaches the library, the literature and the web.
 *
 * **Its own chat, not the thread's.** Assistants are encapsulated per tool
 * (Patrick, 2026-10-09), so this one writes to the thread's Knowledge Graph
 * chat (`store/chats`, saved as `ThreadRecord.courseChat`), and the `@`
 * list offers the exploration's other chats, the Citation Graph's in this
 * same thread among them.
 *
 * Deliberately smaller than Teacher: no landing shape, no lecture routing,
 * no paper filters or paper lookups. It shares Teacher's 📚 source picker
 * and the notes over the bar (`teacher/SourcePicker`, `ComposerNotes`).
 * It reuses Teacher's styles and transcript rendering, so the two read as
 * one assistant in two places. The stream engine is `askCourse`, a thunk,
 * because a lesson's **Explain** asks here too. A lesson's **Chat** (v8.26.0)
 * attaches its passage to the bar as a quote, above the text, and the
 * reader's question goes with it. Like Teacher it stays mounted while
 * collapsed, so a remount never drops a half-typed question.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnimationEvent, CSSProperties, FormEvent, KeyboardEvent } from 'react'
import type { AnswerFigure } from '../../api'
import Lightbox from '../../figures/Lightbox'
import MentionSuggestions from '../../mentions/MentionSuggestions'
import { insertMention, type MentionChoice } from '../../mentions/parse'
import { useMentionSuggestions } from '../../mentions/useMentionSuggestions'
import { useAppDispatch, useAppSelector } from '../../store'
import { chatKey, explorationChats } from '../../store/chats'
import { failedTurnDropped } from '../../store/transcript'
import type { ThreadRecord } from '../../store/explorations'
import { openChat, seedPaper } from '../../store/workspace'
import HopDots from '../../teacher/HopDots'
import { ClearGlyph } from '../../teacher/Teacher'
import ComposerNotes from '../../teacher/ComposerNotes'
import SourcePicker from '../../teacher/SourcePicker'
import { useSourceScope } from '../../teacher/useSourceScope'
import { conversationHistory } from '../../teacher/history'
import ChatMessage from '../../teacher/transcript/ChatMessage'
import { usePresence } from '../../ui/usePresence'
import { useResizablePanel } from '../../ui/useResizablePanel'
import {
  askCourse,
  clearCourseChat,
  quotedMessage,
  stopCourseAsk,
  type LessonQuote,
} from './askCourse'
import '../../teacher/teacher.css'

/** A stable empty transcript, for a chat that hasn't started. */
const NO_TURNS: never[] = []

/**
 * Render the Knowledge Graph's assistant.
 *
 * @param props Component props.
 * @param props.thread The paper thread whose course it answers over.
 * @param props.collapsed Hidden, but kept mounted.
 * @param props.onClose Collapse the panel (its ✕).
 * @param props.quote A passage a lesson's Chat attached to the bar, with a
 *   `seq` that changes each time one is attached.
 * @param props.onQuoteClear Let go of the attached passage (its ✕, or sent).
 * @returns The docked panel.
 */
export default function CourseAssistant({
  thread,
  collapsed,
  onClose,
  quote = null,
  onQuoteClear,
}: {
  thread: ThreadRecord
  collapsed: boolean
  onClose: () => void
  quote?: (LessonQuote & { seq: number }) | null
  onQuoteClear?: () => void
}) {
  const dispatch = useAppDispatch()
  const key = chatKey(thread.id, 'knowledge')
  const chat = useAppSelector((state) => state.transcript.byKey[key]?.chat ?? NO_TURNS)
  const asking = useAppSelector((state) => !!state.transcript.byKey[key]?.running.length)
  const provider = thread.data.provider ?? 's2'
  const hasCourse = !!thread.knowledge

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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [lightbox, setLightbox] = useState<AnswerFigure | null>(null)
  // Which uploaded sources its answers may search (the 📚 picker, v8.25.0).
  const sources = useSourceScope()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const { width, onHandlePointerDown, dragging } = useResizablePanel('ca.courseAssistantWidth', 340)

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
  // a new question (from here or from a lesson's Explain) re-arms it.
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

  // A passage just attached (a lesson's Chat): the bar takes focus, ready
  // for the question.
  const quoteSeq = quote?.seq
  useEffect(() => {
    if (quoteSeq) inputRef.current?.focus()
  }, [quoteSeq])

  const submit = (text: string = input) => {
    const typed = text.trim()
    if (!typed || asking || !hasCourse) return
    const question = quote ? quotedMessage(typed, quote) : typed
    setInput('')
    mentions.reset()
    onQuoteClear?.()
    void dispatch(askCourse({ threadId: thread.id, question, provider, sourceIds: sources.scope }))
  }
  const onAsk = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const pickMention = (choice: MentionChoice) => {
    const field = inputRef.current
    if (!field || !mentions.active) return
    const { text: next, caret } = insertMention(input, mentions.active, choice)
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
    if (event.key === 'Backspace' && !input && quote) onQuoteClear?.()
  }

  /**
   * Ask a failed question again, with the history up to it.
   *
   * @param index The failed assistant turn.
   */
  const retry = (index: number) => {
    const question = chat[index - 1]
    if (!question || question.role !== 'user') return
    const history = conversationHistory(chat.slice(0, index - 1))
    dispatch(failedTurnDropped(index, key))
    void dispatch(
      askCourse({
        threadId: thread.id,
        question: question.text,
        provider,
        history,
        sourceIds: sources.scope,
      }),
    )
  }

  return (
    <section
      className={`teacher course-assistant${collapsed && !dock.present ? ' collapsed' : ''}${dock.closing ? ' closing' : ''}${reopening ? ' reopening' : ''}`}
      data-tour="course-assistant"
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
          <span className="teacher-title">Knowledge Graph Assistant</span>
          <div className="teacher-head-right">
            <button
              className="link-btn"
              onClick={onClose}
              aria-label="Close the Knowledge Graph Assistant"
            >
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
            onThreadOpen={(id) => void dispatch(openChat(id))}
            onPaperSeed={(nodeId, refProvider) =>
              void dispatch(seedPaper({ seed: nodeId, provider: refProvider }))
            }
            provider={provider}
            onEnlarge={setLightbox}
          />
        ))}
        {chat.length === 0 && (
          <div className="teacher-hint">
            Ask about the course: what a concept means, how two of them connect, or what to study
            next. Highlight a passage in a lesson and choose Explain to ask about it here, or Chat
            to attach it and ask anything.
          </div>
        )}
      </div>

      <div className="ask-dock">
        <ComposerNotes
          notes={[
            ...(sources.checkedIds.length > 0
              ? [
                  `Answers also draw on ${sources.checkedIds.length} source${sources.checkedIds.length > 1 ? 's' : ''} (📚).`,
                ]
              : []),
            `Asking about the course on ${thread.title}`,
          ]}
          tip="Type @ to bring in another chat from this exploration, such as this paper’s Citation Graph conversation. Highlight a passage in a lesson and choose Explain to ask about it here, or Chat to attach it and ask anything."
        />
        {/* The passage a lesson's Chat attached (v8.26.0), over the bar. */}
        {quote && (
          <div className="course-quote" role="group" aria-label="Attached passage">
            <div className="course-quote-body">
              <p className="course-quote-text">“{quote.text.trim()}”</p>
              <p className="course-quote-from">From the lesson on {quote.lesson}</p>
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
        <form className="teacher-ask" onSubmit={onAsk}>
          {mentionsPanel.present && (
            <MentionSuggestions
              threads={shownMentions.threads}
              papers={[]}
              highlighted={shownMentions.highlighted}
              whole={false}
              loading={false}
              step={null}
              onPick={pickMention}
              onHighlight={mentions.setHighlighted}
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
                : 'Ask about this course, or @ another chat…'
            }
            aria-label="Ask the Knowledge Graph Assistant a question"
          />
          {chat.length > 0 && (
            <button
              type="button"
              className="ask-clear"
              onClick={() => dispatch(clearCourseChat(thread.id))}
              title="Clear the chat — start a fresh conversation"
              aria-label="Clear chat"
            >
              <ClearGlyph />
            </button>
          )}
          <button
            type={asking ? 'button' : 'submit'}
            className={asking ? 'is-stop' : undefined}
            disabled={!asking && (!input.trim() || !hasCourse)}
            onClick={asking ? () => stopCourseAsk(thread.id) : undefined}
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
        {/* The 📚 source scope, as under the Citation Graph's bar (v8.25.0). */}
        <div className="ask-tools">
          <SourcePicker scope={sources} open={sourcesOpen} onOpenChange={setSourcesOpen} />
        </div>
      </div>

      <Lightbox figure={lightbox} onClose={() => setLightbox(null)} />
    </section>
  )
}
