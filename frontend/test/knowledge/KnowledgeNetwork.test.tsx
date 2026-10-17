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
import { KnowledgeNavigationHelp } from '../../src/knowledge/KnowledgeControls'
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
  default: ({ map, selected, lit, onOpen, onExpand, onSelect, onHover }: KnowledgeGraphProps) => (
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
  expect(lesson.mock.calls[0][0]).not.toHaveProperty('provider')
  // Connections (v8.23.0): what needs it, as a plain link; the reason goes
  // to the tutor (for the lesson's "How it fits in"), not the card.
  const requiredFor = screen.getByRole('list', { name: 'Builds toward' })
  expect(requiredFor.textContent).toContain('Playing Atari')
  expect(screen.queryByText('DQN approximates Q.')).toBeNull()
  expect(lesson.mock.calls[0][0].needed_by).toEqual([
    { title: 'Playing Atari', kind: 'paper', why: 'DQN approximates Q.' },
  ])
  // A row's name opens that item; the card folds away.
  const head = screen.getByRole('button', { name: 'Connections' })
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

  fireEvent.click(screen.getByRole('button', { name: 'Unknown' }))

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
  fireEvent.click(screen.getByRole('button', { name: 'Unknown' }))
  const knownNow = store.getState().explorations.byId.saved.threads[1].knowledge!
  expect(knownNow.known).toContain('synthesis:bootstrapped value learning')
  expect(document.querySelector('.lesson-kicker.known')?.textContent).toContain('Known')
  const knownButton = screen.getByRole('button', { name: 'Known' })
  expect(knownButton.getAttribute('aria-pressed')).toBe('true')
  // Its bulb pops in on the click itself.
  expect(knownButton.classList.contains('pop')).toBe(true)
  expect(knownButton.textContent).toContain('💡')
  // Taken back, it reads Unknown with its 🤔, which animates in too.
  fireEvent.click(knownButton)
  const unknownButton = screen.getByRole('button', { name: 'Unknown' })
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

  // Deleting it takes it off the course and closes its panel.
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
  expect(screen.getByRole('button', { name: 'Delete' }).hasAttribute('disabled')).toBe(true)
  // With it, the rest go (Delete key), and what only Q-learning needed with them.
  fireEvent.click(screen.getByText(/^select: Q-learning/))
  fireEvent.click(screen.getByText(/^select: TD learning/))
  fireEvent.keyDown(window, { key: 'Delete' })
  expect(Object.keys(course().nodes)).toEqual(['playing atari'])
  expect(screen.getByRole('status').textContent).toContain('Deleted 2 items and 1 more with them')

  // The paper's "Break it down" says how many return, and brings them back
  // from what it remembers; Q-learning's own breakdown waits behind its count.
  fireEvent.click(screen.getByText('node: Playing Atari'))
  fireEvent.click(screen.getByRole('button', { name: '+ Break it down 2' }))
  expect(Object.keys(course().nodes).sort()).toEqual(['playing atari', 'q learning', 'td learning'])
  expect(course().nodes['q learning'].expanded).toBe(true)
  expect(expand).toHaveBeenCalledTimes(2)

  // "Break it down again" asks for a fresh one, past the server's cache; on
  // the paper it asks first, and Cancel leaves the course alone.
  fireEvent.click(screen.getByRole('button', { name: '↻ Break it down again' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(expand).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '↻ Break it down again' }))
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
