// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The lecture's beats: a guided read's beat (v8.50.0) lights a passage, so
 * it is a control without papers, and the lit one steps Back / Next.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Beat } from '../../../src/api'
import BeatList from '../../../src/teacher/transcript/BeatList'

afterEach(cleanup)

const BEATS: Beat[] = [
  { heading: 'Queries', text: 'A query asks.', node_ids: [], quote: 'mapping a query' },
  { heading: 'The equation', text: 'Read it.', node_ids: [], labels: ['(1)'] },
  { heading: 'In closing', text: 'That is the idea.', node_ids: [] },
]

it('lets a guided read’s beats be clicked, and steps from the lit one', () => {
  Element.prototype.scrollIntoView = vi.fn()
  const clicked = vi.fn()
  const stepped = vi.fn()
  const { container, rerender } = render(
    <BeatList
      beats={BEATS}
      activeBeat={0}
      onBeatClick={clicked}
      onStep={stepped}
      onEnlarge={() => {}}
    />,
  )
  const items = Array.from(container.querySelectorAll('li.beat'))
  // A passage to light makes a beat a control; the closing one has none.
  expect(items.map((item) => item.classList.contains('paperless'))).toEqual([false, false, true])
  fireEvent.click(items[1])
  expect(clicked).toHaveBeenCalledWith(1, BEATS[1])
  // Back / Next on the lit beat only, Back off at the first.
  expect(screen.getByText('1 of 3')).toBeTruthy()
  expect((screen.getByRole('button', { name: '‹ Back' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next ›' }))
  expect(stepped).toHaveBeenCalledWith(0, 1)
  expect(clicked).toHaveBeenCalledTimes(1)
  // At the last, Next is off; and it's kept in view in the chat.
  rerender(
    <BeatList
      beats={BEATS}
      activeBeat={2}
      onBeatClick={clicked}
      onStep={stepped}
      onEnlarge={() => {}}
    />,
  )
  expect((screen.getByRole('button', { name: 'Next ›' }) as HTMLButtonElement).disabled).toBe(true)
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
})

it('shows no steps without a way to step (a graph lecture)', () => {
  render(<BeatList beats={BEATS} activeBeat={0} onBeatClick={() => {}} onEnlarge={() => {}} />)
  expect(screen.queryByRole('button', { name: 'Next ›' })).toBeNull()
})
