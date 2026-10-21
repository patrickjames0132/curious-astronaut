// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Shared row controls and exploration-owned collapsible thread navigation.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider, useSelector } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'
import SideBar from '../../src/shell/SideBar'
import workspace, { loadGraph, openThread } from '../../src/store/workspace'
import transcript, { turnStarted } from '../../src/store/transcript'
import { takeDraft } from '../../src/teacher/composerDraft'
import explorations, { explorationOpened, newExploration } from '../../src/store/explorations'
import * as api from '../../src/api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Mount the actual sidebar with an exploration containing one graph.
 * @returns Store and parent record for navigation assertions.
 */
async function setup() {
  vi.spyOn(api, 'fetchGraphStream').mockResolvedValue({
    seed: { id: 'paper', title: 'Graph paper' },
    nodes: [],
    edges: [],
    counts: {},
  } as never)
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  const record = newExploration('saved')
  record.title = 'Saved exploration'
  store.dispatch(explorationOpened(record))
  await store.dispatch(loadGraph({ seed: 'paper' }))
  function Harness() {
    const activeId = useSelector(
      (state: ReturnType<typeof store.getState>) => state.explorations.activeId,
    )
    return (
      <SideBar
        open
        onToggle={() => {}}
        onOpenLibrary={() => {}}
        onNewGraph={() => store.dispatch(explorationOpened(newExploration()))}
        sessions={[{ id: record.id, name: record.title } as api.SavedSessionMeta]}
        openSessionId={activeId}
        onOpenSession={() => {}}
        onRenameSession={() => {}}
        onResummarizeSession={() => {}}
        onDeleteSession={() => {}}
        onOpenSettings={() => {}}
        onStartTour={() => {}}
        theme="dark"
        onToggleTheme={() => {}}
        provider="s2"
        onProviderChange={() => {}}
        loadingGraph={false}
      />
    )
  }
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  )
  return { store, record }
}

it('collapses children under their own parent and hides them when starting a new exploration', async () => {
  await setup()
  expect(screen.getByText('New chat')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Saved exploration' }))
  expect(screen.queryByText('New chat')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Expand Saved exploration' }))
  expect(screen.getByText('New chat')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'New Exploration' }))
  expect(screen.queryByText('New chat')).toBeNull()
  expect(screen.queryByText('Graph paper')).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Expand Saved exploration' }).getAttribute('aria-expanded'),
  ).toBe('false')
})

it('uses the existing menu and inline rename, then deletes a graph thread into General', async () => {
  const { store, record } = await setup()
  const graphId = store.getState().transcript.activeKey
  fireEvent.click(screen.getByRole('button', { name: 'Options for Graph paper' }))
  expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))
  const input = screen.getByRole('textbox', { name: 'Rename Graph paper' })
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  fireEvent.change(input, { target: { value: 'Renamed graph' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByText('Renamed graph')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Options for Renamed graph' }))
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ })))
  await waitFor(() => expect(screen.queryByText('Renamed graph')).toBeNull())
  expect(store.getState().transcript.activeKey).toBe(record.activeThreadId)
  expect(store.getState().workspace.graph).toBeNull()
  expect(store.getState().transcript.byKey[graphId]).toBeUndefined()
})

it('groups chats and papers, each with its ＋, and keeps the last chat undeletable', async () => {
  const { store } = await setup()
  expect(screen.getByRole('button', { name: 'Collapse Chats' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Collapse Papers' })).toBeTruthy()
  // The only chat: rename, but no Delete.
  fireEvent.click(screen.getByRole('button', { name: 'Options for New chat' }))
  expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Options for New chat' }))
  // The first chat is empty, so the ＋ reuses it rather than adding another.
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' })))
  expect(screen.queryByText('New chat (2)')).toBeNull()
  // Once it holds a turn, the ＋ adds one.
  await act(async () => {
    await store.dispatch(openThread(chatId(store)))
  })
  act(() => {
    store.dispatch(turnStarted('what is superposition?'))
  })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' })))
  await waitFor(() => expect(screen.getByText('New chat (2)')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Options for New chat (2)' }))
  expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy()
  // Folding a group hides its rows only.
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Papers' }))
  expect(screen.queryByText('Graph paper')).toBeNull()
  expect(screen.getByText('New chat (2)')).toBeTruthy()
})

it('the Papers ＋ opens a chat with @ typed, which stays a chat', async () => {
  const { store } = await setup()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Find a paper/ })))
  const state = store.getState()
  const record = state.explorations.byId[state.explorations.activeId]
  const active = record.threads.find((thread) => thread.id === record.activeThreadId)!
  expect(active.identity).toBeNull()
  // Addressed to the chat it opened, so the composer being left can't take it.
  expect(takeDraft('another-chat')).toBeNull()
  expect(takeDraft(active.id)).toBe('@')
})

/** The first chat's id.
 * @param store The test store.
 * @returns Its thread id.
 */
function chatId(store: { getState: () => { explorations: ReturnType<typeof explorations> } }) {
  const state = store.getState()
  const record = state.explorations.byId[state.explorations.activeId]
  return record.threads.find((thread) => !thread.identity)!.id
}

it('re-summarizes a chat from every question it holds; a paper has no Re-summarize', async () => {
  const { store } = await setup()
  await act(async () => {
    await store.dispatch(openThread(chatId(store)))
  })
  act(() => {
    store.dispatch(turnStarted('Attached: @Playing Atari\n\nwhat is a replay buffer?'))
    store.dispatch(turnStarted('and off-policy correction?'))
  })
  const titler = vi.spyOn(api, 'titleForConversation').mockResolvedValue('Off-policy learning')
  fireEvent.click(screen.getByRole('button', { name: 'Options for New chat' }))
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: /Re-summarize/ })))
  expect(titler).toHaveBeenCalledWith(['what is a replay buffer?', 'and off-policy correction?'])
  await waitFor(() => expect(screen.getByText('Off-policy learning')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Options for Graph paper' }))
  expect(screen.queryByRole('menuitem', { name: /Re-summarize/ })).toBeNull()
})
