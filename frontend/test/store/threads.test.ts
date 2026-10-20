/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Regression tests for thread ownership and completed history.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it, vi } from 'vitest'
import workspace, {
  activateThread,
  loadGraph,
  nodeSelectionSet,
  openPaper,
  openThread,
  openTool,
  seedPaper,
  switchProvider,
} from '../../src/store/workspace'
import * as api from '../../src/api'
import transcript, {
  conversationEnsured,
  tokenAppended,
  turnStarted,
} from '../../src/store/transcript'
import explorations, {
  explorationOpened,
  newExploration,
  threadTool,
} from '../../src/store/explorations'
import { migrateExploration, explorationBody } from '../../src/store/threadPersistence'
import type { GraphResponse, SavedSession } from '../../src/api'

vi.mock('../../src/api', async (original) => ({
  ...(await original<typeof import('../../src/api')>()),
  fetchGraphStream: vi.fn(async (seed: string) => graph(seed)),
  // The lookup resolves an arXiv-style alias to the provider id, as S2 does.
  fetchPaperDetail: vi.fn(async (seed: string) => ({
    id: seed.replace(/^arxiv:/, ''),
    title: `Paper ${seed}`,
    arxiv_id: null,
    year: 2013,
    citation_count: 1,
    url: null,
    tldr: 'A short summary.',
  })),
}))

function graph(id: string): GraphResponse {
  return {
    seed: { id, title: id, arxiv_id: null },
    nodes: [{ id, title: id, url: '', is_seed: true, rels: [], citation_count: 1, year: 2020 }],
    edges: [],
    counts: {},
  } as GraphResponse
}
function makeStore() {
  return configureStore({ reducer: { workspace, transcript, explorations } })
}
/** The thread on screen in a test store.
 * @param store The store.
 * @returns The active thread record.
 */
function activeThread(store: ReturnType<typeof makeStore>) {
  const state = store.getState()
  const record = state.explorations.byId[state.explorations.activeId]
  return record.threads.find((thread) => thread.id === record.activeThreadId)!
}

describe('thread ownership', () => {
  it('keeps General graphless, restores graph selections, and routes background tokens to their owner', async () => {
    const store = makeStore()
    const record = newExploration('explore')
    store.dispatch(explorationOpened(record))
    const general = record.activeThreadId
    store.dispatch(turnStarted('general question'))
    await store.dispatch(loadGraph({ seed: 'DQN' }))
    const dqn = store.getState().transcript.activeKey
    expect(dqn).not.toBe(general)
    store.dispatch(nodeSelectionSet(['DQN']))
    store.dispatch(turnStarted('DQN question'))
    await store.dispatch(loadGraph({ seed: 'PPO' }))
    store.dispatch(tokenAppended('DQN background answer', dqn))
    expect(store.getState().transcript.byKey[dqn].chat.at(-1)?.text).toBe('DQN background answer')
    expect(store.getState().transcript.byKey[store.getState().transcript.activeKey].chat).toEqual(
      [],
    )
    await store.dispatch(activateThread(dqn))
    expect(store.getState().workspace.graph?.seed.id).toBe('DQN')
    expect(store.getState().workspace.selectedNodeIds).toEqual(['DQN'])
    await store.dispatch(activateThread(general))
    expect(store.getState().workspace.graph).toBeNull()
    expect(store.getState().transcript.byKey[general].chat[0].text).toBe('general question')
  })
  it('reuses graph threads by resolved seed and provider', async () => {
    const store = makeStore()
    await store.dispatch(loadGraph({ seed: 'same', provider: 's2' }))
    const first = store.getState().transcript.activeKey
    await store.dispatch(loadGraph({ seed: 'same', provider: 'openalex' }))
    expect(store.getState().transcript.activeKey).not.toBe(first)
    await store.dispatch(loadGraph({ seed: 'same', provider: 's2' }))
    expect(store.getState().transcript.activeKey).toBe(first)
    const record = store.getState().explorations.byId[store.getState().explorations.activeId]
    expect(record.threads).toHaveLength(3)
  })
})

