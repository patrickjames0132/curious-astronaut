// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Shell reconciliation across repeated graph and General thread navigation, and
 * where the assistant docks.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../src/App'
import workspace, { activateThread, loadGraph, openTool } from '../src/store/workspace'
import transcript from '../src/store/transcript'
import explorations, { threadReturnSet } from '../src/store/explorations'

vi.mock('../src/graph/GraphExplorer', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <main data-testid="explorer">{children}</main>
  ),
}))
vi.mock('../src/teacher/Teacher', () => ({
  default: ({
    collapsed,
    onClose,
    dock,
    onDockChange,
  }: {
    collapsed?: boolean
    onClose?: () => void
    dock?: 'right' | 'bottom'
    onDockChange?: (dock: 'right' | 'bottom') => void
  }) => (
    <aside data-testid="teacher" data-collapsed={String(!!collapsed)} data-dock={dock}>
      {onClose && <button onClick={onClose}>Close assistant</button>}
      {onDockChange && (
        <button onClick={() => onDockChange(dock === 'right' ? 'bottom' : 'right')}>
          Flip dock
        </button>
      )}
    </aside>
  ),
}))
vi.mock('../src/tools/ToolCards', () => ({
  default: ({ children }: { children: ReactNode }) => <main data-testid="cards">{children}</main>,
}))
vi.mock('../src/knowledge/KnowledgeNetwork', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <main data-testid="knowledge">{children}</main>
  ),
}))
vi.mock('../src/reader/Reader', () => ({
  default: ({ children }: { children: ReactNode }) => <main data-testid="reader">{children}</main>,
}))
vi.mock('../src/criticisms/Criticisms', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <main data-testid="criticisms">{children}</main>
  ),
}))
vi.mock('../src/shell/SideBar', () => ({ default: () => null }))
vi.mock('../src/library/Sources', () => ({ default: () => null }))
vi.mock('../src/settings/SettingsModal', () => ({ default: () => null }))
vi.mock('../src/tour/Tour', () => ({ default: () => null }))
vi.mock('../src/shell/useExplorations', () => ({
  useExplorations: () => ({ sessions: [], working: [] }),
}))
vi.mock('../src/api', async (original) => ({
  ...(await original<typeof import('../src/api')>()),
  getSettings: vi.fn().mockRejectedValue(new Error('Offline test')),
  fetchGraphStream: vi.fn(async (seed: string) => ({
    seed: { id: seed, title: seed },
    nodes: [{ id: seed, rels: [], is_seed: true }],
    edges: [],
    counts: {},
  })),
}))
afterEach(() => {
  cleanup()
  localStorage.clear()
})
it('replaces the explorer rather than accumulating sibling panels when threads change', async () => {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  const general = store.getState().transcript.activeKey
  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'first' }))
  })
  const first = store.getState().transcript.activeKey
  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'second' }))
  })
  const second = store.getState().transcript.activeKey
  for (const key of [general, first, general, second, first, second, general, first]) {
    await act(async () => {
      await store.dispatch(activateThread(key))
    })
    expect(screen.queryAllByTestId('explorer')).toHaveLength(key === general ? 0 : 1)
    expect(screen.getAllByTestId('teacher')).toHaveLength(1)
  }
})

it('docks one assistant beside every view of a paper, behind one launcher when closed (v9.0.0)', async () => {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  const teacher = () => screen.getByTestId('teacher')
  const opener = () => screen.queryByRole('button', { name: 'Open the assistant' })
  // A chat: the assistant is the landing surface, never collapsed.
  expect(teacher().dataset.collapsed).toBe('false')
  expect(opener()).toBeNull()

  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'paper' }))
  })
  // Beside a paper it starts tucked away, with the astronaut to open it.
  expect(teacher().dataset.collapsed).toBe('true')
  fireEvent.click(opener()!)
  expect(teacher().dataset.collapsed).toBe('false')

  // Open beside every view, one panel throughout, no astronaut while it is.
  for (const tool of ['cards', 'knowledge', 'reader', 'reviews', 'graph'] as const) {
    await act(async () => {
      await store.dispatch(openTool(tool))
    })
    expect(teacher().dataset.collapsed).toBe('false')
    expect(opener()).toBeNull()
    expect(screen.getAllByTestId('teacher')).toHaveLength(1)
  }
  // Closed, the astronaut is back, over whichever view.
  fireEvent.click(screen.getByRole('button', { name: 'Close assistant' }))
  expect(teacher().dataset.collapsed).toBe('true')
  await act(async () => {
    await store.dispatch(openTool('reader'))
  })
  expect(opener()).toBeTruthy()
})

it('docks on the right or along the bottom, and remembers which (v9.0.0)', async () => {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  const { container } = render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'paper' }))
  })
  const body = () => container.querySelector('.shell-body')!
  expect(screen.getByTestId('teacher').dataset.dock).toBe('right')
  expect(body().classList.contains('dock-bottom')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Flip dock' }))
  expect(screen.getByTestId('teacher').dataset.dock).toBe('bottom')
  expect(body().classList.contains('dock-bottom')).toBe(true)
  expect(localStorage.getItem('ca.assistantDock')).toBe('bottom')
})

it('puts “Back to reading” in the ↑’s place after a lesson opened from the Reader (v8.44.0)', async () => {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'paper' }))
    await store.dispatch(openTool('reader'))
  })
  const state = store.getState().explorations
  const id = state.byId[state.activeId].activeThreadId
  await act(async () => {
    store.dispatch(threadReturnSet({ id, returnTo: { tool: 'reader', from: 'knowledge' } }))
    await store.dispatch(openTool('knowledge'))
  })
  // One way out, not two look-alike buttons side by side (Patrick).
  expect(screen.queryByRole('button', { name: 'Back to this paper’s cards' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Back to reading' }))
  await screen.findByTestId('reader')
  // Back in the Reader, the way back is spent; its ↑ is its own now, at
  // the top of the paper (the Reader is mocked here), never floating over it.
  expect(screen.queryByRole('button', { name: 'Back to reading' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Back to this paper’s cards' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Back to reading' })).toBeNull()
})

it('puts “Back to Criticisms” in the ↑’s place after a citing paper shown from them', async () => {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'paper' }))
    await store.dispatch(openTool('reviews'))
  })
  const state = store.getState().explorations
  const id = state.byId[state.activeId].activeThreadId
  await act(async () => {
    store.dispatch(threadReturnSet({ id, returnTo: { tool: 'reviews', from: 'graph' } }))
    await store.dispatch(openTool('graph'))
  })
  expect(screen.queryByRole('button', { name: 'Back to this paper’s cards' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Back to reading' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Back to Criticisms' }))
  await screen.findByTestId('criticisms')
  // Back on Criticisms the way back is spent, and the app draws no ↑ of its
  // own: the card draws it (with Back to top), as the Reader does.
  expect(screen.queryByRole('button', { name: 'Back to Criticisms' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Back to this paper’s cards' })).toBeNull()
})

it('opens the dock when the full-screen chat takes the reader to a paper (v9.0.0)', async () => {
  const { KEEP_CHAT_EVENT } = await import('../src/assistant/keepChatInView')
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'paper' }))
  })
  expect(screen.getByTestId('teacher').dataset.collapsed).toBe('true')
  act(() => {
    window.dispatchEvent(new Event(KEEP_CHAT_EVENT))
  })
  expect(screen.getByTestId('teacher').dataset.collapsed).toBe('false')
})
