/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader assistant's asking (v8.38.0): what it sends on top of the docked
 * assistants' shared engine (`assistant/askAssistant`), and how the Reader's
 * highlight menu words a passage.
 *
 * It sends only the paper's arXiv id and the section in view; the server lays
 * the paper out from the document it already cached for the Reader
 * (`routes/agents.py`, `_reading_context`). The section in view is the
 * Reader's to know, and changes on every scroll, so the Reader writes it here
 * (`setReadingSection`) rather than into the store, where each scroll would
 * re-render whatever reads it; it's only needed at the moment of asking.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import {
  routeReaderMessage,
  streamAskReader,
  streamGuideReader,
  type Beat,
  type Provider,
} from '../api'
import {
  askAssistant,
  clearAssistantChat,
  lectureAssistant,
  passageMessage,
  stopAssistant,
  type AssistantQuestion,
} from '../assistant/askAssistant'
import { isCurrentMap } from '../knowledge/model'
import type { AppDispatch, RootState } from '../store'
import type { ThreadRecord } from '../store/explorations'
import { passagesLit } from '../store/highlight'
import { questionPassage } from './passages'

/** The section in view in each thread's Reader, by thread id. */
const readingSections = new Map<string, string>()

/**
 * Note the section in view, for the next question.
 *
 * @param threadId The thread.
 * @param sectionId The section's id, or null to forget it.
 */
export function setReadingSection(threadId: string, sectionId: string | null): void {
  if (sectionId) readingSections.set(threadId, sectionId)
  else readingSections.delete(threadId)
}

/**
 * The ref the Reader asks for a paper's document by: its arXiv id when
 * known. Shared with the route the assistant asks, so both read one paper.
 *
 * @param thread The paper thread.
 * @returns Its arXiv id, else its seed ref, else null.
 */
export function documentRef(thread: ThreadRecord): string | null {
  return (
    thread.paper?.arxiv_id ??
    thread.data.graph_ref?.seed.arxiv_id ??
    thread.data.graph_ref?.seed_ref ??
    null
  )
}

/**
 * Ask the Reader's assistant, streaming the answer into the thread's Reader
 * chat. Does nothing for a thread with no paper to read.
 *
 * @param request The question and the thread it is about.
 * @returns The thunk; it settles when the answer has ended, however it ended.
 */
export function askReader(request: AssistantQuestion) {
  return askAssistant('reader', request, (thread) => {
    const paper = documentRef(thread)
    if (!paper) return null
    const section = readingSections.get(thread.id) ?? null
    const title = thread.paper?.title ?? thread.title
    return (body, handlers) => streamAskReader({ ...body, paper, section, title }, handlers)
  })
}

/**
 * Stop the answer streaming in a thread's Reader chat, keeping what it has
 * written.
 *
 * @param threadId The thread.
 */
export function stopReaderAsk(threadId: string): void {
  stopAssistant(threadId, 'reader')
}

/**
 * Stop any answer and clear a thread's Reader chat.
 *
 * @param threadId The thread.
 * @returns The thunk.
 */
export function clearReaderChat(threadId: string) {
  return clearAssistantChat(threadId, 'reader')
}

/** What each of the Reader's highlight-menu actions asks for. */
const VERBS = {
  explain: 'Explain',
  simplify: 'Simplify, in plain words,',
} as const

/**
 * The message a Reader highlight's **Explain** or **Simplify** sends: the
 * request, the passage, and the section it is from, so the transcript reads
 * on its own later.
 *
 * @param action Which action.
 * @param passage The highlighted text (math as `$…$`).
 * @param from Where it is from, as a phrase ("section 3.2, Attention").
 * @returns The message (plain text: a user turn renders no Markdown).
 */
export function readerMessage(action: keyof typeof VERBS, passage: string, from: string): string {
  return passageMessage(VERBS[action], passage, from)
}

/** What a lecture's user turn says when it came from the **Give Lecture**
 *  button (v8.50.0); one asked for in the chat keeps the reader's words. */
export const LECTURE_ASK = 'Give me a lecture on this paper'

