/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Chats own the conversation (v9.0.0) — which threads are chats, the dock's chat, which chats an exploration offers, mentions, and tags.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { describe, expect, it } from 'vitest'
import { tagKey } from '../../src/assistant/TagFilter'
import {
  acrossTag,
  placePhrase,
  chatOnScreen,
  chatTurns,
  dockChatId,
  explorationChats,
  isChat,
  mentionsChat,
  paperTag,
  tagLabel,
} from '../../src/store/chats'
import { newExploration, type ThreadRecord } from '../../src/store/explorations'

/** A paper thread.
 * @param id Its id.
 * @param title Its title.
 * @returns The thread.
 */
function paperThread(id: string, title: string): ThreadRecord {
  return { id, title, identity: `s2:${id}`, data: { chat: [], layout: 'force' } }
}

/** A chat.
 * @param id Its id.
 * @param title Its title.
 * @returns The thread.
 */
function chatThread(id: string, title: string): ThreadRecord {
  return { id, title, identity: null, data: { chat: [], layout: 'timeline' } }
}

describe('chats and papers', () => {
  it('a chat is a thread with no paper', () => {
    expect(isChat(chatThread('c', 'Chat'))).toBe(true)
    expect(isChat(paperThread('p', 'PPO'))).toBe(false)
  })
  it('offers only chats, each under its title', () => {
    const record = newExploration('x')
    record.threads.push(paperThread('ppo', 'PPO'), chatThread('c2', 'Second'))
    expect(explorationChats(record).map((chat) => [chat.key, chat.label])).toEqual([
      [record.threads[0].id, 'New chat'],
      ['c2', 'Second'],
    ])
  })
  it('reads a chat’s live turns before its saved ones', () => {
    const thread = chatThread('c', 'Chat')
    thread.data.chat = [{ role: 'user', text: 'saved' }]
    expect(chatTurns({ byKey: {} }, thread)[0].text).toBe('saved')
    const live = { chat: [{ role: 'user' as const, text: 'live' }], running: [] }
    expect(
      chatTurns(
        { byKey: { c: { ...live, pendingDiscoveries: { nodes: [], edges: [] } } } },
        thread,
      )[0].text,
    ).toBe('live')
  })
  it('matches a chat by its mention', () => {
    const [chat] = explorationChats({ ...newExploration('x'), threads: [chatThread('c', 'DQN')] })
    expect(mentionsChat('compare @thread[DQN] with this', chat)).toBe(true)
    expect(mentionsChat('compare DQN with this', chat)).toBe(false)
  })
})

describe('the dock’s chat', () => {
  it('is the chat last in, else the first, never a paper', () => {
    const record = {
      threads: [chatThread('a', 'A'), paperThread('p', 'PPO'), chatThread('b', 'B')],
      chatId: 'b',
      activeThreadId: 'p',
    }
    expect(dockChatId(record)).toBe('b')
    expect(dockChatId({ ...record, chatId: undefined })).toBe('a')
    expect(dockChatId({ ...record, chatId: 'gone' })).toBe('a')
    expect(dockChatId({ ...record, chatId: 'p' })).toBe('a')
  })
  it('is on screen beside a paper; a chat on screen is itself', () => {
    const threads = [chatThread('a', 'A'), paperThread('p', 'PPO'), chatThread('b', 'B')]
    expect(chatOnScreen({ threads, chatId: 'b', activeThreadId: 'p' })).toBe('b')
    expect(chatOnScreen({ threads, chatId: 'b', activeThreadId: 'a' })).toBe('a')
  })
})

describe('tags', () => {
  it('label a question by where it was asked, General with no tag', () => {
    const record = { threads: [paperThread('p', 'Attention')] }
    expect(tagLabel(record, undefined)).toBe('General')
    expect(tagLabel(record, paperTag(record.threads[0], 'reader'))).toBe('Attention › Reader')
    expect(tagLabel(record, paperTag(record.threads[0], 'graph'))).toBe(
      'Attention › Citation Graph',
    )
  })
  it('follow a rename, and keep the stamped title for a paper deleted since', () => {
    const tag = paperTag(paperThread('p', 'Attention'), 'knowledge')
    expect(tagLabel({ threads: [paperThread('p', 'Transformers')] }, tag)).toBe(
      'Transformers › Knowledge Graph',
    )
    expect(tagLabel({ threads: [] }, tag)).toBe('Attention › Knowledge Graph')
  })
  // The tooltips' words for a place (Patrick, 2026-10-30): each tool its own
  // way, General left to each sentence, a bridge question General too.
  it('say a place in words for a tooltip', () => {
    const record = { threads: [paperThread('p', 'Attention')] }
    const atari = paperThread('p', 'Attention')
    expect(placePhrase(record, paperTag(atari, 'graph'))).toBe('the Citation Graph of Attention')
    expect(placePhrase(record, paperTag(atari, 'knowledge'))).toBe(
      'the Knowledge Graph of Attention',
    )
    expect(placePhrase(record, paperTag(atari, 'reader'))).toBe('Attention in the Reader')
    expect(placePhrase(record, undefined)).toBeNull()
    expect(placePhrase(record, acrossTag([atari, paperThread('q', 'SAC')]))).toBeNull()
  })
  // A bridge question keeps its papers on its tag, for asking it again across
  // them, but reads as General: label and filter key alike (Patrick,
  // 2026-10-30). Its answer cites the papers.
  it('keep a bridge question’s papers, and read it as General', () => {
    const tag = acrossTag([paperThread('p', 'Attention'), paperThread('q', 'Soft Actor-Critic')])
    expect(tag).toMatchObject({ threadId: 'p', title: 'Attention', tool: 'across' })
    expect(tag.papers?.map((paper) => paper.threadId)).toEqual(['p', 'q'])
    expect(tagLabel({ threads: [paperThread('q', 'SAC')] }, tag)).toBe('General')
    expect(tagKey(tag)).toBe(tagKey(undefined))
    expect(tagKey(tag)).not.toBe(tagKey(paperTag(paperThread('p', 'Attention'), 'reader')))
  })
})
