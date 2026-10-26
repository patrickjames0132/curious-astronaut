/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader's assistant (v8.38.0): a docked chat beside the paper being
 * read, answering from the paper (the section in view whole, the rest as it
 * fits) through the researcher, which also reaches the library and the web,
 * not the literature. The panel is the shared `assistant/DockedAssistant`
 * (the Knowledge Graph's is the same one); this file gives it the Reader's
 * words and `askReader`. It writes to the thread's Reader chat
 * (`store/chats`, saved as `ThreadRecord.readerChat`).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useMemo } from 'react'
import DockedAssistant, { type AnswerPassages } from '../assistant/DockedAssistant'
import type { PassageQuote } from '../assistant/askAssistant'
import { useAppDispatch, useAppSelector } from '../store'
import { chatKey } from '../store/chats'
import type { ThreadRecord } from '../store/explorations'
import { passagesCleared, passagesLit } from '../store/highlight'
import { askOrGuideReader, beatLight, documentRef } from './askReader'
import { answerQuotes, questionPassage } from './passages'
import { labelsInPassage } from './textBox'

/**
 * Render the Reader's assistant.
 *
 * @param props Component props.
 * @param props.thread The paper thread being read.
 * @param props.collapsed Hidden, but kept mounted.
 * @param props.onClose Collapse the panel (its ✕).
 * @param props.quote A passage the Reader's Chat attached to the bar, with a
 *   `seq` that changes each time one is attached.
 * @param props.onQuoteClear Let go of the attached passage (its ✕, or sent).
 * @returns The docked panel.
 */
export default function ReaderAssistant({
  thread,
  collapsed,
  onClose,
  quote = null,
  onQuoteClear,
}: {
  thread: ThreadRecord
  collapsed: boolean
  onClose: () => void
  quote?: (PassageQuote & { seq: number }) | null
  onQuoteClear?: () => void
}) {
  // An answer lights what it's about in the paper (v8.45.0): the passage its
  // question was asked about, else its ⟦quotes⟧; a quote clicked lights just
  // it. On finishing, in place; on a click, there too, and the Reader goes
  // to it (Patrick).
  const dispatch = useAppDispatch()
  const chat = useAppSelector((state) => state.transcript.byKey[chatKey(thread.id, 'reader')]?.chat)
  const lit = useAppSelector((state) => state.highlight?.passages)
  const active = lit?.threadId === thread.id ? lit.answer : null
  const activeBeat =
    lit?.threadId === thread.id && lit.answer !== null && typeof lit.beat === 'number'
      ? { answer: lit.answer, beat: lit.beat }
      : null
  const available = !!documentRef(thread)
  const passages = useMemo<AnswerPassages>(() => {
    // The whole answer stands for the passage it was asked about, exactly as
    // highlighted; its quotes light one at a time, clicked (Patrick,
    // 2026-10-25). An answer to a typed question has no passage: its quotes
    // stand in.
    const about = (index: number) => {
      const asked = chat?.[index - 1]
      const user = asked?.role === 'user' ? asked : null
      const passage = user ? questionPassage(user.text) : null
      const places = user?.places ?? []
      // A question from before labels were kept reads them off its words.
      const labels = user?.labels ?? (passage ? labelsInPassage(passage) : [])
      const asHighlighted = !!passage || places.length > 0
      return {
        passage,
        places,
        labels,
        quotes: asHighlighted ? [] : answerQuotes(chat?.[index]?.text ?? ''),
      }
    }
    const show = (answer: number | null, lit: ReturnType<typeof about>, scroll: boolean) =>
      dispatch(passagesLit({ threadId: thread.id, answer, ...lit, scroll }))
    // A guided read's beat lights its passage (v8.50.0): its words, and the
    // label of the equation or figure it teaches, in either view.
    const showBeat = (answer: number, index: number) => {
      const beat = chat?.[answer]?.beats?.[index]
      if (!beat) return
      dispatch(
        passagesLit({
          threadId: thread.id,
          answer,
          beat: index,
          ...beatLight(beat),
          places: [],
          quotes: [],
          scroll: true,
        }),
      )
    }
    const isLecture = (index: number) => !!chat?.[index]?.beats?.length
    return {
      active,
      activeBeat,
      onFinished: (index) => {
        // A guided read lit its first beat as it arrived.
        if (isLecture(index)) return
        const lit = about(index)
        if (lit.passage || lit.places.length || lit.quotes.length) show(index, lit, false)
      },
      onActivate: (index) => {
        if (active === index) dispatch(passagesCleared())
        else show(index, about(index), true)
      },
      onQuote: (quote) =>
        show(null, { passage: null, places: [], labels: [], quotes: [quote] }, true),
      onBeat: (answer, index) => {
        if (activeBeat?.answer === answer && activeBeat.beat === index) dispatch(passagesCleared())
        else showBeat(answer, index)
      },
    }
  }, [active, activeBeat, chat, dispatch, thread.id])
  return (
    <DockedAssistant
      passages={passages}
      thread={thread}
      tool="reader"
      available={available}
      ask={askOrGuideReader}
      collapsed={collapsed}
      onClose={onClose}
      quote={quote}
      onQuoteClear={onQuoteClear}
      copy={{
        title: 'Reader Assistant',
        hint:
          'Ask about the paper: what a passage means, where a symbol comes from, why a step ' +
          'follows. Highlight text (or ⌥-drag a box over an equation or figure) ' +
          'and choose Explain or Simplify to ask about it here, or ' +
          'Chat to attach it and ask anything. For a lecture on the whole paper, press Give ' +
          'Lecture On Paper by its title, or ask for one here.',
        context: `Asking about ${thread.paper?.title ?? thread.title}, from the section you’re reading`,
        tip:
          'It reads the paper, starting with the section you’re in, and searches your library ' +
          'and the web only when a question reaches past the paper. The paper’s words it quotes ' +
          'light up in the paper: click an answer or a quote to go there. A lecture lights ' +
          'each step as you go: Back and Next on the step you’re on. Type @ to bring in ' +
          'another chat, such as this paper’s Knowledge Graph conversation.',
        placeholder: 'Ask about this paper, or @ another chat…',
        className: 'reader-assistant',
        widthKey: 'ca.readerAssistantWidth',
      }}
    />
  )
}