describe('card home', () => {
  it('opens a paper thread on its cards without building a graph, then builds it in place', async () => {
    const store = makeStore()
    vi.mocked(api.fetchGraphStream).mockClear()
    await store.dispatch(openPaper({ seed: 'arxiv:DQN' }))
    const thread = activeThread(store)
    expect(thread.identity).toBe('s2:DQN')
    expect(threadTool(thread)).toBe('cards')
    expect(thread.paper?.tldr).toBe('A short summary.')
    expect(store.getState().workspace.graph).toBeNull()
    expect(api.fetchGraphStream).not.toHaveBeenCalled()

    await store.dispatch(openTool('graph'))
    expect(api.fetchGraphStream).toHaveBeenCalledWith('arxiv:DQN', 's2', false, expect.anything())
    // The mock build keeps the alias as its seed id ('arxiv:DQN') while the
    // lookup resolved 'DQN': the disagreement case. The same thread still
    // owns the graph — no twin keyed by the build's id.
    expect(activeThread(store).id).toBe(thread.id)
    expect(threadTool(activeThread(store))).toBe('graph')
    const record = store.getState().explorations.byId[store.getState().explorations.activeId]
    expect(record.threads).toHaveLength(2)

    // Back to the cards keeps the graph in memory; reopening costs nothing.
    store.dispatch(openTool('cards'))
    vi.mocked(api.fetchGraphStream).mockClear()
    await store.dispatch(openTool('graph'))
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    expect(store.getState().workspace.graph?.seed.id).toBe('arxiv:DQN')
  })
  it('lands on the graph from the graph tool, and on the cards from anywhere else', async () => {
    const store = makeStore()
    await store.dispatch(seedPaper({ seed: 'DQN' }))
    expect(threadTool(activeThread(store))).toBe('cards')
    await store.dispatch(openTool('graph'))
    await store.dispatch(seedPaper({ seed: 'PPO' }))
    expect(activeThread(store).identity).toBe('s2:PPO')
    expect(threadTool(activeThread(store))).toBe('graph')
    expect(store.getState().workspace.graph?.seed.id).toBe('PPO')
  })
  it('resumes a thread on the tool it last showed, building only a graph-tool thread', async () => {
    const store = makeStore()
    const general = activeThread(store).id
    await store.dispatch(openPaper({ seed: 'DQN' }))
    const cards = activeThread(store).id
    await store.dispatch(loadGraph({ seed: 'PPO' }))
    const graphThread = activeThread(store).id
    await store.dispatch(activateThread(general))
    vi.mocked(api.fetchGraphStream).mockClear()
    await store.dispatch(activateThread(cards))
    expect(store.getState().workspace.graph).toBeNull()
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    await store.dispatch(activateThread(graphThread))
    expect(store.getState().workspace.graph?.seed.id).toBe('PPO')
    // Re-opening an already-open paper resumes its thread instead of a lookup.
    vi.mocked(api.fetchPaperDetail).mockClear()
    await store.dispatch(openPaper({ seed: 'DQN' }))
    expect(activeThread(store).id).toBe(cards)
    expect(api.fetchPaperDetail).not.toHaveBeenCalled()
  })
  it('opens a thread from the rail onto its cards, without rebuilding its graph', async () => {
    const store = makeStore()
    const general = activeThread(store).id
    await store.dispatch(loadGraph({ seed: 'PPO' }))
    const graphThread = activeThread(store).id
    expect(threadTool(activeThread(store))).toBe('graph')
    await store.dispatch(activateThread(general))
    vi.mocked(api.fetchGraphStream).mockClear()
    await store.dispatch(openThread(graphThread))
    expect(activeThread(store).id).toBe(graphThread)
    expect(threadTool(activeThread(store))).toBe('cards')
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    // The graph it rested on is still in memory: its card reopens it as it was.
    await store.dispatch(openTool('graph'))
    expect(store.getState().workspace.graph?.seed.id).toBe('PPO')
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    // Clicking the thread already on screen goes back up to its cards too.
    await store.dispatch(openThread(graphThread))
    expect(threadTool(activeThread(store))).toBe('cards')
    // General has no cards; opening it is a plain switch.
    await store.dispatch(openThread(general))
    expect(threadTool(activeThread(store))).toBeNull()
  })
  it('never parks an in-flight paper open with the thread it left', async () => {
    // The lookup is still running when the new thread takes over, so the
    // outgoing General's workspace is parked with its request id — and used
    // to come back showing "Opening paper…" forever.
    const store = makeStore()
    const general = activeThread(store).id
    await store.dispatch(openPaper({ seed: 'DQN' }))
    expect(store.getState().workspace.openRequestId).toBeUndefined()
    await store.dispatch(activateThread(general))
    expect(store.getState().workspace.openRequestId).toBeUndefined()
  })
  it('reads a thread saved before the card home as resting on its graph', () => {
    expect(
      threadTool({
        id: 'old',
        title: 'Old',
        identity: 's2:X',
        data: { chat: [], layout: 'timeline' },
      }),
    ).toBe('graph')
    expect(
      threadTool({
        id: 'general',
        title: 'General',
        identity: null,
        data: { chat: [], layout: 'timeline' },
      }),
    ).toBeNull()
  })
  it('saves the tool and the paper with the thread', async () => {
    const store = makeStore()
    await store.dispatch(openPaper({ seed: 'DQN' }))
    const state = store.getState()
    const record = state.explorations.byId[state.explorations.activeId]
    const body = explorationBody(state, record)
    const restored = migrateExploration({
      id: body.id,
      name: body.name,
      data: body,
    } as SavedSession)
    const thread = restored.threads.find((item) => item.identity === 's2:DQN')!
    expect(thread.tool).toBe('cards')
    expect(thread.paper?.title).toBe('Paper DQN')
    expect(thread.data.graph_ref?.seed_ref).toBe('DQN')
  })
})

