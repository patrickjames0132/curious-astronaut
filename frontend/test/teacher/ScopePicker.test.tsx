// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The scope picker's popover is controlled (`open`/`onOpenChange`) so the
 * assistant header can keep its two pickers mutually exclusive — these tests
 * pin the controlled contract: the popover renders only when told to, the
 * trigger reports a toggle, and the header ✕ reports a close.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ScopePicker from '../../src/teacher/ScopePicker'

afterEach(cleanup)

const LABELS = {
  icon: '📚',
  name: 'Library filters',
  unit: 'source',
  heading: 'Search in',
  allHint: 'All sources are searched.',
  someHint: 'Only the checked sources are searched.',
  noneHint: 'No sources selected.',
  buttonTitle: 'Choose sources',
}

const ITEMS = [
  { id: 'a', title: 'First source' },
  { id: 'b', title: 'Second source' },
]

/**
 * Render the picker with inert selection callbacks and the given open state.
 *
 * @param open Whether the popover is shown.
 * @param onOpenChange Spy receiving the requested open state.
 * @returns The RTL render result.
 */
function renderPicker(open: boolean, onOpenChange: (open: boolean) => void) {
  return render(
    <ScopePicker
      items={ITEMS}
      checkedIds={['a', 'b']}
      open={open}
      onOpenChange={onOpenChange}
      onToggle={() => {}}
      onSelectAll={() => {}}
      onDeselectAll={() => {}}
      labels={LABELS}
    />,
  )
}

describe('ScopePicker', () => {
  it('renders the popover only when open (state is the parent’s)', () => {
    const { rerender } = renderPicker(false, () => {})
    expect(screen.queryByText('Search in')).toBeNull()
    rerender(
      <ScopePicker
        items={ITEMS}
        checkedIds={['a', 'b']}
        open={true}
        onOpenChange={() => {}}
        onToggle={() => {}}
        onSelectAll={() => {}}
        onDeselectAll={() => {}}
        labels={LABELS}
      />,
    )
    expect(screen.getByText('Search in')).toBeTruthy()
  })

  it('clicking the trigger requests the opposite open state', () => {
    const onOpenChange = vi.fn()
    renderPicker(false, onOpenChange)
    // By role, not by text: the trigger's icon and label are separate
    // elements so the ask bar can hide the label and show the icon alone.
    fireEvent.click(screen.getByRole('button', { name: /Library filters/ }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('the popover ✕ requests a close', () => {
    const onOpenChange = vi.fn()
    renderPicker(true, onOpenChange)
    fireEvent.click(screen.getByLabelText('Close the source picker'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

/**
 * Render an open picker with the given checked subset and bulk-action spies.
 *
 * @param checkedIds The ids currently checked.
 * @returns The bulk-action spies.
 */
function renderWithChecked(checkedIds: string[]) {
  const onSelectAll = vi.fn()
  const onDeselectAll = vi.fn()
  render(
    <ScopePicker
      items={ITEMS}
      checkedIds={checkedIds}
      open={true}
      onOpenChange={() => {}}
      onToggle={() => {}}
      onSelectAll={onSelectAll}
      onDeselectAll={onDeselectAll}
      labels={LABELS}
    />,
  )
  return { onSelectAll, onDeselectAll }
}

describe('ScopePicker bulk actions', () => {
  // The labels are deliberately the compact "All"/"None", not
  // "Select all"/"Deselect all": a subset shows BOTH at once, and the long
  // pair overflowed the 240px popover — heading wrapped, ✕ off-view, a
  // horizontal scrollbar underneath (Patrick's 2026-07-17 report).
  it('a subset shows compact All and None, both wired', () => {
    const { onSelectAll, onDeselectAll } = renderWithChecked(['a'])
    fireEvent.click(screen.getByText('All'))
    fireEvent.click(screen.getByText('None'))
    expect(onSelectAll).toHaveBeenCalledTimes(1)
    expect(onDeselectAll).toHaveBeenCalledTimes(1)
  })

  // A one-source library is the case the picker used to be hidden for
  // entirely (Teacher gated it at `> 1`), which left a reader with one
  // uploaded book no way to ask a question without it. Now it renders — and
  // has to read sensibly at that size.
  it('a lone item drops the bulk actions and labels itself honestly', () => {
    const single = [{ id: 'a', title: 'Only source' }]
    render(
      <ScopePicker
        items={single}
        checkedIds={['a']}
        open={true}
        onOpenChange={() => {}}
        onToggle={() => {}}
        onSelectAll={() => {}}
        onDeselectAll={() => {}}
        labels={LABELS}
      />,
    )
    // "all" claims a breadth one source hasn't got — and the trigger's label
    // is often all the reader sees, since the ask bar hides it to a tooltip.
    expect(document.querySelector('.scope-btn')?.getAttribute('title')).toMatch(
      /^Library filters · on/,
    )
    expect(screen.queryByText('All')).toBeNull()
    // "None" would duplicate the single checkbox directly beneath it.
    expect(screen.queryByText('None')).toBeNull()
    // The checkbox itself is still there — unticking it is the whole point.
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('names itself in every state, so it reads apart from the paper filters', () => {
    // v8.28.0: "All sources" beside "Filters" left readers guessing which
    // narrowed what.
    const three = [...ITEMS, { id: 'c', title: 'Third source' }]
    const labelFor = (checkedIds: string[]) => {
      const { unmount } = render(
        <ScopePicker
          items={three}
          checkedIds={checkedIds}
          open={false}
          onOpenChange={() => {}}
          onToggle={() => {}}
          onSelectAll={() => {}}
          onDeselectAll={() => {}}
          labels={LABELS}
        />,
      )
      const label = document.querySelector('.scope-btn-label')?.textContent
      const title = document.querySelector('.scope-btn')?.getAttribute('title')
      const badge = document.querySelector('.chip-badge')?.textContent ?? null
      unmount()
      return { label, state: title?.split(' — ')[0], badge }
    }
    // The trigger wears the name alone; the state is in the tooltip (and the
    // note over the bar), so it reads the same as "Paper filters" beside it.
    expect(labelFor(['a', 'c']).label).toBe('Library filters')
    expect(labelFor(['a', 'b', 'c']).state).toBe('Library filters · all')
    expect(labelFor(['a', 'c']).state).toBe('Library filters · 2 of 3')
    expect(labelFor([]).state).toBe('Library filters · off')
    // Narrowed, a corner badge counts what's in, as Paper filters counts what
    // it applies; untouched, there's no badge (v8.28.0).
    expect(labelFor(['a', 'b', 'c']).badge).toBeNull()
    expect(labelFor(['a', 'c']).badge).toBe('2')
    expect(labelFor([]).badge).toBe('0')
  })

  it('everything checked hides All; nothing checked hides None', () => {
    renderWithChecked(['a', 'b'])
    expect(screen.queryByText('All')).toBeNull()
    expect(screen.getByText('None')).toBeTruthy()
    cleanup()
    renderWithChecked([])
    expect(screen.getByText('All')).toBeTruthy()
    expect(screen.queryByText('None')).toBeNull()
  })
})
