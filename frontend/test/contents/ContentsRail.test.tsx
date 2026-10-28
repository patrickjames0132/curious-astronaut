// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The shared contents rail — its entries, the active one, a pick, and folding by its own keys.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ContentsRail, { useContentsRail, type ContentsEntry } from '../../src/contents/ContentsRail'

const ENTRIES: ContentsEntry[] = [
  { id: 'one', level: 1, number: '1', title: 'Introduction', label: 'Introduction' },
  { id: 'two', level: 2, number: '1.1', title: <em>Background</em>, label: 'Background' },
]

beforeEach(() => {
  localStorage.removeItem('test.open')
  localStorage.removeItem('test.width')
})
afterEach(cleanup)

/** The rail over its own hook, as a host mounts it.
 * @param props Component props.
 * @param props.onPick Go to an entry.
 * @returns The rail.
 */
function Host({ onPick }: { onPick: (id: string) => void }) {
  const rail = useContentsRail('test.open', 'test.width')
  return (
    <ContentsRail
      rail={rail}
      entries={ENTRIES}
      activeId="two"
      onPick={onPick}
      id="test-contents"
      tour="test-contents"
    />
  )
}

it('lists its entries by number, lights the active one and hands back a pick', () => {
  const onPick = vi.fn()
  const { container } = render(<Host onPick={onPick} />)
  expect(
    Array.from(container.querySelectorAll('.contents-rail-number')).map((node) => node.textContent),
  ).toEqual(['1', '1.1'])
  expect(container.querySelector('.contents-rail-level-2 em')?.textContent).toBe('Background')
  const background = screen.getByTitle('Background')
  expect(background.getAttribute('aria-current')).toBe('location')
  fireEvent.click(screen.getByTitle('Introduction'))
  expect(onPick).toHaveBeenCalledWith('one')
})

it('folds to its line and back, remembered under its own key', () => {
  render(<Host onPick={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Hide contents' }))
  expect(localStorage.getItem('test.open')).toBe('0')
  expect(screen.queryByRole('navigation', { name: 'Contents' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show contents' }))
  expect(localStorage.getItem('test.open')).toBe('1')
  expect(screen.getByRole('navigation', { name: 'Contents' })).toBeTruthy()
})
