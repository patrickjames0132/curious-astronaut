// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The knowledge network end to end over a real store, with the tutor's calls stubbed
 * and the force-graph canvas (which jsdom can't draw) replaced by a list of node buttons.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider, useSelector } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import KnowledgeNetwork from '../../src/knowledge/KnowledgeNetwork'
import Teacher from '../../src/teacher/Teacher'
import { lessonSource } from '../../src/knowledge/assistant/askCourse'
import type { PassageQuote } from '../../src/assistant/askAssistant'
import highlightReducer from '../../src/store/highlight'
import library from '../../src/store/library'
import { KnowledgeNavigationHelp } from '../../src/knowledge/KnowledgeControls'
import type { KnowledgeGraphProps } from '../../src/knowledge/KnowledgeGraph'
import workspace from '../../src/store/workspace'
import transcript, { selectConversation } from '../../src/store/transcript'
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import { explorationBody, migrateExploration } from '../../src/store/threadPersistence'
import type { SavedSession } from '../../src/api'
import * as api from '../../src/api'
import { createMap, withChildren } from '../../src/knowledge/model'

// The canvas stands in as one button per node: click opens, the "+" breaks down.
vi.mock('../../src/knowledge/KnowledgeGraph', () => ({
  default: ({
    map,
    expanding,
    selected,
    lit,
    onOpen,
    onExpand,
    onSelect,
    onHover,
  }: KnowledgeGraphProps) => (
    <div>
      <p>ringed: {[...expanding].join(', ')}</p>
      {Object.values(map.nodes).map((node) => (
        <span key={node.id}>
          <button type="button" onClick={() => onOpen(node.id)}>
            node: {node.title}
            {node.visited ? ' (visited)' : ''}
          </button>
          <button type="button" onClick={() => onExpand(node.id)}>
            expand: {node.title}
          </button>
          <button
            type="button"
            onMouseEnter={() => onHover?.(node.id)}
            onMouseLeave={() => onHover?.(null)}
          >
            hover: {node.title}
          </button>
          <button type="button" onClick={() => onSelect(node.id)}>
            select: {node.title}
            {selected.has(node.id) ? ' (selected)' : ''}
            {lit?.has(node.id) ? ' (lit)' : ''}
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
  // The provider goes along only for the image tools, to find the paper's figures (v8.24.0).
  expect(lesson.mock.calls[0][0].provider).toBe('s2')
  // Connections (v8.23.0): what needs it, as a plain link; the reason goes
  // to the tutor (for the lesson's "How it fits in"), not the card.
  const requiredFor = screen.getByRole('list', { name: 'Builds toward' })
  expect(requiredFor.textContent).toContain('Playing Atari')
  expect(screen.queryByText('DQN approximates Q.')).toBeNull()
  expect(lesson.mock.calls[0][0].needed_by).toEqual([
    { title: 'Playing Atari', kind: 'paper', why: 'DQN approximates Q.' },
  ])
  // A row's name opens that item; the card folds away to its line of counts.
  const head = screen.getByRole('button', { name: 'Connections: Builds toward 1' })
  expect(head.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(head)
  expect(head.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(head)

  // Esc in two steps (v8.23.0): a selection goes first, then the panel.
  fireEvent.click(screen.getByText('select: TD learning'))
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByText('1 selected')).toBeNull()
  expect(store.getState().explorations.byId.saved.threads[1].knowledge!.openId).toBe('q learning')
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(store.getState().explorations.byId.saved.threads[1].knowledge!.openId).toBeNull()
  fireEvent.click(screen.getByText('node: Q-learning (visited)'))

  fireEvent.click(screen.getByRole('button', { name: 'Known', pressed: false }))

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

it('finds items by name, and Enter selects every match and clears the find', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  mount()
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByLabelText('Find a concept on the graph'))
  const input = screen.getByLabelText('Find a concept on the graph by name')
  fireEvent.change(input, { target: { value: 'learn' } })
  expect(screen.getByText('select: Q-learning (lit)')).toBeTruthy()
  expect(screen.getByText('select: TD learning (lit)')).toBeTruthy()
  expect(screen.getByText('select: Playing Atari')).toBeTruthy()
  expect(screen.getByText('2 hits', { exact: false })).toBeTruthy()

  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByText('2 selected')).toBeTruthy()
  expect(screen.getByText('select: Q-learning (selected)')).toBeTruthy()
  expect(screen.queryByText(/\(lit\)/)).toBeNull()
})

it('synthesizes two concepts into a synthesis that opens, joins the plan, and checks off', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  const synthesize = vi.spyOn(api, 'synthesizeKnowledge').mockResolvedValue({
    name: 'Bootstrapped value learning',
    why: 'DQN combines them.',
  })
  vi.spyOn(api, 'streamSynthesisLesson').mockImplementation(async (_body, handlers) => {
    handlers.onToken('They combine.')
    handlers.onDone()
  })
  const store = mount()
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('select: Q-learning'))
  // One concept can't be synthesized.
  expect(screen.queryByRole('button', { name: '◆ Synthesize' })).toBeNull()
  fireEvent.click(screen.getByText('select: TD learning'))
  fireEvent.click(screen.getByRole('button', { name: '◆ Synthesize' }))

  await screen.findByText('node: Bootstrapped value learning (visited)')
  expect(synthesize).toHaveBeenCalledWith(
    expect.objectContaining({
      members: [
        { title: 'Q-learning', kind: 'concept' },
        { title: 'TD learning', kind: 'concept' },
      ],
      toward: { title: 'Playing Atari', kind: 'paper' },
    }),
  )
  const map = store.getState().explorations.byId.saved.threads[1].knowledge!
  expect(map.openId).toBe('synthesis:bootstrapped value learning')
  await waitFor(() =>
    expect(
      store.getState().explorations.byId.saved.threads[1].knowledge!.nodes[
        'synthesis:bootstrapped value learning'
      ].lesson,
    ).toBe('They combine.'),
  )
  // Its Connections: what it builds toward, and what it combines.
  expect(screen.getByRole('list', { name: 'Builds toward' }).textContent).toContain('Playing Atari')
  const combines = screen.getByRole('list', { name: 'Combines' }).textContent
  expect(combines).toContain('Q-learning')
  expect(combines).toContain('TD learning')
  // No breakdown, but it checks off like a concept.
  expect(document.querySelector('.lesson-kicker.synthesis')?.textContent).toContain('Synthesis')
  expect(screen.queryByRole('button', { name: '+ Break it down' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Known', pressed: false }))
  const knownNow = store.getState().explorations.byId.saved.threads[1].knowledge!
  expect(knownNow.known).toContain('synthesis:bootstrapped value learning')
  expect(document.querySelector('.lesson-kicker.known')?.textContent).toContain('Known')
  const knownButton = screen.getByRole('button', { name: 'Known' })
  expect(knownButton.getAttribute('aria-pressed')).toBe('true')
  // Its bulb pops in on the click itself.
  expect(knownButton.classList.contains('pop')).toBe(true)
  expect(knownButton.textContent).toContain('💡')
  // Taken back, it shows its 🤔, which animates in too.
  fireEvent.click(knownButton)
  const unknownButton = screen.getByRole('button', { name: 'Known', pressed: false })
  expect(unknownButton.textContent).toContain('🤔')
  expect(unknownButton.classList.contains('pop')).toBe(true)
  fireEvent.click(unknownButton)
  expect(document.querySelector('.lesson-kicker.known')?.textContent).toContain('Synthesis')

  // Synthesizing the same two again opens it rather than asking the tutor twice.
  // (Both are lit now: the open synthesis holds its members' focus.)
  fireEvent.click(screen.getByText(/^select: TD learning/))
  fireEvent.click(screen.getByText(/^select: Q-learning/))
  fireEvent.click(screen.getByRole('button', { name: '◆ Synthesize' }))
  expect(synthesize).toHaveBeenCalledTimes(1)

  // Deleting it, from the ⋮ menu, takes it off the course and closes its panel.
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  const after = store.getState().explorations.byId.saved.threads[1].knowledge!
  expect(after.nodes['synthesis:bootstrapped value learning']).toBeUndefined()
  expect(after.openId).toBeNull()
})

it('deletes several at once, never the paper, and brings them back without a call', async () => {
  const expand = vi
    .spyOn(api, 'expandKnowledge')
    .mockResolvedValueOnce(ROOT_CHILDREN)
    .mockResolvedValueOnce([{ name: 'Bellman equations', why: 'Q-learning solves them.' }])
    .mockResolvedValueOnce([{ name: 'Value iteration', why: 'A fresh take.' }])
  const lesson = vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onToken('A lesson.')
    handlers.onDone()
  })
  const store = mount()
  const course = () => store.getState().explorations.byId.saved.threads[1].knowledge!
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('expand: Q-learning'))
  await screen.findByText('node: Bellman equations')

  // The paper alone can't be deleted.
  fireEvent.click(screen.getByText('select: Playing Atari'))
  expect(screen.getByRole('button', { name: 'Hide' }).hasAttribute('disabled')).toBe(true)
  // With it, the rest go (Delete key), and what only Q-learning needed with them.
  fireEvent.click(screen.getByText(/^select: Q-learning/))
  fireEvent.click(screen.getByText(/^select: TD learning/))
  fireEvent.keyDown(window, { key: 'Delete' })
  expect(Object.keys(course().nodes)).toEqual(['playing atari'])
  expect(screen.getByRole('status').textContent).toContain('Hid 2 items and 1 more with them')

  // The paper's "Unhide" says how many return, and brings them back from
  // what it remembers; Q-learning's own breakdown waits behind its count.
  fireEvent.click(screen.getByText('node: Playing Atari'))
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Unhide 2 children' }))
  expect(Object.keys(course().nodes).sort()).toEqual(['playing atari', 'q learning', 'td learning'])
  expect(course().nodes['q learning'].expanded).toBe(true)
  expect(expand).toHaveBeenCalledTimes(2)

  // "Break it down again" asks for a fresh one, past the server's cache; it
  // asks first, and Cancel leaves the course alone.
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Break it down again…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(expand).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Break it down again…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Break it down again' }))
  await screen.findByText('node: Value iteration')
  expect(expand).toHaveBeenLastCalledWith(expect.objectContaining({ fresh: true }))
  expect(course().nodes['q learning']).toBeUndefined()
  // It rewrites the lessons too: the open paper's at once, past the cache;
  // its new prerequisite's waits to be opened.
  await waitFor(() =>
    expect(lesson).toHaveBeenLastCalledWith(
      expect.objectContaining({ item: { title: 'Playing Atari', kind: 'paper' }, fresh: true }),
      expect.anything(),
    ),
  )
  expect(course().nodes['value iteration'].freshLesson).toBe(true)
  await waitFor(() => expect(course().nodes['playing atari'].freshLesson).toBeUndefined())
})

it('shows a lesson\'s "How it fits in" in its own card, rewritten alone when a parent joins', async () => {
  vi.spyOn(api, 'expandKnowledge')
    .mockResolvedValueOnce(ROOT_CHILDREN)
    .mockResolvedValueOnce([{ name: 'Q-learning', why: 'TD needs Q targets.' }])
  vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onToken('Q-learning learns values.\n\n### How it fits in\n\nDQN fits Q.')
    handlers.onDone()
  })
  const fit = vi.spyOn(api, 'fitLesson').mockResolvedValue('DQN fits Q; TD bootstraps on it.')
  const store = mount()
  const course = () => store.getState().explorations.byId.saved.threads[1].knowledge!
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('node: Q-learning'))
  const card = await screen.findByRole('complementary', { name: 'How it fits in' })
  expect(card.textContent).toContain('DQN fits Q.')
  expect(course().nodes['q learning'].fitFor).toEqual(['playing atari'])
  expect(fit).not.toHaveBeenCalled()

  // TD learning's breakdown makes Q-learning a shared prerequisite: only the
  // closing section is asked for again, the rest of the lesson kept.
  fireEvent.click(screen.getByText('expand: TD learning'))
  await waitFor(() => expect(fit).toHaveBeenCalledTimes(1))
  expect(fit.mock.calls[0][0]).toMatchObject({
    lesson: 'Q-learning learns values.',
    needed_by: [
      { title: 'Playing Atari', kind: 'paper', why: 'DQN approximates Q.' },
      { title: 'TD learning', kind: 'concept', why: 'TD needs Q targets.' },
    ],
  })
  await waitFor(() =>
    expect(course().nodes['q learning'].lesson).toBe(
      'Q-learning learns values.\n\n### How it fits in\n\nDQN fits Q; TD bootstraps on it.',
    ),
  )
  expect(course().nodes['q learning'].fitFor).toEqual(['playing atari', 'td learning'])
})

const PLACED = {
  slot: 1,
  image: '/api/web_image/abc',
  caption: 'The Q table',
  label: 'Image',
  title: 'RL notes',
  link: 'https://notes.example/q',
  description: 'Each cell holds a value.',
}

it('streams a lesson once the tutor writes, its images already in place', async () => {
  vi.spyOn(api, 'expandKnowledge')
    .mockResolvedValueOnce(ROOT_CHILDREN)
    .mockResolvedValueOnce([{ name: 'Q-learning', why: 'TD needs Q targets.' }])
  let write: () => void = () => undefined
  let finish: () => void = () => undefined
  const lesson = vi.spyOn(api, 'streamLesson').mockImplementation(
    (_body, handlers) =>
      new Promise<void>((resolve) => {
        handlers.onStep?.('Searching the web for a Q table…')
        // The image is placed before the text is written.
        write = () => {
          handlers.onImage?.(PLACED)
          handlers.onToken('Q-learning learns values.\n\n<<FIG 1>>\n\nIt updates a table.')
        }
        finish = () => {
          handlers.onToken('\n\n### How it fits in\n\nDQN fits Q.')
          handlers.onDone()
          resolve()
        }
      }),
  )
  const fit = vi.spyOn(api, 'fitLesson').mockResolvedValue('DQN fits Q; TD bootstraps on it.')
  const store = mount()
  const course = () => store.getState().explorations.byId.saved.threads[1].knowledge!
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('node: Q-learning'))

  // One status line while the tutor works, with the quick way out beside it.
  await screen.findByText('Searching the web for a Q table…')
  expect(screen.getByRole('button', { name: 'Quick response' })).toBeTruthy()
  // Written with images: told where the course paper's figures are.
  expect(lesson.mock.calls[0][0]).toMatchObject({
    item: { title: 'Q-learning', kind: 'concept' },
    paper: { id: 'DQN', arxiv_id: '1312.5602', title: 'Playing Atari' },
    provider: 's2',
  })
  expect(lesson.mock.calls[0][0].quick).toBeUndefined()
  expect(screen.queryByText('It updates a table.')).toBeNull()

  // Then it streams, the image already where it goes, before the lesson ends.
  act(() => write())
  expect(await screen.findByText('It updates a table.')).toBeTruthy()
  expect(screen.getByRole('figure')).toBeTruthy()
  expect(course().nodes['q learning'].lesson).toBeUndefined()
  act(() => finish())

  // Inline, after the paragraph it shows: described, with its credit linked.
  await waitFor(() => expect(course().nodes['q learning'].lesson).toBeDefined())
  const figure = screen.getByRole('figure')
  expect(figure.textContent).toContain('Each cell holds a value.')
  const credit = screen.getByRole('link', { name: 'RL notes' })
  expect(credit.getAttribute('href')).toBe('https://notes.example/q')
  const body = figure.closest('.lesson-body')!
  const order = Array.from(body.querySelectorAll('p, figure')).map((element) =>
    element.tagName === 'FIGURE' ? 'figure' : element.textContent,
  )
  expect(order.indexOf('figure')).toBe(order.indexOf('Q-learning learns values.') + 1)
  expect(screen.queryByText('Searching the web for a Q table…')).toBeNull()
  expect(course().nodes['q learning'].images).toEqual([PLACED])

  // A rewrite of the closing section reads the lesson without its markers,
  // and keeps them where they were.
  fireEvent.click(screen.getByText('expand: TD learning'))
  await waitFor(() => expect(fit).toHaveBeenCalledTimes(1))
  expect(fit.mock.calls[0][0].lesson).toBe('Q-learning learns values.\n\nIt updates a table.')
  await waitFor(() =>
    expect(course().nodes['q learning'].lesson).toContain('DQN fits Q; TD bootstraps on it.'),
  )
  expect(course().nodes['q learning'].lesson).toContain('<<FIG 1>>')
  expect(course().nodes['q learning'].images).toEqual([PLACED])
})