describe('switching the data source', () => {
  // v8.28.1: a thread is keyed by provider + seed, so a switch used to find
  // no thread for the new key and open a twin, leaving the chats and the
  // course behind. Now the thread the reader is in moves.

  /** The paper threads in the store's active exploration. */
  function paperThreads(store: ReturnType<typeof makeStore>) {
    const state = store.getState()
    return state.explorations.byId[state.explorations.activeId].threads.filter(
      (thread) => thread.identity,
    )
  }

  it('rebuilds a graph on screen in place, keeping the thread and its chat', async () => {
    const store = makeStore()
    await store.dispatch(loadGraph({ seed: 'DQN', provider: 's2' }))
    const thread = activeThread(store)
    store.dispatch(turnStarted('why replay?'))
    vi.mocked(api.fetchGraphStream).mockClear()

    await store.dispatch(switchProvider('openalex'))

    expect(api.fetchGraphStream).toHaveBeenCalledWith('DQN', 'openalex', false, expect.anything())
    const moved = activeThread(store)
    expect(moved.id).toBe(thread.id)
    expect(moved.identity).toBe('openalex:DQN')
    expect(moved.data.provider).toBe('openalex')
    expect(paperThreads(store)).toHaveLength(1)
    expect(store.getState().workspace.provider).toBe('openalex')
    expect(store.getState().transcript.byKey[thread.id].chat[0].text).toBe('why replay?')
  })

  it('moves a thread on its cards with one lookup, and builds when the graph is opened', async () => {
    const store = makeStore()
    await store.dispatch(openPaper({ seed: 'DQN' }))
    const thread = activeThread(store)
    vi.mocked(api.fetchGraphStream).mockClear()

    await store.dispatch(switchProvider('openalex'))
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    expect(api.fetchPaperDetail).toHaveBeenLastCalledWith('DQN', 'openalex')
    expect(activeThread(store).id).toBe(thread.id)
    expect(activeThread(store).identity).toBe('openalex:DQN')
    expect(threadTool(activeThread(store))).toBe('cards')

    await store.dispatch(openTool('graph'))
    expect(api.fetchGraphStream).toHaveBeenCalledWith('DQN', 'openalex', false, expect.anything())
    expect(activeThread(store).id).toBe(thread.id)
    expect(paperThreads(store)).toHaveLength(1)
  })

  it('keeps a built graph that is out of view, rebuilding it only when opened', async () => {
    // Reading the course: the graph is in memory but not on screen, so the
    // switch doesn't rebuild it then — opening the graph tool does.
    const store = makeStore()
    await store.dispatch(loadGraph({ seed: 'DQN', provider: 's2' }))
    const thread = activeThread(store)
    store.dispatch(nodeSelectionSet(['DQN']))
    await store.dispatch(openTool('knowledge'))
    vi.mocked(api.fetchGraphStream).mockClear()

    await store.dispatch(switchProvider('openalex'))
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    expect(activeThread(store).identity).toBe('openalex:DQN')

    await store.dispatch(openTool('graph'))
    expect(api.fetchGraphStream).toHaveBeenCalledWith('DQN', 'openalex', false, expect.anything())
    // The old provider's ids mean nothing on the rebuilt graph.
    expect(store.getState().workspace.selectedNodeIds).toEqual([])
    expect(activeThread(store).id).toBe(thread.id)
    expect(paperThreads(store)).toHaveLength(1)
  })

  it('switching away and back before opening the graph rebuilds nothing', async () => {
    // Patrick: "if I switch back to the original provider, no need to reload
    // the graph" — the graph is only rebuilt for a provider it wasn't built on.
    const store = makeStore()
    await store.dispatch(loadGraph({ seed: 'DQN', provider: 's2' }))
    await store.dispatch(openTool('knowledge'))
    const built = store.getState().workspace.graph
    vi.mocked(api.fetchGraphStream).mockClear()

    await store.dispatch(switchProvider('openalex'))
    await store.dispatch(switchProvider('s2'))
    await store.dispatch(openTool('graph'))

    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    expect(store.getState().workspace.graph).toBe(built)
    expect(activeThread(store).identity).toBe('s2:DQN')
    expect(paperThreads(store)).toHaveLength(1)
  })

  it('on General just changes the provider for what comes next', async () => {
    const store = makeStore()
    vi.mocked(api.fetchGraphStream).mockClear()
    await store.dispatch(switchProvider('openalex'))
    expect(store.getState().workspace.provider).toBe('openalex')
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    expect(paperThreads(store)).toHaveLength(0)
  })
})

