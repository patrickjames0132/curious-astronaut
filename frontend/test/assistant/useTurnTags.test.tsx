// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A question's tag (v9.0.0): on every question, and a click
 * on it leaves the question as an anchor for the panel to keep in view, once.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { configureStore } from '@reduxjs/toolkit'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMsg } from '../../src/api'
import { takeTurnAnchor, useTurnTags } from '../../src/assistant/useTurnTags'
import explorations, { explorationOpened, newExploration } from '../../src/store/explorations'
import transcript from '../../src/store/transcript'
import workspace from '../../src/store/workspace'

afterEach(() => {
  vi.useRealTimers()
})

/** Tags for a chat's turns, over a store with one paper.
 * @param fullScreen The chat is shown full screen.
 * @returns The hook's tag props for each turn.
 */
function tagsFor(fullScreen = false) {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  const record = newExploration('x')
  record.threads.push({
    id: 'paper',
    title: 'Attention',
    identity: 's2:paper',
    data: { chat: [], layout: 'force' },
  })
  store.dispatch(explorationOpened(record))
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store }, children)
  return renderHook(() => useTurnTags('chat', fullScreen), { wrapper }).result.current
}

const asked: ChatMsg = {
  role: 'user',
  text: 'What is attention?',
  tag: { threadId: 'paper', title: 'Attention', tool: 'reader' },
}

describe('a question’s tag', () => {
  // Every question wears its tag, from a chat's first (Patrick, 2026-10-30):
  // they used to wait for the chat to cross views. An answer wears none.
  it('tags every question, an all-General chat’s too, and no answer', () => {
    const tags = tagsFor()
    expect(tags({ role: 'user', text: 'hello' }, 0).tagLabel).toBe('General')
    expect(tags({ role: 'assistant', text: 'Hi.' }, 1)).toEqual({})
  })

  it('leaves the clicked question as an anchor, taken once and only for its chat', () => {
    const tags = tagsFor()
    expect(tags({ role: 'user', text: 'hello' }, 0).tagLabel).toBe('General')
    tags(asked, 3).onTagOpen?.()
    expect(takeTurnAnchor('another chat')).toBeNull()
    expect(takeTurnAnchor('chat')).toBe(3)
    expect(takeTurnAnchor('chat')).toBeNull()
  })

  it('tags a bridge question General, linked to the chat, not its papers', () => {
    const bridge: ChatMsg = {
      role: 'user',
      text: 'How do they differ?',
      tag: {
        threadId: 'paper',
        title: 'Attention',
        tool: 'across',
        papers: [
          { threadId: 'paper', title: 'Attention' },
          { threadId: 'gone', title: 'Soft Actor-Critic' },
        ],
      },
    }
    const props = tagsFor()(bridge, 1)
    expect(props.tagLabel).toBe('General')
    props.onTagOpen?.()
    expect(takeTurnAnchor('chat')).toBe(1)
  })

  // Said in words, where it was asked and where a click goes (Patrick,
  // 2026-10-30): it was "Asked from General: go there".
  it('says where each was asked, and where a click goes', () => {
    const general: ChatMsg = { role: 'user', text: 'hello' }
    expect(tagsFor()(general, 0).tagHint).toBe(
      'Asked as a general question. Click to open this chat full screen.',
    )
    expect(tagsFor()(asked, 0).tagHint).toBe(
      'Asked about Attention in the Reader. Click to go there.',
    )
    const gone: ChatMsg = {
      role: 'user',
      text: 'What is it?',
      tag: { threadId: 'gone', title: 'Soft Actor-Critic', tool: 'graph' },
    }
    expect(tagsFor()(gone, 0)).toEqual({
      tagLabel: 'Soft Actor-Critic › Citation Graph',
      tagHint:
        'Asked about the Citation Graph of Soft Actor-Critic. That paper has since been deleted.',
    })
  })

  // Full screen, the chat is where a General tag leads already.
  it('full screen, a General tag goes nowhere and says only where it was asked', () => {
    const props = tagsFor(true)({ role: 'user', text: 'hello' }, 0)
    expect(props).toEqual({ tagLabel: 'General', tagHint: 'Asked as a general question.' })
    expect(tagsFor(true)(asked, 0).onTagOpen).toBeDefined()
  })

  it('lets a stale anchor go, so it never moves the chat later', () => {
    vi.useFakeTimers()
    const tags = tagsFor()
    tags(asked, 1).onTagOpen?.()
    vi.advanceTimersByTime(5000)
    expect(takeTurnAnchor('chat')).toBeNull()
  })
})
