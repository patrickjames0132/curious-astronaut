/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The highlight slice's lit passages (v8.45.0): set and put out, and put out
 * when the Reader chat they came from is cleared.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import { chatKey } from '../../src/store/chats'
import highlight, { passagesCleared, passagesLit } from '../../src/store/highlight'
import { chatCleared } from '../../src/store/transcript'

/** Passages lit in a thread's Reader. */
function lit(threadId: string, scroll = false) {
  return highlight(
    undefined,
    passagesLit({
      threadId,
      answer: 1,
      passage: 'words',
      places: [],
      labels: [],
      quotes: [],
      scroll,
    }),
  )
}

describe('lit passages', () => {
  it('count the asks to go to them, and go out', () => {
    const state = highlight(
      lit('paper', true),
      passagesLit({
        threadId: 'paper',
        answer: 3,
        passage: null,
        places: [],
        labels: [],
        quotes: ['a quote'],
        scroll: true,
      }),
    )
    expect(state.passages).toMatchObject({ answer: 3, quotes: ['a quote'], scroll: 2 })
    expect(highlight(state, passagesCleared()).passages).toBeNull()
  })

  it('go out when their Reader chat is cleared, and not for another chat', () => {
    const state = lit('paper')
    expect(highlight(state, chatCleared(chatKey('paper', 'knowledge'))).passages).not.toBeNull()
    expect(highlight(state, chatCleared(chatKey('other', 'reader'))).passages).not.toBeNull()
    expect(highlight(state, chatCleared(chatKey('paper', 'reader'))).passages).toBeNull()
  })
})
