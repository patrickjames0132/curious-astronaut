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
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import highlight from '../../src/store/highlight'
import library from '../../src/store/library'
import transcript, { selectConversation } from '../../src/store/transcript'
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
    const kept = vi.fn()
    window.addEventListener('ca:keep-chat-in-view', kept)
    const answer = screen.getByText(/The LSTM paper/).closest('.chat') as HTMLElement
    fireEvent.click(answer)
    // Full screen, following the chat to a paper keeps the chat in view.
    expect(kept).toHaveBeenCalledOnce()
    window.removeEventListener('ca:keep-chat-in-view', kept)
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

describe('where a message is about (stage 4b)', () => {
  /** A chat on screen, in an exploration with the Atari paper.
   * @returns The store.
   */
  function chatWithPaper() {
    return chatWith({ chat: [], layout: 'force' })
  }

  /** A chat on screen, in an exploration with the Atari paper and its data.
   * @param data The paper thread's saved data.
   * @returns The store.
   */
  function chatWith(data: ThreadRecord['data']) {
    vi.spyOn(api, 'listSources').mockResolvedValue({ available: false, sources: [] })
    const store = configureStore({
      reducer: { workspace, transcript, explorations, highlight, library },
    })
    const record = newExploration('x')
    record.threads.push({
      id: 'atari',
      title: 'Playing Atari',
      identity: 's2:atari',
      tool: 'cards',
      data,
      paper: {
        id: 'atari',
        arxiv_id: '1312.5602',
        title: 'Playing Atari',
      } as ThreadRecord['paper'],
    })
    store.dispatch(explorationOpened(record))
    render(
      <Provider store={store}>
        <Teacher landing />
      </Provider>,
    )
    return store
  }

  /** Type a question and send it. */
  function ask(question: string) {
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: question } })
    fireEvent.submit(box.closest('form')!)
  }

  it('asks another paper’s view where the router placed it, and offers it back', async () => {
    const store = chatWithPaper()
    const place = vi
      .spyOn(api, 'routePlace')
      .mockResolvedValue({ place: 'paper', paper: 1, tool: 'reader' })
    vi.spyOn(api, 'routeReaderMessage').mockResolvedValue({ target: 'answer' })
    const reader = vi.spyOn(api, 'streamAskReader').mockImplementation(async (_body, handlers) => {
      handlers.onToken('Section 2 says so.')
    })
    const general = vi
      .spyOn(api, 'streamAskSources')
      .mockImplementation(async (_body, handlers) => {
        handlers.onToken('From the chat.')
      })
    ask('What does the Atari paper say about replay?')
    await screen.findByText('Section 2 says so.')
    expect(place.mock.calls[0].slice(1)).toEqual([['Playing Atari'], { paper: null, tool: null }])
    expect(reader.mock.calls[0][0].paper).toBe('1312.5602')
    const [asked] = selectConversation(store.getState()).chat
    expect(asked.tag).toMatchObject({ threadId: 'atari', tool: 'reader' })
    expect(asked.placedFrom).toBe('general')
    // The correction asks it where it was typed: General, here.
    fireEvent.click(screen.getByRole('button', { name: 'Ask from General instead' }))
    await screen.findByText('From the chat.')
    expect(general).toHaveBeenCalledOnce()
    expect(place).toHaveBeenCalledOnce()
  })

  it('takes a lecture placed on another paper’s graph there, and gives it once built', async () => {
    // The paper has a graph to build.
    const store = chatWith({
      chat: [],
      layout: 'force',
      graph_ref: { seed: { id: 'atari', title: 'Playing Atari' }, seed_ref: 'atari' },
    })
    vi.spyOn(api, 'routePlace').mockResolvedValue({ place: 'paper', paper: 1, tool: 'graph' })
    vi.spyOn(api, 'routeMessage').mockResolvedValue({
      target: 'lecture',
      framing: 'summary',
      scope: 'screen',
      year_from: null,
      year_to: null,
    })
    vi.spyOn(api, 'fetchGraphStream').mockResolvedValue({
      seed: { id: 'atari', title: 'Playing Atari' },
      nodes: [{ id: 'atari', title: 'Playing Atari', rels: [], is_seed: true }],
      edges: [],
      counts: {},
    } as unknown as GraphResponse)
    const lecture = vi.spyOn(api, 'streamLecture').mockImplementation(async (_body, handlers) => {
      handlers.onBeat({ heading: 'Roots', text: 'Q-learning came first.', node_ids: [] })
    })
    const answer = vi.spyOn(api, 'streamAsk')
    ask('Lecture me on the references of the Atari paper')
    await screen.findByText('Q-learning came first.')
    expect(lecture).toHaveBeenCalledOnce()
    expect(answer).not.toHaveBeenCalled()
    const now = store.getState().explorations.byId.x
    expect(now.activeThreadId).toBe('atari')
    const [asked] = selectConversation(store.getState()).chat
    expect(asked.tag).toMatchObject({ threadId: 'atari', tool: 'graph' })
  })

  it('asks no router when there is no other paper the message could mean', async () => {
    vi.spyOn(api, 'listSources').mockResolvedValue({ available: false, sources: [] })
    const store = configureStore({
      reducer: { workspace, transcript, explorations, highlight, library },
    })
    store.dispatch(explorationOpened(newExploration('x')))
    render(
      <Provider store={store}>
        <Teacher landing />
      </Provider>,
    )
    const place = vi.spyOn(api, 'routePlace')
    vi.spyOn(api, 'streamAskSources').mockImplementation(async (_body, handlers) => {
      handlers.onToken('Hello.')
    })
    ask('Hello there')
    await screen.findByText('Hello.')
    expect(place).not.toHaveBeenCalled()
  })
})
