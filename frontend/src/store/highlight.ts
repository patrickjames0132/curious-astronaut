/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The highlight slice: which papers the teacher is currently talking about
 * (the active beat's nodes, or an answer's cited papers). The teacher writes
 * it; the canvas glows them. Stored as an array (serializable); the canvas
 * selects it as a memoized Set.
 *
 * Since v8.45.0 it also holds the Reader's lit passages: the paper's words a
 * Reader Assistant answer is about, which the assistant sets (an answer
 * finishing, an answer or a quote clicked) and the Reader shows. Clearing
 * that Reader's chat puts them out.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { createSelector, createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import type { PdfPlace } from '../api'
import { chatKey } from './chats'
import { explorationOpened, threadActivated } from './explorations'
import { chatCleared } from './transcript'
import { loadGraph, restoreSession, workspaceCleared } from './workspace'

/** The passages lit in a thread's Reader (v8.45.0). */
export interface LitPassages {
  threadId: string
  /** The answer they belong to (its index in the Reader's chat), if any. */
  answer: number | null
  /** The passage its question was asked about, when one was highlighted. */
  passage: string | null
  /** Where that passage sits in the PDF, when it was highlighted there
   *  (`ChatMsg.places`): the PDF view lights it there, not by its words. */
  places: PdfPlace[]
  /** The labels that passage covers (v8.48.0): "Figure 1", "(6)", which
   *  both views light it by, whichever it was asked in. */
  labels: string[]
  /** The paper's words the answer quotes. */
  quotes: string[]
  /** Counts the requests to scroll to them: the Reader scrolls when it
   *  changes (a click), not when passages merely light (an answer done). */
  scroll: number
}

export interface HighlightState {
  ids: string[]
  passages: LitPassages | null
}

const initialState: HighlightState = { ids: [], passages: null }

const highlightSlice = createSlice({
  name: 'highlight',
  initialState,
  reducers: {
    highlightSet(state, action: PayloadAction<string[]>) {
      state.ids = action.payload
    },
    /** Light passages in a thread's Reader, and maybe scroll to them.
     * @param state The slice.
     * @param action Whose, which answer's, the words, and whether to scroll.
     */
    passagesLit(state, action: PayloadAction<Omit<LitPassages, 'scroll'> & { scroll: boolean }>) {
      const { scroll, ...lit } = action.payload
      const asked = state.passages?.scroll ?? 0
      state.passages = { ...lit, scroll: scroll ? asked + 1 : asked }
    },
    /** Let the Reader's passages go dark.
     * @param state The slice.
     */
    passagesCleared(state) {
      state.passages = null
    },
  },
  extraReducers: (builder) => {
    // A new/restored graph starts unlit.
    builder
      .addCase(explorationOpened, () => initialState)
      .addCase(threadActivated, () => initialState)
      .addCase(loadGraph.fulfilled, () => initialState)
      .addCase(restoreSession.fulfilled, () => initialState)
      .addCase(workspaceCleared, () => initialState)
      // Clearing the Reader's chat clears what its answers lit (Patrick).
      .addCase(chatCleared, (state, action) => {
        const lit = state.passages
        if (lit && action.meta.key === chatKey(lit.threadId, 'reader')) state.passages = null
      })
  },
})

export const { highlightSet, passagesLit, passagesCleared } = highlightSlice.actions
export default highlightSlice.reducer

/** The lit node ids as a Set — memoized so the canvas doesn't re-render on
 * every unrelated store change. */
export const selectHighlightSet = createSelector(
  (state: { highlight: HighlightState }) => state.highlight.ids,
  (ids) => new Set(ids),
)