it('opens a lesson on its lead image, wherever the tutor put its marker (v8.32.0)', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValueOnce(ROOT_CHILDREN)
  const LEAD = { ...PLACED, slot: 2, caption: 'The Q-learning loop', lead: true }
  vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onImage?.(PLACED)
    handlers.onImage?.(LEAD)
    // The lead's marker lands mid-lesson; it still opens the lesson.
    handlers.onToken('Q-learning learns values.\n\n<<FIG 1>>\n\nIt updates a table.\n\n<<FIG 2>>')
    handlers.onDone()
  })
  const store = mount()
  const course = () => store.getState().explorations.byId.saved.threads[1].knowledge!
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('node: Q-learning'))
  await waitFor(() => expect(course().nodes['q learning'].lesson).toBeDefined())
  const body = (await screen.findByText('It updates a table.')).closest('.lesson-body')!
  const order = Array.from(body.querySelectorAll('p, figure')).map((element) =>
    element.tagName === 'FIGURE'
      ? element.textContent?.includes('loop')
        ? 'lead'
        : 'figure'
      : element.textContent,
  )
  expect(order).toEqual(['lead', 'Q-learning learns values.', 'figure', 'It updates a table.'])
})

it('a quick response stops the image search and writes the lesson now', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValueOnce(ROOT_CHILDREN)
  const signals: (AbortSignal | undefined)[] = []
  const lesson = vi.spyOn(api, 'streamLesson').mockImplementation((body, handlers) => {
    signals.push(handlers.signal)
    if (body.quick) {
      handlers.onToken('Quick lesson.')
      handlers.onDone()
      return Promise.resolve()
    }
    handlers.onStep?.('Looking at 4 images…')
    // The slow run, until it is stopped; a stopped fetch rejects.
    return new Promise<void>((_resolve, reject) =>
      handlers.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
    )
  })
  const store = mount()
  const course = () => store.getState().explorations.byId.saved.threads[1].knowledge!
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('node: Q-learning'))
  fireEvent.click(await screen.findByRole('button', { name: 'Quick response' }))

  expect(await screen.findByText('Quick lesson.')).toBeTruthy()
  expect(lesson).toHaveBeenCalledTimes(2)
  expect(lesson.mock.calls[1][0].quick).toBe(true)
  expect(signals[0]?.aborted).toBe(true)
  // The stopped run's failure isn't shown, and no image search is offered again.
  expect(screen.queryByText('aborted')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Quick response' })).toBeNull()
  expect(course().nodes['q learning'].images).toEqual([])
})

