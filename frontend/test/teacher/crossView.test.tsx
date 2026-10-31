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
  type ExplorationRecord,
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
   * @param adjust Change the exploration before it opens (more papers, turns).
   * @returns The store.
   */
  function chatWith(data: ThreadRecord['data'], adjust?: (record: ExplorationRecord) => void) {
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
    adjust?.(record)
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
    // Typed in the bar, so editable wherever the router put it (Patrick).
    expect(asked.typed).toBe(true)
    // The correction asks it where it was typed: General, here. Its tooltip
    // says both ends in words.
    const instead = screen.getByRole('button', { name: 'Ask from General instead' })
    expect(instead.getAttribute('title')).toBe(
      'Nova took this as a question about Playing Atari in the Reader. ' +
        'Click to ask it as a general question instead.',
    )
    fireEvent.click(instead)
    await screen.findByText('From the chat.')
    expect(general).toHaveBeenCalledOnce()
    expect(place).toHaveBeenCalledOnce()
  })

  it('shows the question and Nova thinking the moment it is sent, before routing ends', async () => {
    // The router's round trip used to leave the chat blank after Enter
    // (Patrick, 2026-10-30): a stand-in shows at once, then gives way.
    chatWith({ chat: [], layout: 'force' }, (record) => {
      record.threads[0].data.chat = [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'Hi! What would you like to explore?' },
      ]
    })
    let route: (value: Awaited<ReturnType<typeof api.routePlace>>) => void = () => {}
    vi.spyOn(api, 'routePlace').mockReturnValue(new Promise((resolve) => (route = resolve)))
    vi.spyOn(api, 'streamAskSources').mockImplementation(async (_body, handlers) => {
      handlers.onToken('Reusing past transitions.')
    })
    ask('What is replay?')
    expect(screen.getByText('What is replay?')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Thinking' })).toBeTruthy()
    route({ place: 'general' })
    await screen.findByText('Reusing past transitions.')
    expect(screen.getAllByText('What is replay?')).toHaveLength(1)
    // Done, the ring is still.
    await waitFor(() => expect(document.querySelector('.teacher-ask.is-working')).toBeNull())
  })

  it('in an empty chat, keeps the bar where it is and shows only the send button’s dots', async () => {
    // A stand-in there flashed mid-screen, then jumped as the first turns
    // moved the bar down (Patrick): until they arrive, only the button says
    // the question was heard.
    chatWithPaper()
    vi.spyOn(api, 'routePlace').mockReturnValue(new Promise(() => {}))
    ask('What is replay?')
    await waitFor(() => expect(api.routePlace).toHaveBeenCalled())
    expect(screen.queryByText('What is replay?')).toBeNull()
    expect(screen.queryByRole('img', { name: 'Thinking' })).toBeNull()
    expect(document.querySelector('.teacher.empty')).not.toBeNull()
    // The bar's button hops (placing counts as asking, so it offers Stop).
    expect(document.querySelector('.teacher-ask .hop-dots')).not.toBeNull()
    // And the bar's ring turns, from Enter on (Patrick, 2026-10-30).
    expect(document.querySelector('.teacher-ask.is-working')).not.toBeNull()
  })

  it('leaves a finished answer’s steps folded while the next question is placed', async () => {
    // The bar is busy while the router places the question, before its turns
    // exist; the last turn then was the finished answer, whose steps opened
    // as "Working" and closed again when the new turns came (Patrick).
    chatWith({ chat: [], layout: 'force' }, (record) => {
      record.threads[0].data.chat = [
        { role: 'user', text: 'What is replay?' },
        {
          role: 'assistant',
          text: 'Reusing past transitions.',
          trace: [{ action: 'search', ok: true, query: 'replay', provider: 's2', found: 3 }],
        },
      ] as ChatMsg[]
    })
    vi.spyOn(api, 'routePlace').mockReturnValue(new Promise(() => {}))
    expect(screen.getByText('1 step')).toBeTruthy()
    ask('How does DQN compare with Soft Actor Critic?')
    await waitFor(() => expect(api.routePlace).toHaveBeenCalled())
    expect(screen.queryByText('Working')).toBeNull()
    expect(screen.getByText('1 step')).toBeTruthy()
  })

  it('offers no way back when a bridge question reads as where it was typed', async () => {
    // Typed in General and placed across two papers, it reads as General
    // (`shownPlace`), so "Ask from General instead" would offer nothing. An
    // earlier question from the Reader shows a real place's tag beside it.
    const store = chatWith({ chat: [], layout: 'force' }, (record) => {
      record.threads[0].data.chat = [
        {
          role: 'user',
          text: 'What is replay?',
          tag: { threadId: 'atari', title: 'Playing Atari', tool: 'reader' },
        },
        { role: 'assistant', text: 'Reusing past transitions.' },
      ]
      record.threads.push({
        id: 'sac',
        title: 'Soft Actor-Critic',
        identity: 's2:sac',
        tool: 'cards',
        data: { chat: [], layout: 'force' },
        paper: { id: 'sac', title: 'Soft Actor-Critic' } as ThreadRecord['paper'],
      })
    })
    vi.spyOn(api, 'routePlace').mockResolvedValue({ place: 'papers', papers: [1, 2] })
    vi.spyOn(api, 'streamAcross').mockImplementation(async (_body, handlers) => {
      handlers.onToken('They differ.')
    })
    ask('How does DQN compare with Soft Actor Critic?')
    await screen.findByText('They differ.')
    const asked = selectConversation(store.getState()).chat.at(-2)
    expect(asked?.tag?.tool).toBe('across')
    expect(asked?.placedFrom).toBe('general')
    expect(asked?.typed).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Edit question' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Playing Atari › Reader' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /instead/ })).toBeNull()
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
