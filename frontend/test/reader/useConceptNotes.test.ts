/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Knowledge Graph notes in the PDF view (v8.44.0): a text's notes moved
 * to the PDF's headings, matched by number or title, forward from the last
 * match; and notes placed in the PDF's own contents.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { expect, it } from 'vitest'
import type { ReaderSection } from '../../src/api'
import { pdfContentsNotes, textNotesInPdf } from '../../src/reader/useConceptNotes'

/** A document section, as far as matching reads it. */
function section(id: string, number: string, title: string): ReaderSection {
  return { id, level: 2, number, title: [{ kind: 'text', text: title }], blocks: [] }
}

const SECTIONS = [
  section('S3.SS1', '3.1', 'Encoder and Decoder Stacks'),
  section('S3.SS2', '3.2', 'Attention'),
  section('S6.SS2', '6.2', 'Model Variations'),
  section('A1', '', 'Attention'),
]

it('matches by number when both sides have one, else by title', () => {
  const notes = new Map([
    ['S3.SS1', ['ln']],
    ['S3.SS2', ['softmax']],
  ])
  // A numbered PDF heading: "3.2 Attention" and "3.2 Self-attention" both
  // match 3.2 by number; the title doesn't have to agree.
  expect(
    textNotesInPdf(notes, SECTIONS, [
      { title: '3.1 Encoder and decoder stacks', level: 2, page: 3, top: 100 },
      { title: '3.2 Self-attention', level: 2, page: 3, top: 400 },
    ]),
  ).toEqual([
    { page: 3, top: 100, title: '3.1 Encoder and decoder stacks', ids: ['ln'] },
    { page: 3, top: 400, title: '3.2 Self-attention', ids: ['softmax'] },
  ])
})

it('runs forward from the last match, so a repeated title finds its own heading', () => {
  // An outline without numbers (Attention's), "Attention" twice.
  const contents = [
    { title: 'Attention', level: 2, page: 3, top: 300 },
    { title: 'Model Variations', level: 2, page: 8 },
    { title: 'Attention', level: 1, page: 13, top: 60 },
  ]
  const notes = new Map([
    ['S6.SS2', ['bpe']],
    ['A1', ['viz']],
  ])
  expect(textNotesInPdf(notes, SECTIONS, contents)).toEqual([
    // No top known: the page's top.
    { page: 8, top: 0, title: 'Model Variations', ids: ['bpe'] },
    { page: 13, top: 60, title: 'Attention', ids: ['viz'] },
  ])
})

it('leaves out a section with no heading in the PDF', () => {
  const notes = new Map([['S3.SS1', ['ln']]])
  expect(textNotesInPdf(notes, SECTIONS, [{ title: 'Introduction', level: 1, page: 1 }])).toEqual(
    [],
  )
})

it('places notes on the PDF’s own contents entries by their index', () => {
  const contents = [
    { title: '1 Introduction', level: 1, page: 1, top: 90 },
    { title: '2 Algorithm', level: 1, page: 2, top: 40 },
  ]
  expect(pdfContentsNotes(new Map([['pdf:1', ['momentum']]]), contents)).toEqual([
    { page: 2, top: 40, title: '2 Algorithm', ids: ['momentum'] },
  ])
})
