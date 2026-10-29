/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Regression tests for thread ownership and completed history.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { describe, expect, it } from 'vitest'
import { configureStore } from '@reduxjs/toolkit'
import {
  borrowedChats,
  conversationHistory,
  siblingContext,
  toHistoryTurn,
} from '../../src/teacher/history'
import workspace from '../../src/store/workspace'
import transcript from '../../src/store/transcript'
import highlight from '../../src/store/highlight'
import library from '../../src/store/library'
import explorations, { explorationOpened, newExploration } from '../../src/store/explorations'
import type { RootState } from '../../src/store'

describe('completed conversational history', () => {
  it('includes lecture prose and removes figure markers', () => {
    expect(
      toHistoryTurn({
        role: 'assistant',
        text: '',
        beats: [{ heading: 'Origins', text: 'Earlier work.\n<<FIG 1>>\nNext idea.', node_ids: [] }],
      }),
    ).toEqual({ role: 'assistant', content: 'Origins\nEarlier work.\nNext idea.' })
  })
  it('omits interrupted exchanges and retains the completed follow-up', () => {
    expect(
      conversationHistory([
        { role: 'user', text: 'abandoned' },
        { role: 'assistant', text: 'partial', unfinished: true },
        { role: 'user', text: 'question' },
        { role: 'assistant', text: 'answer' },
      ]),
    ).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ])
  })
})

describe('the sibling index: the other chats (v9.0.0)', () => {
  /** An exploration with two chats, beside a paper that holds no chat.
   * @returns The store's state, with the first chat open.
   */
  function state(): RootState {
    const store = configureStore({
      reducer: { workspace, transcript, highlight, library, explorations },
    })
    const record = newExploration('x')
    record.threads.push(
      {
        id: 'ppo',
        title: 'PPO',
        identity: 's2:ppo',
        data: { chat: [], layout: 'force' },
      },
      {
        id: 'rl',
        title: 'RL basics',
        identity: null,
        data: {
          chat: [
            { role: 'user', text: 'rl q' },
            { role: 'assistant', text: 'rl a' },
          ],
          layout: 'timeline',
        },
        summary: 'About RL.',
      },
    )
    store.dispatch(explorationOpened(record))
    return store.getState()
  }

  it('lists every other chat, under its title and summary, and never a paper', () => {
    const index = siblingContext(state(), 'hello')
    expect(index.map((entry) => [entry.title, entry.summary])).toEqual([['RL basics', 'About RL.']])
  })
  it('attaches a mentioned chat with its history', () => {
    const [entry] = siblingContext(state(), 'compare with @thread[RL basics]')
    expect(entry).toMatchObject({
      mentioned: true,
      history: [
        { role: 'user', content: 'rl q' },
        { role: 'assistant', content: 'rl a' },
      ],
    })
  })
  it('names the borrowed chats by key and title', () => {
    const current = state()
    const asking = current.explorations.byId.x.activeThreadId
    expect(borrowedChats(current, 'about @thread[RL basics]', asking)).toEqual([
      { id: 'rl', title: 'RL basics' },
    ])
  })
})