it('shows the tutor working as one line that unfolds into every step so far', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValueOnce(ROOT_CHILDREN)
  let finish: () => void = () => undefined
  vi.spyOn(api, 'streamLesson').mockImplementation(
    (_body, handlers) =>
      new Promise<void>((resolve) => {
        handlers.onStep?.('Searching your library, papers and the web for a Q table…')
        handlers.onStep?.('Looking at 6 images…')
        finish = () => {
          handlers.onToken('Done.')
          handlers.onDone()
          resolve()
        }
      }),
  )
  mount()
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('node: Q-learning'))
  // One line: the step now; the earlier ones folded away behind it.
  const line = await screen.findByRole('button', { name: /Looking at 6 images…/ })
  expect(screen.queryByRole('list', { name: 'Steps so far' })).toBeNull()
  fireEvent.click(line)
  const steps = screen.getByRole('list', { name: 'Steps so far' })
  expect(steps.textContent).toContain('Searching your library, papers and the web for a Q table…')
  expect(line.getAttribute('aria-expanded')).toBe('true')
  // Lessons in flight are tracked app-wide: finish this one so the next test starts clean.
  act(() => finish())
  await screen.findByText('Done.')
})

it('unfolds from the first step, before a second arrives (v8.32.1)', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValueOnce(ROOT_CHILDREN)
  let finish: () => void = () => undefined
  vi.spyOn(api, 'streamLesson').mockImplementation(
    (_body, handlers) =>
      new Promise<void>((resolve) => {
        // The opening image search: one step, held for the whole search.
        handlers.onStep?.('Searching your library, papers and the web for a Q table…')
        finish = () => {
          handlers.onToken('Done.')
          handlers.onDone()
          resolve()
        }
      }),
  )
  mount()
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('node: Q-learning'))
  const line = await screen.findByRole('button', { name: /Searching your library/ })
  expect((line as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(line)
  const steps = screen.getByRole('list', { name: 'Steps so far' })
  expect(steps.textContent).toContain('Searching your library, papers and the web for a Q table…')
  act(() => finish())
  await screen.findByText('Done.')
})

