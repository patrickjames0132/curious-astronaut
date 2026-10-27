// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A chat that crosses views (v9.0.0, the OnePager's "One assistant", stage
 * 4a), over a real store: the row that filters it by where its questions
 * were asked, and an answer asked beside another view linking there — it
 * goes to that paper's graph, then lights what it cited.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { configureStore } from '@reduxjs/toolkit'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import type { ChatMsg, GraphResponse } from '../../src/api'
import explorations, { explorationOpened, newExploration } from '../../src/store/explorations'
import highlight from '../../src/store/highlight'
import library from '../../src/store/library'
import transcript from '../../src/store/transcript'
import workspace from '../../src/store/workspace'
import Teacher from '../../src/teacher/Teacher'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const TAG = { threadId: 'paper', title: 'Attention', tool: 'graph' as const }

/** A chat with a General exchange and one asked beside a paper's graph. */
const CHAT: ChatMsg[] = [
  { role: 'user', text: 'What is a transformer?' },
  { role: 'assistant', text: 'A model built on attention.' },
  { role: 'user', text: 'Which of these came first?', tag: TAG },
  { role: 'assistant', text: 'The LSTM paper [1].', cited: ['lstm'], graphRefs: { 1: 'lstm' } },
]

/** The chat open full screen, beside an exploration that holds the paper.
 * @param chat The chat's turns.
 * @returns The store, and a remount of the panel as a view switch does it.
 */
function mount(chat: ChatMsg[] = CHAT) {
  vi.spyOn(api, 'listSources').mockResolvedValue({ available: false, sources: [] })
  vi.spyOn(api, 'fetchGraphStream').mockResolvedValue({
    seed: { id: 'paper', title: 'Attention' },
    nodes: [
      { id: 'paper', title: 'Attention', rels: [], is_seed: true },
      { id: 'lstm', title: 'LSTM', rels: ['reference'], is_seed: false },
    ],
    edges: [],
    counts: {},
  } as unknown as GraphResponse)
  const store = configureStore({
    reducer: { workspace, transcript, explorations, highlight, library },
  })
  const record = newExploration('x')
  record.threads[0].data.chat = chat
  record.threads.push({
    id: 'paper',
    title: 'Attention',
    identity: 's2:paper',
    tool: 'cards',
    data: {
      chat: [],
      layout: 'force',
      graph_ref: { seed: { id: 'paper', title: 'Attention' }, seed_ref: 'paper' },
    },
  })
  store.dispatch(explorationOpened(record))
  const panel = (key: number) => (
    <Provider store={store}>
      <Teacher key={key} landing />
    </Provider>
  )
  const { rerender } = render(panel(0))
  return Object.assign(store, { remount: () => rerender(panel(1)) })
}

describe('a chat that crosses views', () => {
  it('filters to the questions asked from one place, and back to all', () => {
    mount()
    const menu = () => {
      fireEvent.click(screen.getByRole('button', { name: /^Showing:/ }))
      return screen.getByRole('group', { name: 'Show the questions asked from' })
    }
    // General, then the paper's title once, its tool under it.
    const opened = menu()
    expect(opened.textContent).toBe('Show questions asked from✕AllGeneralAttentionCitation Graph')
    fireEvent.click(within(opened).getByLabelText('General'))
    expect(screen.getByText('A model built on attention.')).toBeTruthy()
    expect(screen.queryByText('Which of these came first?')).toBeNull()
    expect(screen.getByRole('button', { name: /^Showing:/ }).textContent).toContain('General')
    fireEvent.click(within(menu()).getByLabelText('All'))
    expect(screen.getByText('Which of these came first?')).toBeTruthy()
  })

  it('links an answer asked beside a graph there, and lights what it cited', async () => {
    const store = mount()
    const answer = screen.getByText(/The LSTM paper/).closest('.chat') as HTMLElement
    fireEvent.click(answer)
    await waitFor(() => expect(store.getState().highlight.ids).toEqual(['lstm']))
    const record = store.getState().explorations.byId.x
    expect(record.activeThreadId).toBe('paper')
    expect(record.threads.find((thread) => thread.id === 'paper')?.tool).toBe('graph')
  })

  it('keeps a lecture folded across the remount a view switch causes', () => {
    const lecture: ChatMsg = {
      role: 'assistant',
      text: '',
      beats: [{ heading: 'Roots', text: 'It began with LSTMs.', node_ids: [] }],
    }
    const store = mount([{ role: 'user', text: 'Lecture me' }, lecture])
    const caret = () => screen.getByRole('button', { name: /1 beat/ })
    // The newest lecture opens by default; the reader folds it.
    expect(caret().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(caret())
    expect(caret().getAttribute('aria-expanded')).toBe('false')
    store.remount()
    expect(caret().getAttribute('aria-expanded')).toBe('false')
  })
})
