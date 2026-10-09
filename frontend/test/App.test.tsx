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
import explorations from '../src/store/explorations'

vi.mock('../src/graph/GraphExplorer', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <main data-testid="explorer">{children}</main>
  ),
}))
vi.mock('../src/teacher/Teacher', () => ({
  default: ({ collapsed, onClose }: { collapsed?: boolean; onClose?: () => void }) => (
    <aside data-testid="teacher" data-collapsed={String(!!collapsed)}>
      {onClose && <button onClick={onClose}>Close assistant</button>}
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

it('docks the assistant beside the Citation Graph and nowhere else in a paper thread', async () => {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  const teacher = () => screen.getByTestId('teacher')
  const opener = () => screen.queryByRole('button', { name: 'Open the assistant' })
  // General: the assistant is the landing surface, never collapsed.
  expect(teacher().dataset.collapsed).toBe('false')
  expect(opener()).toBeNull()

  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'paper' }))
  })
  // On the graph it starts tucked away, with the 🎓 to open it.
  expect(teacher().dataset.collapsed).toBe('true')
  fireEvent.click(opener()!)
  expect(teacher().dataset.collapsed).toBe('false')

  // Open stays remembered, but the cards and the Knowledge Graph dock nothing.
  for (const tool of ['cards', 'knowledge'] as const) {
    await act(async () => {
      await store.dispatch(openTool(tool))
    })
    expect(screen.getByTestId(tool)).toBeTruthy()
    expect(teacher().dataset.collapsed).toBe('true')
    expect(opener()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close assistant' })).toBeNull()
  }

  // Back on the graph, it comes back as it was left: open.
  await act(async () => {
    await store.dispatch(openTool('graph'))
  })
  expect(teacher().dataset.collapsed).toBe('false')
  expect(screen.getAllByTestId('teacher')).toHaveLength(1)
})
