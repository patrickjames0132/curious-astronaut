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
import { createMap, withChildren } from '../../src/knowledge/model'
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

describe('the sibling index, one entry per chat (v8.25.0)', () => {
  /** An exploration with General and PPO, whose course and both chats have turns.
   * @returns The store's state.
   */
  function state(): RootState {
    const store = configureStore({
      reducer: { workspace, transcript, highlight, library, explorations },
    })
    const record = newExploration('x')
    const course = withChildren(createMap({ id: 'ppo', title: 'PPO' }), 'ppo', [
      { name: 'Policy gradients', why: 'PPO is one.' },
    ])
    record.threads.push({
      id: 'ppo',
      title: 'PPO',
      identity: 's2:ppo',
      data: {
        chat: [
          { role: 'user', text: 'graph q' },
          { role: 'assistant', text: 'graph a' },
        ],
        layout: 'force',
      },
      summary: 'About the graph.',
      knowledge: {
        ...course,
        nodes: { ...course.nodes, ppo: { ...course.nodes.ppo, lesson: 'Lesson.' } },
      },
      courseChat: {
        chat: [
          { role: 'user', text: 'course q' },
          { role: 'assistant', text: 'course a' },
        ],
        summary: 'About the course.',
      },
    })
    store.dispatch(explorationOpened(record))
    return store.getState()
  }

  it('lists every other chat, each under its own label and summary', () => {
    const current = state()
    const general = current.explorations.byId.x.activeThreadId
    const index = siblingContext(current, 'hello', general)
    expect(index.map((entry) => [entry.title, entry.summary])).toEqual([
      ['PPO › Citation Graph', 'About the graph.'],
      ['PPO › Knowledge Graph', 'About the course.'],
    ])
  })
  it("lets the course assistant read its own thread's Citation Graph chat", () => {
    const index = siblingContext(
      state(),
      'compare with @thread[PPO › Citation Graph]',
      'ppo:knowledge',
    )
    expect(index.map((entry) => entry.title)).toEqual(['PPO › Citation Graph', 'New chat'])
    expect(index[0]).toMatchObject({
      mentioned: true,
      history: [
        { role: 'user', content: 'graph q' },
        { role: 'assistant', content: 'graph a' },
      ],
    })
  })
  it('attaches a mentioned course chat with its course outline, lessons left out', () => {
    const [entry] = siblingContext(state(), 'see @thread[PPO › Knowledge Graph]', 'ppo')
    expect(entry.title).toBe('PPO › Knowledge Graph')
    expect(entry.history?.map((turn) => turn.content)).toEqual(['course q', 'course a'])
    expect(entry.course?.items.map((item) => item.title)).toEqual(['PPO', 'Policy gradients'])
    expect(entry.course?.items.some((item) => item.lesson)).toBe(false)
  })
  it('names the borrowed chats by key and label, a bare title as the Citation Graph chat', () => {
    expect(borrowedChats(state(), 'about @thread[PPO]', 'ppo:knowledge')).toEqual([
      { id: 'ppo', title: 'PPO › Citation Graph' },
    ])
  })
})
