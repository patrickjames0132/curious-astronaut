// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The notes over the ask bar (v8.25.0) — one line each, an ⓘ with them in full when one is cut, and a tip that keeps it there.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ComposerNotes from '../../src/teacher/ComposerNotes'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const NOTES = [
  'Answers also draw on 2 sources (📚).',
  'Asking about the course on Soft Actor-Critic',
]

it('shows each note whole on hover, and no ⓘ while nothing is cut', () => {
  render(<ComposerNotes notes={NOTES} />)
  expect(screen.getByText(NOTES[1]).getAttribute('title')).toBe(NOTES[1])
  expect(screen.queryByRole('button', { name: 'More about this chat' })).toBeNull()
})

it('offers every note in full behind an ⓘ once one is cut short', () => {
  // jsdom lays nothing out: a line wider than its box is a cut line.
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
  render(<ComposerNotes notes={NOTES} />)
  const tip = screen.getByRole('button', { name: 'More about this chat' })
  fireEvent.click(tip)
  const tooltip = screen.getByRole('tooltip')
  expect(tooltip.textContent).toContain(NOTES[0])
  expect(tooltip.textContent).toContain(NOTES[1])
})

it('renders nothing with no notes', () => {
  const { container } = render(<ComposerNotes notes={[]} />)
  expect(container.firstChild).toBeNull()
})

it('keeps the ⓘ for a tip even when nothing is cut, without repeating the notes', () => {
  render(<ComposerNotes notes={NOTES} tip="Type @ to bring in another chat." />)
  fireEvent.mouseEnter(screen.getByRole('button', { name: 'More about this chat' }).parentElement!)
  const tooltip = screen.getByRole('tooltip')
  expect(tooltip.textContent).toBe('Type @ to bring in another chat.')
})
