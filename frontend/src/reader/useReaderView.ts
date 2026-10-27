/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What the Reader lends the one assistant (v8.38.0 as a panel of its own;
 * since v9.0.0, stage 3, a view of the one panel, `teacher/Teacher`, through
 * `assistant/views`). It answers from the paper (the section in view whole,
 * the rest as it fits) through the researcher, which also reaches the library
 * and the web, not the literature; it gives a guided read when asked
 * (`askOrGuideReader`). Its questions are tagged with the paper and the
 * Reader, in the dock's chat, and only the answers to those light passages
 * in the paper (`owns`).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useMemo, useRef } from 'react'
import type { AssistantView } from '../assistant/views'
import { useAppDispatch, useAppSelector } from '../store'
import type { ThreadRecord } from '../store/explorations'
import { passagesCleared, passagesLit } from '../store/highlight'
import { selectConversation } from '../store/transcript'
import { askOrGuideReader, beatLight, documentRef } from './askReader'
import { answerQuotes, questionPassage } from './passages'
import { labelsInPassage } from './textBox'

/** A stable empty transcript, for a chat that hasn't started. */
const NO_TURNS: never[] = []

/**
 * The Reader's view, while the Reader is the view on screen.
 *
 * @param thread The paper thread being read, or undefined when the Reader
 *   isn't on screen.
 * @returns The view, or null.
 */
export function useReaderView(thread: ThreadRecord | undefined): AssistantView | null {
  // An answer lights what it's about in the paper (v8.45.0): the passage its
  // question was asked about, else its ⟦quotes⟧; a quote clicked lights just
  // it. On finishing, in place; on a click, there too, and the Reader goes
  // to it (Patrick).
  const dispatch = useAppDispatch()
  const chat = useAppSelector((state) => (thread ? selectConversation(state).chat : NO_TURNS))
  const asking = useAppSelector((state) => !!thread && !!selectConversation(state).running.length)
  const lit = useAppSelector((state) => state.highlight?.passages)
  const threadId = thread?.id
  const active = threadId && lit?.threadId === threadId ? lit.answer : null
  // Kept as one object across renders, so the passages below aren't rebuilt
  // on every one.
  const beatAnswer =
    threadId && lit?.threadId === threadId && typeof lit.beat === 'number' ? lit.answer : null
  const beatIndex = beatAnswer !== null ? (lit?.beat ?? null) : null
  const activeBeat = useMemo(
    () =>
      beatAnswer !== null && beatIndex !== null ? { answer: beatAnswer, beat: beatIndex } : null,
    [beatAnswer, beatIndex],
  )

  const passages = useMemo(() => {
    if (!threadId) return undefined
    // The whole answer stands for the passage it was asked about, exactly as
    // highlighted; its quotes light one at a time, clicked (Patrick,
    // 2026-10-25). An answer to a typed question has no passage: its quotes
    // stand in.
    const about = (index: number) => {
      const asked = chat[index - 1]
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
        quotes: asHighlighted ? [] : answerQuotes(chat[index]?.text ?? ''),
      }
    }
    const show = (answer: number | null, lighting: ReturnType<typeof about>, scroll: boolean) =>
      dispatch(passagesLit({ threadId, answer, ...lighting, scroll }))
    // A guided read's beat lights its passage (v8.50.0): its words, and the
    // label of the equation or figure it teaches, in either view.
    const showBeat = (answer: number, index: number) => {
      const beat = chat[answer]?.beats?.[index]
      if (!beat) return
      dispatch(
        passagesLit({
          threadId,
          answer,
          beat: index,
          ...beatLight(beat),
          places: [],
          quotes: [],
          scroll: true,
        }),
      )
    }
    // Only the answers to questions asked beside this paper's Reader light
    // passages in it (v9.0.0): the chat is the dock's, and also holds turns
    // asked beside other views and papers.
    const owns = (index: number) => {
      const tag = chat[index - 1]?.tag
      return tag?.tool === 'reader' && tag.threadId === threadId
    }
    return {
      active,
      activeBeat,
      owns,
      onActivate: (index: number) => {
        if (active === index) dispatch(passagesCleared())
        else show(index, about(index), true)
      },
      onQuote: (quote: string) =>
        show(null, { passage: null, places: [], labels: [], quotes: [quote] }, true),
      onBeat: (answer: number, index: number) => {
        if (activeBeat?.answer === answer && activeBeat.beat === index) dispatch(passagesCleared())
        else showBeat(answer, index)
      },
      // Lighting an answer the moment it finishes, without moving the page.
      finished: (index: number) => {
        // A guided read lit its first beat as it arrived.
        if (chat[index]?.beats?.length || !owns(index)) return
        const lit = about(index)
        if (lit.passage || lit.places.length || lit.quotes.length) show(index, lit, false)
      },
    }
  }, [active, activeBeat, chat, dispatch, threadId])

  // An answer finishing (v8.45.0): light what it's about.
  const wasAsking = useRef(asking)
  useEffect(() => {
    const finished = wasAsking.current && !asking
    wasAsking.current = asking
    const last = chat.at(-1)
    if (finished && passages && last?.role === 'assistant' && !last.failed)
      passages.finished(chat.length - 1)
  }, [asking, chat, passages])

  return useMemo<AssistantView | null>(
    () =>
      thread && passages
        ? {
            tool: 'reader',
            thread,
            available: !!documentRef(thread),
            ask: askOrGuideReader,
            passages,
            copy: {
              title: 'Reader Assistant',
              hint:
                'Ask about the paper: what a passage means, where a symbol comes from, why a step ' +
                'follows. Highlight text (or ⌥-drag a box over an equation or figure) ' +
                'and choose Explain or Simplify to ask about it here, or ' +
                'Chat to attach it and ask anything. For a lecture on the whole paper, press Give ' +
                'Lecture On Paper by its title, or ask for one here.',
              context: `Asking about ${thread.paper?.title ?? thread.title}, from the section you’re reading`,
              tip:
                'It reads the paper, starting with the section you’re in, and searches your ' +
                'library and the web only when a question reaches past the paper. The paper’s ' +
                'words it quotes light up in the paper: click an answer or a quote to go there. A ' +
                'lecture lights each step as you go: Back and Next on the step you’re on. It talks ' +
                'in the chat you were last in (switch it under the title); type @ to bring in ' +
                'another chat.',
              placeholder: 'Ask about this paper, or @ another chat…',
              className: 'reader-assistant',
            },
          }
        : null,
    [passages, thread],
  )
}
