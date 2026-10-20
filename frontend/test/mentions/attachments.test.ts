/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * `@` picks as attachments (v8.29.0): the chips' identity, cutting the
 * `@query` out of the draft, and the `Attached:` line written on send and
 * read back for the transcript.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import {
  attachedMessage,
  splitAttached,
  withAttachment,
  withoutMention,
} from '../../src/mentions/attachments'
import type { MentionChoice } from '../../src/mentions/parse'

const paper: MentionChoice = {
  kind: 'paper',
  paper: { id: 'p1', arxiv_id: null, title: 'Playing Atari' },
}
const chat: MentionChoice = { kind: 'thread', thread: { id: 't1', title: 'PPO' } }

describe('attachments', () => {
  it('attaches each paper or chat once, in pick order', () => {
    expect(withAttachment(withAttachment([paper], chat), paper)).toEqual([paper, chat])
  })

  it('cuts the @query out of the draft, leaving one space', () => {
    const active = { query: 'atari', start: 10, end: 16, whole: false }
    expect(withoutMention('what does @atari learn?', active)).toEqual({
      text: 'what does learn?',
      caret: 10,
    })
    expect(withoutMention('@atari', { query: 'atari', start: 0, end: 6, whole: true })).toEqual({
      text: '',
      caret: 0,
    })
  })

  it('writes the Attached: line on send and reads it back', () => {
    const sent = attachedMessage([paper, chat], 'how do they differ?')
    expect(sent).toBe('Attached: @Playing Atari · @thread[PPO]\n\nhow do they differ?')
    expect(splitAttached(sent)).toEqual({
      attached: [
        { kind: 'paper', title: 'Playing Atari' },
        { kind: 'thread', title: 'PPO' },
      ],
      body: 'how do they differ?',
    })
    expect(attachedMessage([], 'plain')).toBe('plain')
    expect(splitAttached('plain question')).toEqual({ attached: [], body: 'plain question' })
    expect(splitAttached(attachedMessage([paper], ''))).toEqual({
      attached: [{ kind: 'paper', title: 'Playing Atari' }],
      body: '',
    })
  })
})