describe('legacy migration', () => {
  it('splits stamped pairs by provider and preserves every unstamped turn without mutating the saved blob', () => {
    const saved = {
      id: 'old',
      name: 'Learning',
      data: {
        layout: 'timeline',
        provider: 's2',
        graph_ref: { seed: { id: 'DQN', title: 'DQN' }, seed_ref: 'DQN' },
        chat: [
          { role: 'user', text: 'old unstamped' },
          { role: 'assistant', text: 'old answer' },
          { role: 'user', text: 'new question' },
          {
            role: 'assistant',
            text: 'new answer',
            graph: { seedId: 'DQN', seedTitle: 'Other provider', nodes: 1, provider: 'openalex' },
          },
          { role: 'user', text: 'unanswered' },
        ],
      },
    } as SavedSession
    const original = JSON.stringify(saved)
    const migrated = migrateExploration(saved)
    expect(
      migrated.threads
        .find((thread) => thread.identity === 's2:DQN')
        ?.data.chat.map((turn) => turn.text),
    ).toEqual(['old unstamped', 'old answer', 'unanswered'])
    expect(
      migrated.threads
        .find((thread) => thread.identity === 'openalex:DQN')
        ?.data.chat.map((turn) => turn.text),
    ).toEqual(['new question', 'new answer'])
    expect(JSON.stringify(saved)).toBe(original)
  })
  it('round-trips all threads and does not erase a failed graph rebuild reference', async () => {
    const store = makeStore()
    await store.dispatch(loadGraph({ seed: 'DQN' }))
    store.dispatch(turnStarted('question'))
    await store.dispatch(loadGraph({ seed: 'PPO' }))
    const state = store.getState()
    const record = state.explorations.byId[state.explorations.activeId]
    const body = explorationBody(state, record)
    const restored = migrateExploration({
      id: body.id,
      name: body.name,
      data: body,
    } as SavedSession)
    expect(restored.threads).toHaveLength(3)
    expect(restored.threads.find((thread) => thread.identity === 's2:DQN')?.data.chat[0].text).toBe(
      'question',
    )
    expect(restored.threads.every((thread) => !thread.workspace)).toBe(true)
  })

  it("saves a thread's Knowledge Graph chat beside its own and restores it (v8.25.0)", async () => {
    const store = makeStore()
    await store.dispatch(loadGraph({ seed: 'DQN' }))
    const threadId = store.getState().transcript.activeKey
    store.dispatch(turnStarted('graph question'))
    store.dispatch(conversationEnsured(`${threadId}:knowledge`))
    store.dispatch(turnStarted('course question', `${threadId}:knowledge`))
    store.dispatch(tokenAppended('course answer', `${threadId}:knowledge`))
    const state = store.getState()
    const body = explorationBody(state, state.explorations.byId[state.explorations.activeId])
    const saved = body.exploration!.threads.find((thread) => thread.id === threadId)!
    expect(saved.data.chat[0].text).toBe('graph question')
    expect(saved.courseChat?.chat.map((turn) => turn.text)).toEqual([
      'course question',
      'course answer',
    ])
    // Opened again in a fresh sitting, each chat lands under its own key.
    const fresh = makeStore()
    fresh.dispatch(
      explorationOpened(
        migrateExploration({ id: body.id, name: body.name, data: body } as SavedSession),
      ),
    )
    const conversations = fresh.getState().transcript.byKey
    expect(conversations[threadId].chat[0].text).toBe('graph question')
    expect(conversations[`${threadId}:knowledge`].chat[1].text).toBe('course answer')
  })
})