it('folds a long author list behind the shared disclosure (v8.32.1)', async () => {
  vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onToken('A lesson.')
    handlers.onDone()
  })
  const authors = Array.from({ length: 40 }, (_, index) => `Author ${index}`).join(', ')
  const map = createMap({ ...THREAD.paper!, authors })
  map.nodes[map.rootId].expanded = true
  mount(map)
  fireEvent.click(await screen.findByText('node: Playing Atari'))
  const toggle = await screen.findByRole('button', { name: /Show all authors/ })
  expect(screen.queryByText(/Author 39/)).toBeNull()
  fireEvent.click(toggle)
  expect(screen.getByText(/Author 39/)).toBeTruthy()
  expect(screen.getByText(/· 2013/)).toBeTruthy()
})

it('asks before breaking a concept down again, as on the paper (v8.26.0)', async () => {
  const expand = vi
    .spyOn(api, 'expandKnowledge')
    .mockResolvedValueOnce(ROOT_CHILDREN)
    .mockResolvedValueOnce([{ name: 'Bellman equations', why: 'Q-learning solves them.' }])
    .mockResolvedValueOnce([{ name: 'Value iteration', why: 'A fresh take.' }])
  vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onToken('A lesson.')
    handlers.onDone()
  })
  mount()
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('expand: Q-learning'))
  await screen.findByText('node: Bellman equations')
  fireEvent.click(screen.getByText('node: Q-learning'))

  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Break it down again…' }))
  expect(screen.getByRole('alertdialog', { name: 'Break this down again?' })).toBeTruthy()
  expect(expand).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: 'Break it down again' }))
  await screen.findByText('node: Value iteration')
  expect(expand).toHaveBeenLastCalledWith(expect.objectContaining({ fresh: true }))
})

