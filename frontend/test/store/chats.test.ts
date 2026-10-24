/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Per-tool chats (v8.25.0) — keys, labels, which chats an exploration offers, and mentions old and new.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { describe, expect, it } from 'vitest'
import {
  chatKey,
  chatLabel,
  chatOf,
  chatTurns,
  explorationChats,
  mentionsChat,
} from '../../src/store/chats'
import { newExploration, type ThreadRecord } from '../../src/store/explorations'
import { createMap } from '../../src/knowledge/model'

/** A paper thread.
 * @param id Its id.
 * @param title Its title.
 * @param extra Anything else it holds.
 * @returns The thread.
 */
function paperThread(id: string, title: string, extra: Partial<ThreadRecord> = {}): ThreadRecord {
  return { id, title, identity: `s2:${id}`, data: { chat: [], layout: 'force' }, ...extra }
}

describe('chat keys', () => {
  it('keep the thread id for the Citation Graph, so older keys need no migration', () => {
    expect(chatKey('abc', 'graph')).toBe('abc')
    expect(chatKey('abc', 'knowledge')).toBe('abc:knowledge')
    expect(chatOf('abc')).toEqual({ threadId: 'abc', tool: 'graph' })
    expect(chatOf('abc:knowledge')).toEqual({ threadId: 'abc', tool: 'knowledge' })
    expect(chatKey('abc', 'reader')).toBe('abc:reader')
    expect(chatOf('abc:reader')).toEqual({ threadId: 'abc', tool: 'reader' })
  })
  it("label a paper thread's chats by tool, and General as itself", () => {
    expect(chatLabel(paperThread('ppo', 'PPO'), 'knowledge')).toBe('PPO › Knowledge Graph')
    expect(chatLabel(paperThread('ppo', 'PPO'), 'graph')).toBe('PPO › Citation Graph')
    expect(chatLabel({ title: 'General', identity: null }, 'graph')).toBe('General')
  })
})

describe('explorationChats', () => {
  it('offers a Knowledge Graph chat once the thread has a course or turns', () => {
    const record = newExploration('x')
    record.threads.push(
      paperThread('ppo', 'PPO', { knowledge: createMap({ id: 'ppo', title: 'PPO' }) }),
      paperThread('dqn', 'DQN'),
      paperThread('sac', 'SAC', { courseChat: { chat: [{ role: 'user', text: 'hi' }] } }),
    )
    const labels = explorationChats(record, { byKey: {} }).map((chat) => chat.label)
    expect(labels).toEqual([
      'New chat',
      'PPO › Citation Graph',
      'PPO › Knowledge Graph',
      'DQN › Citation Graph',
      'SAC › Citation Graph',
      'SAC › Knowledge Graph',
    ])
  })
  it('offers a Reader chat once it has turns (v8.38.0)', () => {
    const record = newExploration('x')
    record.threads.push(
      paperThread('att', 'Attention', { readerChat: { chat: [{ role: 'user', text: 'hi' }] } }),
      paperThread('dqn', 'DQN'),
    )
    const labels = explorationChats(record, { byKey: {} }).map((chat) => chat.label)
    expect(labels).toEqual([
      'New chat',
      'Attention › Citation Graph',
      'Attention › Reader',
      'DQN › Citation Graph',
    ])
  })
  it("reads a chat's live turns before its saved ones", () => {
    const thread = paperThread('sac', 'SAC', {
      courseChat: { chat: [{ role: 'user', text: 'old' }] },
    })
    const live = {
      'sac:knowledge': {
        chat: [{ role: 'user' as const, text: 'new' }],
        running: [],
        pendingDiscoveries: { nodes: [], edges: [] },
      },
    }
    expect(chatTurns({ byKey: live }, thread, 'knowledge')[0].text).toBe('new')
    expect(chatTurns({ byKey: {} }, thread, 'knowledge')[0].text).toBe('old')
  })
})

describe('mentionsChat', () => {
  it('matches a chat by its label, and a bare thread title as its Citation Graph chat', () => {
    const record = newExploration('x')
    record.threads.push(
      paperThread('ppo', 'PPO', { knowledge: createMap({ id: 'ppo', title: 'PPO' }) }),
    )
    const [, graph, knowledge] = explorationChats(record, { byKey: {} })
    expect(mentionsChat('compare @thread[PPO › Knowledge Graph]', knowledge)).toBe(true)
    expect(mentionsChat('compare @thread[PPO › Knowledge Graph]', graph)).toBe(false)
    // Sent before chats were per tool.
    expect(mentionsChat('compare @thread[PPO]', graph)).toBe(true)
    expect(mentionsChat('compare @thread[PPO]', knowledge)).toBe(false)
  })
})
