// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The knowledge network end to end over a real store, with the tutor's calls stubbed
 * and the force-graph canvas (which jsdom can't draw) replaced by a list of node buttons.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, useSelector } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'
import KnowledgeNetwork from '../../src/knowledge/KnowledgeNetwork'
import type { KnowledgeGraphProps } from '../../src/knowledge/KnowledgeGraph'
import workspace from '../../src/store/workspace'
import transcript from '../../src/store/transcript'
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import { explorationBody, migrateExploration } from '../../src/store/threadPersistence'
import type { SavedSession } from '../../src/api'
import * as api from '../../src/api'

// The canvas stands in as one button per node: click opens, the "+" breaks down.
vi.mock('../../src/knowledge/KnowledgeGraph', () => ({
  default: ({ map, onOpen, onExpand }: KnowledgeGraphProps) => (
    <div>
      {Object.values(map.nodes).map((node) => (
        <span key={node.id}>
          <button type="button" onClick={() => onOpen(node.id)}>
            node: {node.title}
            {node.visited ? ' (visited)' : ''}
          </button>
          <button type="button" onClick={() => onExpand(node.id)}>
            expand: {node.title}
          </button>
        </span>
      ))}
    </div>
  ),
}))

// jsdom has no ResizeObserver; the canvas size doesn't matter to a list of buttons.
globalThis.ResizeObserver ??= class {
  /** No-op. */
  observe() {}
  /** No-op. */
  disconnect() {}
  /** No-op. */
  unobserve() {}
} as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const THREAD: ThreadRecord = {
  id: 'dqn',
  title: 'DQN',
  identity: 's2:DQN',
  tool: 'knowledge',
  paper: {
    id: 'DQN',
    arxiv_id: '1312.5602',
    title: 'Playing Atari',
    year: 2013,
    citation_count: 1,
    url: null,
    abstract: 'We present DQN.',
  },
  data: { chat: [], layout: 'timeline', provider: 's2' },
}

/** Mount the network on a live store whose active thread is THREAD.
 * @param knowledge A course the thread already holds, if any.
 * @returns The store.
 */
function mount(knowledge?: unknown) {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  const record = newExploration('saved')
  record.threads.push({
    ...structuredClone(THREAD),
    ...(knowledge ? { knowledge: knowledge as ThreadRecord['knowledge'] } : {}),
  })
  record.activeThreadId = THREAD.id
  store.dispatch(explorationOpened(record))
  /** Re-render from the store, as App does. */
  function Harness() {
    const thread = useSelector((state: ReturnType<typeof store.getState>) =>
      state.explorations.byId.saved.threads.find((item) => item.id === THREAD.id),
    )!
    return <KnowledgeNetwork thread={thread} />
  }
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  )
  return store
}

const ROOT_CHILDREN = [
  { name: 'Q-learning', why: 'DQN approximates Q.' },
  { name: 'TD learning', why: 'It bootstraps.' },
]

it('breaks the paper down on first open, grounding it in the paper id', async () => {
  const expand = vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  mount()
  expect(await screen.findByText('node: Q-learning')).toBeTruthy()
  expect(expand).toHaveBeenCalledTimes(1)
  expect(expand.mock.calls[0][0]).toMatchObject({
    item: { title: 'Playing Atari', kind: 'paper', paper_id: 'DQN' },
    path: [],
    provider: 's2',
  })
  expect(screen.getByText('3 of 3 lessons left')).toBeTruthy()
})

it('replaces a course saved in the old tree shape', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  mount({ rootId: 'root', nodes: { root: { id: 'root', title: 'Old' } }, known: [] })
  expect(await screen.findByText('node: Q-learning')).toBeTruthy()
  expect(screen.queryByText('node: Old')).toBeNull()
})

it('opens a lesson in the panel, marks it visited, and saves the course', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  const ref = { node_id: 'ql', title: 'Q-learning (Watkins)', url: '', provider: 's2' as const }
  const lesson = vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onToken('Q-learning [1] learns ')
    handlers.onToken('action values.')
    handlers.onRefs?.({ '1': ref })
    handlers.onDone()
  })
  const store = mount()
  await screen.findByText('node: Q-learning')

  fireEvent.click(screen.getByText('node: Q-learning'))
  // The [1] marker renders as a citation that opens the real paper's thread.
  const citation = await screen.findByTitle('Open this paper’s thread — Q-learning (Watkins)')
  expect(citation.textContent).toContain('1')
  expect(screen.getByText('node: Q-learning (visited)')).toBeTruthy()
  expect(lesson.mock.calls[0][0]).toMatchObject({
    item: { title: 'Q-learning', kind: 'concept' },
    why: 'DQN approximates Q.',
    path: [{ title: 'Playing Atari', kind: 'paper' }],
    // The paper whose reference list the lesson may cite.
    paper_id: 'DQN',
    provider: 's2',
  })
  // Why it is in the course: the item that needs it.
  expect(screen.getByText(/needs it: DQN approximates Q\./)).toBeTruthy()

  fireEvent.click(screen.getByLabelText('I know this'))
  expect(screen.getByText('2 of 3 lessons left')).toBeTruthy()

  // Next skips the checked item and the order puts TD learning before the paper.
  fireEvent.click(screen.getAllByRole('button', { name: /Next lesson/ })[0])
  await waitFor(() => expect(lesson).toHaveBeenCalledTimes(2))
  expect(lesson.mock.calls[1][0].item.title).toBe('TD learning')

  // Back to Q-learning: the kept lesson, no second stream.
  await act(async () => {
    fireEvent.click(screen.getByText('node: Q-learning (visited)'))
  })
  expect(lesson).toHaveBeenCalledTimes(2)

  const state = store.getState()
  const body = explorationBody(state, state.explorations.byId.saved)
  const restored = migrateExploration({ id: 'saved', name: 'x', data: body } as SavedSession)
  const knowledge = restored.threads.find((thread) => thread.id === 'dqn')!.knowledge!
  expect(knowledge.known).toEqual(['q learning'])
  expect(knowledge.nodes['q learning'].lesson).toBe('Q-learning [1] learns action values.')
  expect(knowledge.nodes['q learning'].refs).toEqual({ '1': ref })
  expect(knowledge.edges.map((edge) => edge.to)).toEqual(['q learning', 'td learning'])
})

it('a shared prerequisite becomes one node with two arrows into it', async () => {
  vi.spyOn(api, 'expandKnowledge')
    .mockResolvedValueOnce(ROOT_CHILDREN)
    .mockResolvedValueOnce([{ name: 'Bootstrapping', why: 'Q-learning bootstraps.' }])
    .mockResolvedValueOnce([{ name: 'bootstrapping', why: 'TD bootstraps too.' }])
  const store = mount()
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('expand: Q-learning'))
  await screen.findByText('node: Bootstrapping')
  fireEvent.click(screen.getByText('expand: TD learning'))
  await waitFor(() => {
    const map = store.getState().explorations.byId.saved.threads[1].knowledge!
    expect(map.edges.filter((edge) => edge.to === 'bootstrapping')).toHaveLength(2)
  })
  expect(screen.getAllByText('node: Bootstrapping')).toHaveLength(1)
})

it('offers a retry when breaking the paper down fails', async () => {
  const expand = vi
    .spyOn(api, 'expandKnowledge')
    .mockRejectedValueOnce(new Error('The tutor couldn’t break this down — try again.'))
    .mockResolvedValue([])
  mount()
  expect(await screen.findByText(/couldn’t break this down/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(expand).toHaveBeenCalledTimes(2))
})