it('hides undoably, and deletes for good only after asking (v8.26.0)', async () => {
  vi.spyOn(api, 'expandKnowledge')
    .mockResolvedValueOnce(ROOT_CHILDREN)
    .mockResolvedValueOnce([{ name: 'Bellman equations', why: 'Q-learning solves them.' }])
  vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onToken('A lesson.')
    handlers.onDone()
  })
  const store = mount()
  const course = () => store.getState().explorations.byId.saved.threads[1].knowledge!
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('expand: Q-learning'))
  await screen.findByText('node: Bellman equations')
  /** Pick one of the open item's ⋮ entries.
   * @param name The entry's name.
   */
  const fromMenu = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name }))
  }

  // Hide asks nothing, and Unhide on what needed it brings it back.
  fireEvent.click(screen.getByText('node: Bellman equations'))
  fromMenu('Hide this node')
  expect(course().nodes['bellman equations']).toBeUndefined()
  expect(screen.getByRole('status').textContent).toContain('Hid it')
  fireEvent.click(screen.getByText(/^node: Q-learning/))
  fromMenu('Unhide 1 child')
  expect(course().nodes['bellman equations']).toBeTruthy()

  // Delete permanently asks first; Cancel keeps it. (Back as it was: visited.)
  fireEvent.click(screen.getByText('node: Bellman equations (visited)'))
  fromMenu('Delete permanently…')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(course().nodes['bellman equations']).toBeTruthy()
  fromMenu('Delete permanently…')
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
  expect(course().nodes['bellman equations']).toBeUndefined()
  expect(screen.getByRole('status').textContent).toContain('Deleted it for good')
  // Nothing to unhide now.
  fireEvent.click(screen.getByText(/^node: Q-learning/))
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  expect(screen.queryByRole('menuitem', { name: /Unhide/ })).toBeNull()
})

