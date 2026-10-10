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
  default: ({ map, selected, onOpen, onExpand, onSelect }: KnowledgeGraphProps) => (
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
          <button type="button" onClick={() => onSelect(node.id)}>
            select: {node.title}
            {selected.has(node.id) ? ' (selected)' : ''}
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
})

it('replaces a course saved in the old tree shape', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  mount({ rootId: 'root', nodes: { root: { id: 'root', title: 'Old' } }, known: [] })
  expect(await screen.findByText('node: Q-learning')).toBeTruthy()
  expect(screen.queryByText('node: Old')).toBeNull()
})

it('opens a lesson in the panel, marks it visited, and saves the course', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  const lesson = vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onToken('Q-learning learns ')
    handlers.onToken('action values.')
    handlers.onDone()
  })
  const store = mount()
  await screen.findByText('node: Q-learning')

  fireEvent.click(screen.getByText('node: Q-learning'))
  expect(await screen.findByText('Q-learning learns action values.')).toBeTruthy()
  expect(screen.getByText('node: Q-learning (visited)')).toBeTruthy()
  expect(lesson.mock.calls[0][0]).toMatchObject({
    item: { title: 'Q-learning', kind: 'concept' },
    why: 'DQN approximates Q.',
    path: [{ title: 'Playing Atari', kind: 'paper' }],
    paper_id: 'DQN',
  })
  expect(lesson.mock.calls[0][0]).not.toHaveProperty('provider')
  // Where it fits: the item that needs it heads the reason, without the old
  // "… needs it:" wording (v8.17.0).
  const fits = screen.getByRole('list', { name: 'Where this fits in the course' })
  expect(fits.textContent).toContain('Playing Atari')
  expect(fits.textContent).toContain('DQN approximates Q.')
  expect(screen.queryByText(/needs it:/)).toBeNull()

  fireEvent.click(screen.getByLabelText('I know this'))

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
  expect(knowledge.nodes['q learning'].lesson).toBe('Q-learning learns action values.')
  expect(knowledge.nodes['q learning'].refs).toBeUndefined()
  expect(knowledge.edges.map((edge) => edge.to)).toEqual(['q learning', 'td learning'])
})

it('checks off a selection at once, takes it back, and Esc clears it', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  const store = mount()
  await screen.findByText('node: Q-learning')
  const known = () => store.getState().explorations.byId.saved.threads[1].knowledge!.known

  fireEvent.click(screen.getByText('select: Q-learning'))
  fireEvent.click(screen.getByText('select: TD learning'))
  expect(screen.getByText('2 selected')).toBeTruthy()
  // Selecting never opens a lesson.
  expect(screen.queryByText(/node: Q-learning \(visited\)/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '✓ I know these' }))
  expect(known()).toEqual(['q learning', 'td learning'])
  // The bar goes with the selection.
  expect(screen.queryByText('2 selected')).toBeNull()

  // Every one already known: the action takes them back.
  fireEvent.click(screen.getByText('select: Q-learning'))
  fireEvent.click(screen.getByText('select: TD learning'))
  fireEvent.click(screen.getByRole('button', { name: 'Not known' }))
  expect(known()).toEqual([])

  // Shift-click toggles; Esc drops the lot.
  fireEvent.click(screen.getByText('select: Q-learning'))
  fireEvent.click(screen.getByText('select: Q-learning (selected)'))
  expect(screen.queryByText(/selected$/)).toBeNull()
  fireEvent.click(screen.getByText('select: TD learning'))
  expect(screen.getByText('1 selected')).toBeTruthy()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByText('1 selected')).toBeNull()

  // The controls' Clear does the same; Release waits for a pinned node.
  fireEvent.click(screen.getByLabelText('Open the course controls'))
  const clear = screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement
  expect(clear.disabled).toBe(true)
  expect((screen.getByRole('button', { name: /Release/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByText('select: TD learning'))
  expect(clear.disabled).toBe(false)
  fireEvent.click(clear)
  expect(screen.queryByText('1 selected')).toBeNull()
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
