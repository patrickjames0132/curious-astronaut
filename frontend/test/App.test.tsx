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
vi.mock('../src/knowledge/assistant/CourseAssistant', () => ({
  default: ({ collapsed, onClose }: { collapsed: boolean; onClose: () => void }) => (
    <aside data-testid="course-assistant" data-collapsed={String(collapsed)}>
      <button onClick={onClose}>Close course assistant</button>
    </aside>
  ),
}))
vi.mock('../src/reader/Reader', () => ({
  default: ({ children }: { children: ReactNode }) => <main data-testid="reader">{children}</main>,
}))
vi.mock('../src/reader/ReaderAssistant', () => ({
  default: ({ collapsed, onClose }: { collapsed: boolean; onClose: () => void }) => (
    <aside data-testid="reader-assistant" data-collapsed={String(collapsed)}>
      <button onClick={onClose}>Close reader assistant</button>
    </aside>
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

it('docks the course assistant beside the Knowledge Graph alone (v8.25.0)', async () => {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  // General has no course, so no course assistant.
  expect(screen.queryByTestId('course-assistant')).toBeNull()
  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'paper' }))
  })
  const course = () => screen.getByTestId('course-assistant')
  const opener = () => screen.queryByRole('button', { name: 'Open the Knowledge Graph Assistant' })
  // Beside the Citation Graph it stays tucked away, with no 🎓 of its own.
  expect(course().dataset.collapsed).toBe('true')
  expect(opener()).toBeNull()
  await act(async () => {
    await store.dispatch(openTool('knowledge'))
  })
  expect(course().dataset.collapsed).toBe('true')
  fireEvent.click(opener()!)
  expect(course().dataset.collapsed).toBe('false')
  // The Citation Graph's assistant stays put while it is open.
  expect(screen.getByTestId('teacher').dataset.collapsed).toBe('true')
  // Remembered across tools: away on the cards, open again on the course.
  await act(async () => {
    await store.dispatch(openTool('cards'))
  })
  expect(course().dataset.collapsed).toBe('true')
  await act(async () => {
    await store.dispatch(openTool('knowledge'))
  })
  expect(course().dataset.collapsed).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Close course assistant' }))
  expect(course().dataset.collapsed).toBe('true')
})

it('docks the Reader Assistant beside the Reader alone (v8.38.0)', async () => {
  localStorage.removeItem('ca.readerAssistantOpen')
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  expect(screen.queryByTestId('reader-assistant')).toBeNull()
  await act(async () => {
    await store.dispatch(loadGraph({ seed: 'paper' }))
  })
  const reader = () => screen.getByTestId('reader-assistant')
  const opener = () => screen.queryByRole('button', { name: 'Open the Reader Assistant' })
  // Beside the Citation Graph or the course it stays tucked away, no 🎓.
  expect(reader().dataset.collapsed).toBe('true')
  expect(opener()).toBeNull()
  await act(async () => {
    await store.dispatch(openTool('knowledge'))
  })
  expect(opener()).toBeNull()
  await act(async () => {
    await store.dispatch(openTool('reader'))
  })
  expect(reader().dataset.collapsed).toBe('true')
  fireEvent.click(opener()!)
  expect(reader().dataset.collapsed).toBe('false')
  // The other assistants stay put while it is open.
  expect(screen.getByTestId('teacher').dataset.collapsed).toBe('true')
  expect(screen.getByTestId('course-assistant').dataset.collapsed).toBe('true')
  // Remembered across tools: away on the cards, open again in the Reader.
  await act(async () => {
    await store.dispatch(openTool('cards'))
  })
  expect(reader().dataset.collapsed).toBe('true')
  await act(async () => {
    await store.dispatch(openTool('reader'))
  })
  expect(reader().dataset.collapsed).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Close reader assistant' }))
  expect(reader().dataset.collapsed).toBe('true')
})
