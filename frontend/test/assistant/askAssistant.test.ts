/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The docked assistants' engine in the dock's chat (v9.0.0): a question
 * asked beside a paper's tool lands in the chat you were last in, tagged
 * with the paper and the tool, and a new question supersedes whatever that
 * chat was answering, whichever engine started it (`assistant/inFlight`).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { configureStore } from '@reduxjs/toolkit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { askAssistant, type PrepareAsk } from '../../src/assistant/askAssistant'
import { inFlight, supersede } from '../../src/assistant/inFlight'
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import highlight from '../../src/store/highlight'
import library from '../../src/store/library'
import transcript, { selectChatKey, selectConversation } from '../../src/store/transcript'
import workspace from '../../src/store/workspace'

afterEach(() => {
  vi.restoreAllMocks()
})

/** A store with a chat and a paper, the paper on screen.
 * @returns The store, the chat's id and the paper.
 */
function setUp() {
  const store = configureStore({
    reducer: { workspace, transcript, explorations, highlight, library },
  })
  const record = newExploration('x')
  const chatId = record.threads[0].id
  const paper: ThreadRecord = {
    id: 'attention',
    title: 'Attention Is All You Need',
    identity: 's2:attention',
    data: { chat: [], layout: 'force' },
  }
  record.threads.push(paper)
  record.activeThreadId = paper.id
  store.dispatch(explorationOpened(record))
  return { store, chatId, paper }
}

/** A prepare that answers with fixed words.
 * @param words The answer.
 * @returns The prepare.
 */
const answering =
  (words: string): PrepareAsk =>
  () =>
  async (_body, handlers) => {
    handlers.onToken(words)
  }

describe('asking beside a paper', () => {
  it('writes to the dock’s chat, the question tagged with the paper and the tool', async () => {
    const { store, chatId, paper } = setUp()
    expect(selectChatKey(store.getState())).toBe(chatId)
    await store.dispatch(
      askAssistant(
        'reader',
        { threadId: paper.id, question: 'What is attention?', provider: 's2' },
        answering('A weighting.'),
      ),
    )
    const chat = selectConversation(store.getState()).chat
    expect(chat.map((turn) => turn.text)).toEqual(['What is attention?', 'A weighting.'])
    expect(chat[0].tag).toEqual({
      threadId: paper.id,
      title: 'Attention Is All You Need',
      tool: 'reader',
    })
    // The paper holds no conversation of its own.
    expect(store.getState().transcript.byKey[paper.id].chat).toEqual([])
  })

  it('supersedes the answer the chat was streaming, whichever view started it', async () => {
    const { store, chatId, paper } = setUp()
    // An answer the Citation Graph's engine started in the same chat.
    const graphAnswer = supersede(chatId)
    await store.dispatch(
      askAssistant(
        'knowledge',
        { threadId: paper.id, question: 'And the course?', provider: 's2' },
        answering('Start with softmax.'),
      ),
    )
    expect(graphAnswer.signal.aborted).toBe(true)
    expect(inFlight(chatId).current).toBeNull()
  })
})