it('rewrites a finished lesson from the ⋮ menu, past the cache', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValueOnce(ROOT_CHILDREN)
  const written = ['First lesson.', 'Second lesson.']
  const lesson = vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => {
    handlers.onImage?.(PLACED)
    handlers.onToken(`${written.shift()}\n\n<<FIG 1>>`)
    handlers.onDone()
  })
  const store = mount()
  const course = () => store.getState().explorations.byId.saved.threads[1].knowledge!
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('node: Q-learning'))
  expect(await screen.findByText('First lesson.')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rewrite this lesson' }))
  expect(await screen.findByText('Second lesson.')).toBeTruthy()
  expect(lesson).toHaveBeenCalledTimes(2)
  expect(lesson.mock.calls[1][0].fresh).toBe(true)
  // The new lesson brings its own images; nothing stays marked for a rewrite.
  expect(course().nodes['q learning'].images).toEqual([PLACED])
  expect(course().nodes['q learning'].freshLesson).toBeUndefined()
})

it('focuses like the citation graph: the open item holds, a lit neighbour hovers', async () => {
  vi.spyOn(api, 'expandKnowledge')
    .mockResolvedValueOnce(ROOT_CHILDREN)
    .mockResolvedValueOnce([{ name: 'Bellman equations', why: 'Q-learning solves them.' }])
  vi.spyOn(api, 'streamLesson').mockImplementation(async (_body, handlers) => handlers.onDone())
  mount()
  await screen.findByText('node: Q-learning')
  fireEvent.click(screen.getByText('expand: Q-learning'))
  await screen.findByText('node: Bellman equations')
  const isLit = (title: string) => !!screen.queryByText(`select: ${title} (lit)`)

  // Hover with nothing open lights the hovered item's links.
  fireEvent.mouseEnter(screen.getByText('hover: TD learning'))
  expect([isLit('TD learning'), isLit('Playing Atari'), isLit('Q-learning')]).toEqual([
    true,
    true,
    false,
  ])
  fireEvent.mouseLeave(screen.getByText('hover: TD learning'))
  expect(isLit('TD learning')).toBe(false)

  // Opening Q-learning holds its links lit.
  fireEvent.click(screen.getByText('node: Q-learning'))
  expect([isLit('Q-learning'), isLit('Bellman equations'), isLit('TD learning')]).toEqual([
    true,
    true,
    false,
  ])
  // Hovering a dimmed item changes nothing; hovering a lit one shows its links.
  fireEvent.mouseEnter(screen.getByText('hover: TD learning'))
  expect(isLit('TD learning')).toBe(false)
  fireEvent.mouseLeave(screen.getByText('hover: TD learning'))
  fireEvent.mouseEnter(screen.getByText('hover: Playing Atari'))
  expect(isLit('TD learning')).toBe(true)
  fireEvent.mouseLeave(screen.getByText('hover: Playing Atari'))

  // A Connections row lights its node like a hover, but alone with the open
  // item: not Playing Atari's neighbourhood (TD learning), and not the rest
  // of Q-learning's (Bellman equations).
  const row = screen.getByRole('button', { name: 'Playing Atari' }).closest('li')!
  fireEvent.mouseEnter(row)
  expect([
    isLit('Playing Atari'),
    isLit('Q-learning'),
    isLit('TD learning'),
    isLit('Bellman equations'),
  ]).toEqual([true, true, false, false])
  fireEvent.mouseLeave(row)
  expect(isLit('Bellman equations')).toBe(true)
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

it('previews navigation help on hover and focus, pins it on click, and closes with Escape', () => {
  render(<KnowledgeNavigationHelp />)
  const button = screen.getByRole('button', { name: '3D navigation help' })
  expect(screen.queryByRole('tooltip')).toBeNull()

  fireEvent.mouseEnter(button.parentElement!)
  expect(screen.getByRole('tooltip').textContent).toContain('Pan: right-drag')
  fireEvent.mouseLeave(button.parentElement!)
  expect(screen.queryByRole('tooltip')).toBeNull()

  fireEvent.focus(button)
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.blur(button)
  expect(screen.queryByRole('tooltip')).toBeNull()

  fireEvent.click(button)
  fireEvent.mouseLeave(button.parentElement!)
  fireEvent.blur(button)
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.keyDown(button, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).toBeNull()
  expect(button.getAttribute('aria-expanded')).toBe('false')

  fireEvent.click(button)
  expect(screen.getByRole('tooltip')).toBeTruthy()
  fireEvent.click(button)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

/** A course with the paper broken down and Q-learning's lesson open.
 * @returns The course.
 */
function openLessonCourse() {
  const course = withChildren(
    createMap({ id: 'DQN', title: 'Playing Atari' }),
    'playing atari',
    ROOT_CHILDREN,
  )
  return {
    ...course,
    openId: 'q learning',
    nodes: {
      ...course.nodes,
      'q learning': {
        ...course.nodes['q learning'],
        visited: true,
        lesson: 'Q-learning updates values with the Bellman backup.',
        fitFor: ['playing atari'],
      },
    },
  }
}

/** Highlight a phrase in the open lesson, as a reader's drag would, and let go.
 * @param phrase Text inside the lesson.
 */
async function highlight(phrase: string) {
  // jsdom lays nothing out; the pill only needs a box to sit by.
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(100, 200, 80, 16)
  const paragraph = screen.getByText(/Q-learning updates values/)
  const textNode = paragraph.firstChild!
  const start = textNode.textContent!.indexOf(phrase)
  const range = document.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, start + phrase.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.mouseUp(paragraph)
  await screen.findByRole('toolbar', { name: 'Highlighted text' })
}

it('expands a highlighted passage into a concept the lesson needs (v8.25.0)', async () => {
  let named: (child: { name: string; why: string }) => void = () => {}
  const phrase = vi.spyOn(api, 'expandPhrase').mockImplementation(
    () =>
      new Promise((resolve) => {
        named = resolve
      }),
  )
  const store = mount(openLessonCourse())
  await highlight('Bellman backup')
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Expand' }))
  // While the tutor names it, the item wears the breakdown's ring (v8.26.0).
  expect(screen.getByText('ringed: q learning')).toBeTruthy()
  await act(async () => named({ name: 'Bellman equations', why: 'Its update rule.' }))
  expect(screen.getByText(/^ringed:\s*$/)).toBeTruthy()
  expect(phrase.mock.calls[0][0]).toMatchObject({
    phrase: 'Bellman backup',
    item: { title: 'Q-learning', kind: 'concept' },
    path: [{ title: 'Playing Atari', kind: 'paper' }],
  })
  expect(await screen.findByText('node: Bellman equations')).toBeTruthy()
  const map = store.getState().explorations.byId.saved.threads[1].knowledge!
  expect(map.edges).toContainEqual({
    from: 'q learning',
    to: 'bellman equations',
    why: 'Its update rule.',
  })
  // The note names it, as a way to open it.
  const note = screen.getByText(/as something this needs/)
  fireEvent.click(within(note).getByRole('button', { name: 'Bellman equations' }))
  expect(store.getState().explorations.byId.saved.threads[1].knowledge!.openId).toBe(
    'bellman equations',
  )
})

it('chats about a highlighted passage: attached to the bar, sent with the question (v8.26.0)', async () => {
  vi.spyOn(api, 'listSources').mockResolvedValue({ available: false, sources: [] })
  const ask = vi.spyOn(api, 'streamAskCourse').mockImplementation(async (_body, handlers) => {
    handlers.onToken('Because it bootstraps.')
  })
  const store = configureStore({
    reducer: { workspace, transcript, explorations, library, highlight: highlightReducer },
  })
  const record = newExploration('saved')
  record.threads.push({ ...structuredClone(THREAD), knowledge: openLessonCourse() })
  record.activeThreadId = THREAD.id
  store.dispatch(explorationOpened(record))
  /** The lesson and the assistant side by side, the quote between them, as App has them. */
  function Harness() {
    const thread = useSelector((state: ReturnType<typeof store.getState>) =>
      state.explorations.byId.saved.threads.find((item) => item.id === THREAD.id),
    )!
    const [quote, setQuote] = useState<(PassageQuote & { seq: number }) | null>(null)
    return (
      <>
        <KnowledgeNetwork
          thread={thread}
          onAssistant={(next) =>
            next && setQuote({ text: next.text, from: lessonSource(next.lesson), seq: Date.now() })
          }
        />
        <Teacher quote={quote} onQuoteClear={() => setQuote(null)} />
      </>
    )
  }
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  )
  await highlight('Bellman backup')
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Chat' }))
  // Attached, not asked: the bar holds the passage and waits.
  const attached = screen.getByRole('group', { name: 'Attached passage' })
  expect(attached.textContent).toContain('“Bellman backup”')
  expect(attached.textContent).toContain('From the lesson on Q-learning')
  expect(ask).not.toHaveBeenCalled()
  const bar = screen.getByRole('textbox', { name: 'Ask the Knowledge Graph Assistant a question' })
  expect(document.activeElement).toBe(bar)
  // Backspace in the empty bar lets it go; Chat again brings it back.
  fireEvent.keyDown(bar, { key: 'Backspace' })
  expect(screen.queryByRole('group', { name: 'Attached passage' })).toBeNull()
  act(() => bar.blur())
  await highlight('Bellman backup')
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Chat' }))
  // The question goes with the passage, and the bar lets go of it.
  fireEvent.change(bar, { target: { value: 'Why is it called a backup?' } })
  fireEvent.keyDown(bar, { key: 'Enter' })
  await waitFor(() =>
    expect(selectConversation(store.getState()).chat.map((turn) => turn.text)).toEqual([
      'About this passage from the lesson on Q-learning:\n\n“Bellman backup”\n\nWhy is it called a backup?',
      'Because it bootstraps.',
    ]),
  )
  expect(screen.queryByRole('group', { name: 'Attached passage' })).toBeNull()
})

it('explains a highlighted passage in the course assistant without touching the graph', async () => {
  const ask = vi.spyOn(api, 'streamAskCourse').mockImplementation(async (_body, handlers) => {
    handlers.onToken('It is the update.')
  })
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  const record = newExploration('saved')
  record.threads.push({ ...structuredClone(THREAD), knowledge: openLessonCourse() })
  record.activeThreadId = THREAD.id
  store.dispatch(explorationOpened(record))
  const opened = vi.fn()
  /** As App renders it. */
  function Harness() {
    const thread = useSelector((state: ReturnType<typeof store.getState>) =>
      state.explorations.byId.saved.threads.find((item) => item.id === THREAD.id),
    )!
    return <KnowledgeNetwork thread={thread} onAssistant={opened} />
  }
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  )
  const before = store.getState().explorations.byId.saved.threads[1].knowledge!.edges.length
  await highlight('Bellman backup')
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Explain' }))
  expect(opened).toHaveBeenCalled()
  await waitFor(() =>
    expect(selectConversation(store.getState()).chat.map((turn) => turn.text)).toEqual([
      'Explain this passage from the lesson on Q-learning:\n\n“Bellman backup”',
      'It is the update.',
    ]),
  )
  expect(ask.mock.calls[0][0].course.open).toBe('Q-learning')
  expect(store.getState().explorations.byId.saved.threads[1].knowledge!.edges.length).toBe(before)
})

it('switches to the pyramid, whose legend adds Skipped, and remembers it', async () => {
  let course = createMap({ id: 'DQN', title: 'Playing Atari' })
  course = withChildren(course, course.rootId, ROOT_CHILDREN)
  mount({ ...course, known: [course.edges[0].to] })
  expect(screen.queryByText('Skipped')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open the course controls' }))
  fireEvent.click(screen.getByRole('button', { name: 'Pyramid' }))
  expect(await screen.findByText('Skipped')).toBeTruthy()
  expect(localStorage.getItem('ca.knowledge3d')).toBe('pyramid')
  fireEvent.click(screen.getByRole('button', { name: '2D' }))
  expect(screen.queryByText('Skipped')).toBeNull()
  expect(localStorage.getItem('ca.knowledge3d')).toBe('0')
  localStorage.removeItem('ca.knowledge3d')
})

it('rings a node while its lesson is written, and keeps the ring after the panel closes', async () => {
  vi.spyOn(api, 'expandKnowledge').mockResolvedValue(ROOT_CHILDREN)
  let finish: () => void = () => undefined
  vi.spyOn(api, 'streamLesson').mockImplementation(
    (_body, handlers) =>
      new Promise<void>((resolve) => {
        finish = () => {
          handlers.onToken('Q-learning learns values.')
          handlers.onDone()
          resolve()
        }
      }),
  )
  mount()
  fireEvent.click(await screen.findByText('node: Q-learning'))
  await waitFor(() => expect(screen.getByText(/^ringed:/).textContent).toContain('q learning'))
  // Closed with the lesson still streaming: the ring stays on the node.
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.getByText(/^ringed:/).textContent).toContain('q learning')
  act(() => finish())
  await waitFor(() => expect(screen.getByText(/^ringed:/).textContent).not.toContain('q learning'))
})
