// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: A criticism note — its chips by number, its passage found in its section and lit on hover, its anchor for the margin.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Criticism } from '../../src/api'
import CriticismNote, { criticismChipId, criticismOf } from '../../src/reader/CriticismNote'
import { noteAnchors } from '../../src/reader/useMarginNotes'

afterEach(cleanup)

const CRITICISMS: Criticism[] = [
  { name: 'Fixed variance', summary: 'Learned variance helps.', papers: 2, quotes: [] },
  { name: 'Slow sampling', summary: 'A thousand steps.', papers: 10, quotes: [] },
]

/** The card's controls, recorded.
 * @returns The controls.
 */
function controls() {
  return { hover: vi.fn(), leave: vi.fn(), pin: vi.fn(), open: null }
}

it('lists its criticisms by number, leaving out any the card no longer has', () => {
  const card = controls()
  render(
    <section>
      <p>We set the variance to a fixed schedule throughout.</p>
      <CriticismNote
        slot="S2|q"
        numbers={[2, 1, 7]}
        criticisms={CRITICISMS}
        quote="We set the variance to a fixed schedule"
        card={card}
        onLight={() => {}}
      />
    </section>,
  )
  const chips = screen.getAllByRole('button')
  expect(chips.map((chip) => chip.getAttribute('title'))).toEqual([
    'Criticism 2: Slow sampling',
    'Criticism 1: Fixed variance',
  ])
  fireEvent.click(chips[1])
  expect(card.pin).toHaveBeenCalledWith(criticismChipId('S2|q', 1), chips[1])
  expect(criticismOf(criticismChipId('S2|q', 1))).toBe(1)
})

it('finds its passage in its section, lights it while hovered and registers it as its anchor', () => {
  const onLight = vi.fn()
  render(
    <section>
      <p>We set the variance to a fixed schedule throughout.</p>
      <CriticismNote
        slot="S2|q"
        numbers={[1]}
        criticisms={CRITICISMS}
        quote="We set the variance to a fixed schedule"
        card={controls()}
        onLight={onLight}
      />
    </section>,
  )
  const note = screen.getByRole('complementary', { name: 'From the Criticisms card' })
  expect(noteAnchors.has(note)).toBe(true)
  fireEvent.pointerEnter(note)
  const light = onLight.mock.calls.at(-1)?.[0] as { ranges: Range[] }
  expect(light.ranges.map((range) => range.toString()).join('')).toBe(
    'We set the variance to a fixed schedule',
  )
  fireEvent.pointerLeave(note)
  expect(onLight).toHaveBeenLastCalledWith(null)
})

it('lights its PDF places when it has them', () => {
  const onLight = vi.fn()
  const places = [{ page: 2, rects: [[10, 20, 30, 40]] }]
  render(
    <CriticismNote
      slot="pdf|q"
      numbers={[1]}
      criticisms={CRITICISMS}
      quote="anything"
      places={places}
      card={controls()}
      onLight={onLight}
    />,
  )
  fireEvent.pointerEnter(screen.getByRole('complementary'))
  expect(onLight).toHaveBeenLastCalledWith({ places })
})