/**
 * What a lecture's beat lights in the paper: **one place** (Patrick: a beat
 * lit two places far apart read as noise). A beat about an equation, a
 * figure, a table or an algorithm lights that, whole, by its label; any
 * other beat, its quote. A labelled beat's quote is usually the sentence
 * that mentions it ("…described in Algorithm 1."), which can sit a page
 * away from the thing itself.
 *
 * @param beat The beat.
 * @returns The passage and labels to light.
 */
export function beatLight(beat: Beat): { passage: string | null; labels: string[] } {
  const labels = beat.labels ?? []
  return labels.length ? { passage: null, labels } : { passage: beat.quote ?? null, labels: [] }
}

/**
 * The course's concepts the student has checked off, and those they haven't,
 * for the guided read to take quickly or slowly.
 *
 * @param thread The paper thread.
 * @returns Their titles; empty without a course.
 */
export function courseNames(thread: ThreadRecord): { known: string[]; learning: string[] } {
  const map = isCurrentMap(thread.knowledge) ? thread.knowledge : null
  if (!map) return { known: [], learning: [] }
  const known: string[] = []
  const learning: string[] = []
  for (const node of Object.values(map.nodes)) {
    if (node.id === map.rootId || node.kind === 'synthesis') continue
    ;(map.known.includes(node.id) ? known : learning).push(node.title)
  }
  return { known, learning }
}

/**
 * Give a lecture on the paper in the Reader (v8.50.0, the guided read): the
 * whole paper, beat by beat in its own order, streamed into the Reader
 * Assistant's chat as one turn. **It follows itself as it is written**, as
 * the Citation Graph's lecture does (Patrick): each beat lights its passage
 * and the Reader goes there as it arrives, for as long as the reader is
 * still following (the lit beat is the one before it). Clicking a beat,
 * stepping Back / Next or putting the light out leaves it where they went.
 *
 * @param request What to lecture on.
 * @param request.threadId The paper thread.
 * @param request.provider The thread's provider.
 * @param request.question The user turn's words: what was typed, when it was
 *        asked in the chat; else the button's.
 * @returns The thunk.
 */
export function guideReader(request: { threadId: string; provider: Provider; question?: string }) {
  return (dispatch: AppDispatch, getState: () => RootState) =>
    dispatch(
      lectureAssistant(
        'reader',
        { threadId: request.threadId, question: request.question ?? LECTURE_ASK },
        (thread) => {
          const paper = documentRef(thread)
          if (!paper) return null
          const section = readingSections.get(thread.id) ?? null
          const title = thread.paper?.title ?? thread.title
          return (handlers) =>
            streamGuideReader(
              {
                paper,
                section,
                title,
                provider: request.provider,
                ...courseNames(thread),
              },
              handlers,
            )
        },
        (beat, index, answer) => {
          const lit = getState().highlight?.passages
          const following =
            index === 0 ||
            (lit?.threadId === request.threadId && lit.answer === answer && lit.beat === index - 1)
          if (!following) return
          dispatch(
            passagesLit({
              threadId: request.threadId,
              answer,
              beat: index,
              ...beatLight(beat),
              places: [],
              quotes: [],
              scroll: true,
            }),
          )
        },
      ),
    )
}

/**
 * Send a message to the Reader Assistant, as a lecture on the paper when it
 * asks for one (v8.50.0, Patrick: asking in the chat as well as the **Give
 * Lecture** button), else as a question. A question about an attached
 * passage is always a question.
 *
 * @param request The question, as `askReader` takes it.
 * @returns The thunk; it settles when the answer or the guided read has ended.
 */
export function askOrGuideReader(request: AssistantQuestion) {
  return async (dispatch: AppDispatch): Promise<void> => {
    const attached =
      !!request.places?.length ||
      !!request.figures?.length ||
      !!request.labels?.length ||
      !!questionPassage(request.question)
    if (!attached && !request.history && !request.quick) {
      const route = await routeReaderMessage(request.question)
      if (route.target === 'guide') {
        await dispatch(
          guideReader({
            threadId: request.threadId,
            provider: request.provider,
            question: request.question,
          }),
        )
        return
      }
    }
    await dispatch(askReader(request))
  }
}
