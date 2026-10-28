/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The criticism notes' pins grouped into notes, one per passage.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { expect, it } from 'vitest'
import { notesOf } from '../../src/reader/useCriticismNotes'

it('gives each passage one note, its criticisms in number order', () => {
  const notes = notesOf([
    { criticism: 3, section: 'S1', quote: 'We use a fixed variance.' },
    { criticism: 1, section: 'S1', quote: 'We use a fixed variance.' },
    { criticism: 1, section: 'S1', quote: 'Another passage of S1.' },
    { criticism: 3, section: 'S1', quote: 'We use a fixed variance.' },
    { criticism: 2, section: 'S4', quote: 'We use a fixed variance.' },
  ])
  expect(notes.map((note) => [note.section, note.quote, note.numbers])).toEqual([
    ['S1', 'We use a fixed variance.', [1, 3]],
    ['S1', 'Another passage of S1.', [1]],
    ['S4', 'We use a fixed variance.', [2]],
  ])
})
