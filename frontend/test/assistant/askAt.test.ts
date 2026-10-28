/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Asking a question in a view that isn't on screen (v9.0.0, stage 4b): in
 * General, over a paper's parked Citation Graph or one built quietly, with
 * the question tagged where it was placed and where it was typed kept.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { configureStore } from '@reduxjs/toolkit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../src/api'
import type { GraphNode, GraphResponse } from '../../src/api'
import { askAt } from '../../src/assistant/askAt'
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import highlight from '../../src/store/highlight'
import library from '../../src/store/library'
import transcript, { selectConversation } from '../../src/store/transcript'
import workspace, { type WorkspaceState } from '../../src/store/workspace'

afterEach(() => {
  vi.restoreAllMocks()
})

const node = (id: string, seed = false) =>
  ({ id, title: id, rels: [], is_seed: seed }) as unknown as GraphNode
const GRAPH = {
  seed: node('atari', true),
  nodes: [node('atari', true), node('dqn')],
  edges: [],
  counts: {},
}

/** A chat on screen, with the Atari paper elsewhere.
 * @param parked The Atari thread's parked workspace, if it was visited.
 * @returns The store.
 */
function setUp(parked?: Partial<WorkspaceState>) {
  const store = configureStore({
    reducer: { workspace, transcript, explorations, highlight, library },
  })
  const record = newExploration('x')
  const atari: ThreadRecord = {
    id: 'atari',
    title: 'Playing Atari',
    identity: 's2:atari',
    data: {
      chat: [],
      layout: 'force',
      graph_ref: { seed: { id: 'atari', title: 'Playing Atari' }, seed_ref: 'atari' },
    },
    ...(parked && { workspace: parked as WorkspaceState }),
  }
  record.threads.push(atari)
  store.dispatch(explorationOpened(record))
  return store
}

const QUESTION = { threadId: '', question: 'What came before it?', provider: 's2' as const }

describe('asking where the router placed it', () => {
  it('asks General with paper search, untagged, keeping where it was typed', async () => {
    const store = setUp()
    const ask = vi.spyOn(api, 'streamAskSources').mockImplementation(async (_body, handlers) => {
      handlers.onToken('Search for it.')
    })
    await store.dispatch(askAt(undefined, { ...QUESTION, placedFrom: 'general' }))
    expect(ask).toHaveBeenCalledOnce()
    const [asked] = selectConversation(store.getState()).chat
    expect(asked.tag).toBeUndefined()
    expect(asked.placedFrom).toBe('general')
  })

  it('answers over a paper’s parked graph, tagged with it, its finds waiting on it', async () => {
    const store = setUp({ graph: GRAPH as unknown as GraphResponse, discoveredNodes: [] })
    const build = vi.spyOn(api, 'fetchGraphStream')
    const ask = vi.spyOn(api, 'streamAsk').mockImplementation(async (body, handlers) => {
      expect(body.seed.id).toBe('atari')
      expect(body.nodes.map((item) => item.id)).toEqual(['atari', 'dqn'])
      handlers.onDiscovery?.({ nodes: [{ ...node('nfq'), idx: 3 } as GraphNode], edges: [] })
      handlers.onToken('It built on [2] and [3].')
      handlers.onCited(['dqn'])
    })
    const tag = { threadId: 'atari', title: 'Playing Atari', tool: 'graph' as const }
    await store.dispatch(askAt(tag, QUESTION))
    expect(ask).toHaveBeenCalledOnce()
    expect(build).not.toHaveBeenCalled()
    const [asked, answer] = selectConversation(store.getState()).chat
    expect(asked.tag).toEqual(tag)
    expect(answer.graphRefs).toEqual({ 2: 'dqn', 3: 'nfq' })
    expect(answer.cited).toEqual(['dqn'])
    expect(store.getState().transcript.byKey.atari.pendingDiscoveries.nodes[0].id).toBe('nfq')
  })

  it('builds a graph it has never shown, without putting it on screen', async () => {
    const store = setUp()
    const build = vi
      .spyOn(api, 'fetchGraphStream')
      .mockResolvedValue(GRAPH as unknown as GraphResponse)
    vi.spyOn(api, 'streamAsk').mockImplementation(async (_body, handlers) => {
      handlers.onToken('Done.')
    })
    await store.dispatch(
      askAt({ threadId: 'atari', title: 'Playing Atari', tool: 'graph' }, QUESTION),
    )
    expect(build).toHaveBeenCalledWith('atari', 's2')
    expect(store.getState().workspace.graph).toBeNull()
  })
})
