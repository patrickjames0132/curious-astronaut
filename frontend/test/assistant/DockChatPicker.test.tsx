// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The docked panel's chat picker (v9.0.0): it names the dock's chat, switches
 * to another without leaving the view, starts a new one (reusing an empty
 * one), and never docks a paper.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { configureStore } from '@reduxjs/toolkit'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it } from 'vitest'
import DockChatPicker from '../../src/assistant/DockChatPicker'
import explorations, {
  dockChatSet,
  explorationOpened,
  newExploration,
} from '../../src/store/explorations'
import { useAppSelector } from '../../src/store'
import highlight from '../../src/store/highlight'
import library from '../../src/store/library'
import transcript, { selectChatKey } from '../../src/store/transcript'
import workspace from '../../src/store/workspace'

afterEach(cleanup)

/** A store with two chats beside a paper, the paper on screen and the first chat docked.
 * @returns The store.
 */
function setUp() {
  const store = configureStore({
    reducer: { workspace, transcript, explorations, highlight, library },
  })
  const record = newExploration('x')
  record.threads[0].title = 'RL basics'
  record.threads.push(
    { id: 'second', title: 'Transformers', identity: null, data: { chat: [], layout: 'timeline' } },
    { id: 'paper', title: 'Attention', identity: 's2:paper', data: { chat: [], layout: 'force' } },
  )
  record.activeThreadId = 'paper'
  store.dispatch(explorationOpened(record))
  return store
}

/** The picker as a docked panel renders it: for whatever chat is docked.
 * @returns The picker.
 */
function Docked() {
  return <DockChatPicker chatId={useAppSelector(selectChatKey)} />
}

/** Render the picker for the dock's chat.
 * @param store The store.
 */
function mount(store: ReturnType<typeof setUp>) {
  render(
    <Provider store={store}>
      <Docked />
    </Provider>,
  )
}

describe('the dock’s chat picker', () => {
  it('switches the dock to another chat, and the paper stays on screen', () => {
    const store = setUp()
    mount(store)
    fireEvent.click(screen.getByRole('button', { name: /RL basics/ }))
    // A paper is never offered.
    expect(screen.queryByLabelText('Attention')).toBeNull()
    fireEvent.click(screen.getByLabelText('Transformers'))
    expect(selectChatKey(store.getState())).toBe('second')
    expect(store.getState().explorations.byId.x.activeThreadId).toBe('paper')
  })

  it('starts a new chat in the dock, reusing an empty one', () => {
    const store = setUp()
    mount(store)
    fireEvent.click(screen.getByRole('button', { name: /RL basics/ }))
    fireEvent.click(screen.getByRole('button', { name: '＋ New chat' }))
    const docked = selectChatKey(store.getState())
    const chat = store.getState().explorations.byId.x.threads.find((item) => item.id === docked)
    expect(chat?.title).toBe('New chat')
    expect(store.getState().explorations.byId.x.activeThreadId).toBe('paper')
    // Asked again, the empty one is reused rather than joined by another.
    fireEvent.click(screen.getByRole('button', { name: /New chat/ }))
    fireEvent.click(screen.getByRole('button', { name: '＋ New chat' }))
    expect(selectChatKey(store.getState())).toBe(docked)
  })

  it('deletes the docked chat in two clicks, and offers nothing with one chat left', () => {
    const store = setUp()
    mount(store)
    fireEvent.click(screen.getByRole('button', { name: 'Delete this chat' }))
    // Asked, not done.
    expect(store.getState().explorations.byId.x.threads).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Delete this chat?' }))
    const left = store.getState().explorations.byId.x.threads
    expect(left.map((thread) => thread.title)).toEqual(['Transformers', 'Attention'])
    // The dock falls back to the chat left, and one chat can't be deleted.
    expect(selectChatKey(store.getState())).toBe('second')
    expect(screen.queryByRole('button', { name: 'Delete this chat' })).toBeNull()
  })

  it('never docks a paper', () => {
    const store = setUp()
    const before = selectChatKey(store.getState())
    store.dispatch(dockChatSet('paper'))
    expect(selectChatKey(store.getState())).toBe(before)
  })
})

it('closes the chat menu with its ✕', () => {
  const store = setUp()
  mount(store)
  fireEvent.click(screen.getByRole('button', { name: /RL basics/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Close the chat picker' }))
  expect(screen.getByRole('button', { name: /RL basics/ }).getAttribute('aria-expanded')).toBe(
    'false',
  )
})
