// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: A paper thread's card home — header, its four cards, and the one-time paper fetch.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'
import ToolCards from '../../src/tools/ToolCards'
import workspace from '../../src/store/workspace'
import transcript from '../../src/store/transcript'
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import * as api from '../../src/api'
import { forgetBusy, markBusy } from '../../src/tools/busy'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  forgetBusy()
})

/** A paper thread, optionally already carrying its hydrated paper.
 * @param paper Whether the thread already holds its paper.
 * @returns The thread record.
 */
function paperThread(paper: boolean): ThreadRecord {
  return {
    id: 'dqn',
    title: 'DQN',
    identity: 's2:DQN',
    tool: 'cards',
    paper: paper
      ? {
          id: 'DQN',
          arxiv_id: '1312.5602',
          title: 'Playing Atari with Deep Reinforcement Learning',
          authors: 'Mnih, Kavukcuoglu, Silver',
          year: 2013,
          citation_count: 1,
          url: null,
          tldr: 'Q-learning from pixels.',
        }
      : undefined,
    data: {
      chat: [],
      layout: 'timeline',
      provider: 's2',
      graph_ref: { seed: { id: 'DQN', title: 'DQN' }, seed_ref: '1312.5602' },
    },
  }
}

/** Mount the card home over a store holding the thread.
 * @param thread The thread to show.
 * @returns The store and the onOpen spy.
 */
function mount(thread: ThreadRecord) {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  const record = newExploration('saved')
  record.threads.push(thread)
  record.activeThreadId = thread.id
  store.dispatch(explorationOpened(record))
  const onOpen = vi.fn()
  render(
    <Provider store={store}>
      <ToolCards thread={thread} onOpen={onOpen} />
    </Provider>,
  )
  return { store, onOpen }
}

it('heads the page with the paper and opens the graph card', () => {
  const fetch = vi.spyOn(api, 'fetchPaperDetail')
  const { onOpen } = mount(paperThread(true))
  expect(screen.getByRole('heading', { name: /Playing Atari/ })).toBeTruthy()
  expect(screen.getByText('Mnih, Kavukcuoglu, Silver')).toBeTruthy()
  expect(screen.getByText(/· 2013/)).toBeTruthy()
  expect(screen.getByText('Q-learning from pixels.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Citation Graph/ }))
  expect(onOpen).toHaveBeenCalledWith('graph')
  expect(fetch).not.toHaveBeenCalled()
})

it('opens the Knowledge Graph card', () => {
  const { onOpen } = mount(paperThread(true))
  fireEvent.click(screen.getByRole('button', { name: /Knowledge Graph/ }))
  expect(onOpen).toHaveBeenCalledWith('knowledge')
  expect(screen.queryByText('Coming soon')).toBeNull()
})

it('opens the Reader card', () => {
  const { onOpen } = mount(paperThread(true))
  fireEvent.click(screen.getByRole('button', { name: /Reader/ }))
  expect(onOpen).toHaveBeenCalledWith('reader')
})

it('opens the Criticisms card', () => {
  const { onOpen } = mount(paperThread(true))
  fireEvent.click(screen.getByRole('button', { name: /Criticisms/ }))
  expect(onOpen).toHaveBeenCalledWith('reviews')
})

it('fetches a missing paper once and keeps it on the thread', async () => {
  const fetch = vi.spyOn(api, 'fetchPaperDetail').mockResolvedValue({
    id: 'DQN',
    arxiv_id: '1312.5602',
    title: 'Playing Atari with Deep Reinforcement Learning',
    year: 2013,
    citation_count: 1,
    url: null,
  })
  const { store } = mount(paperThread(false))
  // The thread's own title heads the page until the lookup lands.
  expect(screen.getByRole('heading', { name: 'DQN' })).toBeTruthy()
  expect(fetch).toHaveBeenCalledWith('1312.5602', 's2')
  await waitFor(() => {
    const record = store.getState().explorations.byId.saved
    expect(record.threads.find((thread) => thread.id === 'dqn')?.paper?.year).toBe(2013)
  })
})

/** The cards' spinners, by card title. */
const spinning = () =>
  screen.queryAllByRole('status').map((spinner) => spinner.getAttribute('aria-label'))

it('spins a card while its tool works in the background, and stops when it ends', async () => {
  const { store } = mount(paperThread(true))
  expect(spinning()).toEqual([])
  // A lesson for this thread, and Criticisms gathering for this paper.
  const lesson = markBusy('knowledge:dqn:concept-1')
  const gather = markBusy('reviews:DQN:')
  const read = markBusy('reader:1312.5602:')
  await waitFor(() =>
    expect(spinning()).toEqual([
      'Knowledge Graph: still working',
      'Reader: still working',
      'Criticisms: still working',
    ]),
  )
  expect(screen.getByText('Reading')).toBeTruthy()
  lesson()
  gather()
  read()
  await waitFor(() => expect(spinning()).toEqual([]))
  // The graph's build, left running.
  store.dispatch({ type: 'workspace/loadGraph/pending', meta: { requestId: 'build', arg: {} } })
  await waitFor(() => expect(spinning()).toEqual(['Citation Graph: still working']))
})

it("doesn't spin for another thread's or another paper's work", () => {
  mount(paperThread(true))
  markBusy('knowledge:dqn-2:concept-1')
  markBusy('reviews:DQN2:')
  expect(spinning()).toEqual([])
})
