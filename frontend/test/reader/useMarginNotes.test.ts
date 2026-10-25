// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The margin notes' layout (v8.44.0): stacked so they never overlap, a push
 * forgotten once there's room again, and a note under its heading left be.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, expect, it, vi } from 'vitest'
import { layOut } from '../../src/reader/useMarginNotes'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** A pane of notes, each in the margin (absolute) or not, at a height on
 *  screen (jsdom lays nothing out, so each box is given). */
function pane(notes: { top: number; height: number; margin?: boolean }[]) {
  const root = document.createElement('div')
  const elements = notes.map((note) => {
    const element = document.createElement('aside')
    element.className = 'reader-concepts'
    if (note.margin !== false) element.style.position = 'absolute'
    element.getBoundingClientRect = () => {
      const pushed = Number(element.dataset.pushed) || 0
      return new DOMRect(800, note.top + pushed, 200, note.height)
    }
    root.append(element)
    return element
  })
  document.body.append(root)
  return { root, elements }
}

it('pushes a note down below the one above it, with a gap', () => {
  const { root, elements } = pane([
    { top: 100, height: 80 },
    { top: 120, height: 40 },
    { top: 400, height: 40 },
  ])
  layOut(root)
  expect(elements.map((element) => element.style.translate)).toEqual(['', '0 70px', ''])
  // Laid out again, the push is measured from where it wanted to be.
  layOut(root)
  expect(elements[1].style.translate).toBe('0 70px')
})

it('leaves a note under its heading alone', () => {
  const { root, elements } = pane([
    { top: 100, height: 80 },
    { top: 120, height: 40, margin: false },
  ])
  layOut(root)
  expect(elements[1].style.translate).toBe('')
  expect(elements[1].dataset.pushed).toBeUndefined()
})

it('lifts a text note so “Builds on” sits level with its heading', () => {
  const section = document.createElement('section')
  const heading = document.createElement('h3')
  heading.className = 'reader-section-title'
  heading.getBoundingClientRect = () => new DOMRect(0, 100, 400, 30)
  const note = document.createElement('aside')
  note.className = 'reader-concepts'
  note.style.position = 'absolute'
  const label = document.createElement('span')
  label.className = 'reader-concepts-label'
  note.append(label)
  // CSS puts the note at 140; its label is its first 20px.
  const top = () => 140 + (Number(note.dataset.pushed) || 0)
  note.getBoundingClientRect = () => new DOMRect(800, top(), 200, 120)
  label.getBoundingClientRect = () => new DOMRect(810, top(), 60, 20)
  section.append(heading, note)
  document.body.append(section)
  layOut(section)
  // The heading's middle (115) less the label's (10): 105, 35 up.
  expect(note.style.translate).toBe('0 -35px')
  layOut(section)
  expect(note.style.translate).toBe('0 -35px')
})

it('lets a note back under its heading go of its margin shift', () => {
  // The pane narrowed: the note left the margin, and kept its lift, it sat
  // over its own heading (Patrick).
  const note = document.createElement('aside')
  note.className = 'reader-concepts'
  note.dataset.pushed = '-35'
  note.style.translate = '0 -35px'
  document.body.append(note)
  layOut(document.body)
  expect(note.style.translate).toBe('')
  expect(note.dataset.pushed).toBeUndefined()
})
