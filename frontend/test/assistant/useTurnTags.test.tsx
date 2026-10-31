// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A question's tag (v9.0.0): shown once a chat crosses views, and a click
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

/** Tags for a chat, over a store with one paper.
 * @param chat The chat's turns.
 * @returns The hook's tag props for each turn.
 */
function tagsFor(chat: ChatMsg[]) {
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
  return renderHook(() => useTurnTags('chat', chat), { wrapper }).result.current
}

const asked: ChatMsg = {
  role: 'user',
  text: 'What is attention?',
  tag: { threadId: 'paper', title: 'Attention', tool: 'reader' },
}

describe('a question’s tag', () => {
  it('shows nothing until the chat crosses views', () => {
    const tags = tagsFor([{ role: 'user', text: 'hello' }])
    expect(tags({ role: 'user', text: 'hello' }, 0)).toEqual({})
  })

  it('leaves the clicked question as an anchor, taken once and only for its chat', () => {
    const tags = tagsFor([{ role: 'user', text: 'hello' }, asked])
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
    // Alone with General questions, it doesn't make the chat cross views.
    expect(tagsFor([{ role: 'user', text: 'hello' }, bridge])(bridge, 1)).toEqual({})
    const props = tagsFor([asked, bridge])(bridge, 1)
    expect(props.tagLabel).toBe('General')
    props.onTagOpen?.()
    expect(takeTurnAnchor('chat')).toBe(1)
  })

  it('lets a stale anchor go, so it never moves the chat later', () => {
    vi.useFakeTimers()
    const tags = tagsFor([asked])
    tags(asked, 1).onTagOpen?.()
    vi.advanceTimersByTime(5000)
    expect(takeTurnAnchor('chat')).toBeNull()
  })
})
