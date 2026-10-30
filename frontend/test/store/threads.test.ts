/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Regression tests for thread ownership and completed history.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it, vi } from 'vitest'
import workspace, {
  activateThread,
  deleteThread,
  newGeneralChat,
  loadGraph,
  nodeSelectionSet,
  openPaper,
  openTag,
  openThread,
  openTool,
  seedPaper,
  switchProvider,
} from '../../src/store/workspace'
import * as api from '../../src/api'
import transcript, { selectChatKey, tokenAppended, turnStarted } from '../../src/store/transcript'
import explorations, {
  awaitsTitle,
  legacyTitled,
  explorationOpened,
  newExploration,
  type ThreadRecord,
  threadReaderPlaceSet,
  threadRenamed,
  threadReturnSet,
  threadTool,
  threadToolSet,
} from '../../src/store/explorations'
import { migrateExploration, explorationBody } from '../../src/store/threadPersistence'
import { paperTag } from '../../src/store/chats'
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
  it('opens a thread from the rail on the tool it was left on, then up to its cards', async () => {
    const store = makeStore()
    const general = activeThread(store).id
    await store.dispatch(loadGraph({ seed: 'PPO' }))
    const graphThread = activeThread(store).id
    expect(threadTool(activeThread(store))).toBe('graph')
    await store.dispatch(activateThread(general))
    vi.mocked(api.fetchGraphStream).mockClear()
    // The first click comes back to its graph, from memory, not rebuilt.
    await store.dispatch(openThread(graphThread))
    expect(activeThread(store).id).toBe(graphThread)
    expect(threadTool(activeThread(store))).toBe('graph')
    expect(store.getState().workspace.graph?.seed.id).toBe('PPO')
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    // A second click, on the thread already on screen, goes up to its cards.
    await store.dispatch(openThread(graphThread))
    expect(threadTool(activeThread(store))).toBe('cards')
    // Its card reopens the graph as it was.
    await store.dispatch(openTool('graph'))
    expect(store.getState().workspace.graph?.seed.id).toBe('PPO')
    expect(api.fetchGraphStream).not.toHaveBeenCalled()
    // Left on its cards, it comes back on its cards.
    await store.dispatch(openThread(graphThread))
    await store.dispatch(activateThread(general))
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
  it('keeps every turn in the chat, tagged with the paper its answer was stamped with, without mutating the saved blob', () => {
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
    const paper = (identity: string) =>
      migrated.threads.find((thread) => thread.identity === identity)!
    const general = migrated.threads.find((thread) => !thread.identity)!
    expect(general.data.chat.map((turn) => [turn.text, turn.tag?.threadId])).toEqual([
      ['old unstamped', paper('s2:DQN').id],
      ['old answer', undefined],
      ['new question', paper('openalex:DQN').id],
      ['new answer', undefined],
      ['unanswered', undefined],
    ])
    expect(paper('s2:DQN').data.chat).toEqual([])
    expect(migrated.chatId).toBe(general.id)
    expect(JSON.stringify(saved)).toBe(original)
  })
  it('round-trips all threads and does not erase a failed graph rebuild reference', async () => {
    const store = makeStore()
    await store.dispatch(loadGraph({ seed: 'DQN' }))
    store.dispatch(turnStarted('question', selectChatKey(store.getState())))
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
    expect(restored.threads.find((thread) => !thread.identity)?.data.chat[0].text).toBe('question')
    expect(restored.chatId).toBe(record.chatId)
    expect(restored.threads.every((thread) => !thread.workspace)).toBe(true)
  })

  it("drops an 8.x save's paper chats rather than reading them (v9.0.0, no migration)", () => {
    const paperChat = [{ role: 'user' as const, text: 'graph question' }]
    const saved = {
      id: 'x',
      name: 'Old',
      data: {
        layout: 'timeline',
        chat: [],
        exploration: {
          version: 1,
          activeThreadId: 'p',
          threads: [
            { id: 'c', title: 'Chat', identity: null, data: { chat: [], layout: 'timeline' } },
            {
              id: 'p',
              title: 'DQN',
              identity: 's2:DQN',
              data: { chat: paperChat, layout: 'force' },
              summary: 'About the graph.',
              courseChat: { chat: paperChat },
              readerChat: { chat: paperChat },
            },
          ],
        },
      },
    } as unknown as SavedSession
    const paper = migrateExploration(saved).threads[1] as ThreadRecord & Record<string, unknown>
    expect(paper.data.chat).toEqual([])
    expect([paper.summary, paper.courseChat, paper.readerChat]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe('more than one General chat (v8.31.0)', () => {
  /** The active exploration's threads.
   * @param store The store.
   * @returns Its threads, in rail order.
   */
  const threads = (store: ReturnType<typeof makeStore>) => {
    const state = store.getState()
    return state.explorations.byId[state.explorations.activeId].threads
  }

  it('starts one after the chats, opens it, keeps the old one, and reuses an empty one', async () => {
    const store = makeStore()
    store.dispatch(explorationOpened(newExploration('explore')))
    const first = activeThread(store).id
    store.dispatch(turnStarted('search results to keep'))
    await store.dispatch(loadGraph({ seed: 'DQN' }))
    await store.dispatch(activateThread(first))
    await store.dispatch(newGeneralChat())
    const second = activeThread(store).id
    // An empty chat is reused rather than joined by another.
    await store.dispatch(newGeneralChat())
    expect(activeThread(store).id).toBe(second)
    // Chats stay together above the paper, titled apart.
    expect(threads(store).map((thread) => thread.title)).toEqual([
      'New chat',
      'New chat (2)',
      'DQN',
    ])
    expect(awaitsTitle(activeThread(store))).toBe(true)
    expect(store.getState().transcript.byKey[first].chat[0].text).toBe('search results to keep')
  })

  it('deletes a General chat into another, and starts the last one over', async () => {
    const store = makeStore()
    store.dispatch(explorationOpened(newExploration('explore')))
    const general = activeThread(store).id
    store.dispatch(turnStarted('a question'))
    await store.dispatch(newGeneralChat())
    const second = activeThread(store).id
    await store.dispatch(deleteThread(second))
    expect(threads(store).map((thread) => thread.id)).toEqual([general])
    expect(activeThread(store).id).toBe(general)
    // The last chat goes too: a new, empty `New chat` takes its place (not
    // `New chat (2)`, though it was added beside one), ready to be named.
    await store.dispatch(deleteThread(general))
    const fresh = activeThread(store)
    expect(threads(store)).toHaveLength(1)
    expect(fresh.id).not.toBe(general)
    expect(fresh.title).toBe('New chat')
    expect(awaitsTitle(fresh)).toBe(true)
    expect(store.getState().transcript.byKey[general]).toBeUndefined()
    expect(store.getState().transcript.byKey[fresh.id]?.chat ?? []).toEqual([])
  })

  it('tells an old exploration’s General chat from a New chat', () => {
    expect(legacyTitled({ title: 'General', identity: null })).toBe(true)
    expect(awaitsTitle({ title: 'General', identity: null })).toBe(false)
    expect(legacyTitled({ title: 'General', identity: 's2:abc' })).toBe(false)
    expect(legacyTitled({ title: 'General relativity', identity: null })).toBe(false)
  })

  it('keeps titles unique, since chats are named by title', async () => {
    const store = makeStore()
    store.dispatch(explorationOpened(newExploration('explore')))
    const first = activeThread(store).id
    store.dispatch(turnStarted('a question'))
    store.dispatch(threadRenamed({ id: first, title: 'Replay' }))
    await store.dispatch(newGeneralChat())
    store.dispatch(threadRenamed({ id: activeThread(store).id, title: 'Replay' }))
    expect(activeThread(store).title).toBe('Replay (2)')
    expect(awaitsTitle(activeThread(store))).toBe(false)
  })
})

describe('the Reader’s way back (v8.44.0)', () => {
  it('offers the way back only while the thread stays where it was set for', async () => {
    const store = makeStore()
    store.dispatch(explorationOpened(newExploration('explore')))
    await store.dispatch(openPaper({ seed: 'DQN' }))
    const id = activeThread(store).id
    store.dispatch(threadToolSet('reader'))
    store.dispatch(threadReturnSet({ id, returnTo: { tool: 'reader', from: 'knowledge' } }))
    store.dispatch(threadToolSet('knowledge'))
    expect(activeThread(store).returnTo).toEqual({ tool: 'reader', from: 'knowledge' })
    // Going back, or anywhere else, spends it.
    store.dispatch(threadToolSet('reader'))
    expect(activeThread(store).returnTo).toBeUndefined()
  })

  it('remembers where the reader was in the paper', async () => {
    const store = makeStore()
    store.dispatch(explorationOpened(newExploration('explore')))
    await store.dispatch(openPaper({ seed: 'DQN' }))
    const id = activeThread(store).id
    store.dispatch(
      threadReaderPlaceSet({ id, place: { view: 'text', at: 'S3.SS2', fraction: 0.4 } }),
    )
    expect(activeThread(store).readerPlace).toEqual({ view: 'text', at: 'S3.SS2', fraction: 0.4 })
  })
})

describe('the dock’s chat (v9.0.0)', () => {
  it('follows the chat last opened, stays put when a paper opens, and falls back when deleted', async () => {
    const store = makeStore()
    store.dispatch(explorationOpened(newExploration('explore')))
    const first = activeThread(store).id
    // Not empty, so the ＋ adds a second chat rather than reusing this one.
    store.dispatch(turnStarted('a question'))
    await store.dispatch(newGeneralChat())
    const second = activeThread(store).id
    const record = () => store.getState().explorations.byId.explore
    expect(record().chatId).toBe(second)
    await store.dispatch(openPaper({ seed: 'DQN' }))
    expect(record().chatId).toBe(second)
    expect(selectChatKey(store.getState())).toBe(second)
    await store.dispatch(deleteThread(second))
    expect(selectChatKey(store.getState())).toBe(first)
  })

  it('gives a chat started beside a paper a conversation to write to', async () => {
    const store = makeStore()
    store.dispatch(explorationOpened(newExploration('explore')))
    const chat = activeThread(store).id
    store.dispatch(turnStarted('a question'))
    await store.dispatch(openPaper({ seed: 'DQN' }))
    // Deleted from the dock, beside the paper: its replacement is never
    // opened, yet a question asked in the dock has to land in it.
    await store.dispatch(deleteThread(chat))
    const fresh = selectChatKey(store.getState())
    expect(fresh).not.toBe(chat)
    store.dispatch(turnStarted('asked in the dock', fresh))
    expect(store.getState().transcript.byKey[fresh]?.chat[0]?.text).toBe('asked in the dock')
  })

  it('goes where a question was asked: its paper’s tool, or its chat', async () => {
    const store = makeStore()
    store.dispatch(explorationOpened(newExploration('explore')))
    const chat = activeThread(store).id
    await store.dispatch(openPaper({ seed: 'DQN' }))
    const paper = activeThread(store)
    await store.dispatch(activateThread(chat))
    await store.dispatch(openTag({ tag: paperTag(paper, 'reader'), chatId: chat }))
    expect(activeThread(store).id).toBe(paper.id)
    expect(threadTool(activeThread(store))).toBe('reader')
    await store.dispatch(openTag({ chatId: chat }))
    expect(activeThread(store).id).toBe(chat)
    // A paper deleted since goes nowhere.
    await store.dispatch(
      openTag({ tag: { threadId: 'gone', title: 'Gone', tool: 'graph' }, chatId: chat }),
    )
    expect(activeThread(store).id).toBe(chat)
  })
})
