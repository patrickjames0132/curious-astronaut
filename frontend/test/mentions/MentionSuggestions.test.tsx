// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The `@`-mention dropdown's rows: a title over `authors • venue • year`, the
 * sibling-thread section above the papers, the search row above both, and
 * one keyboard selection across all three that hovering never moves.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MentionPaper } from '../../src/api'
import MentionSuggestions, { hintFor } from '../../src/mentions/MentionSuggestions'

const PAPERS: MentionPaper[] = [
  {
    id: 'p1',
    arxiv_id: '1312.5602',
    title: 'Playing Atari with Deep RL',
    authors: 'Mnih et al.',
    venue: 'NeurIPS',
    year: 2013,
  },
  { id: 'p2', arxiv_id: null, title: 'Dueling DQN', authors: null, venue: null, year: null },
]

afterEach(cleanup)

describe('MentionSuggestions', () => {
  it('shows the title over an authors • venue • year byline', () => {
    render(
      <MentionSuggestions
        threads={[]}
        papers={PAPERS}
        highlighted={0}
        loading={false}
        onPick={() => {}}
      />,
    )
    expect(screen.getByText('Playing Atari with Deep RL')).toBeTruthy()
    expect(screen.getByText('Mnih et al. • NeurIPS • 2013')).toBeTruthy()
  })

  it('renders no orphaned separators for a sparse record', () => {
    // A provider hit can arrive with no authors, venue or year at all; the
    // byline must then be absent rather than a row of bullets.
    render(
      <MentionSuggestions
        threads={[]}
        papers={[PAPERS[1]]}
        highlighted={0}
        loading={false}
        onPick={() => {}}
      />,
    )
    expect(screen.queryByText(/•/)).toBeNull()
  })

  it('lists sibling threads in their own section above the papers', () => {
    const onPick = vi.fn()
    render(
      <MentionSuggestions
        threads={[{ id: 't1', title: 'PPO' }]}
        papers={PAPERS}
        highlighted={-1}
        loading={false}
        onPick={onPick}
      />,
    )
    expect(screen.getByText('Discussions in this exploration')).toBeTruthy()
    expect(screen.getByText('All paper results')).toBeTruthy()
    const rows = screen.getAllByRole('option')
    expect(rows.map((row) => row.textContent)).toEqual([
      '💬PPO',
      '📄Playing Atari with Deep RLMnih et al. • NeurIPS • 2013',
      '📄Dueling DQN',
    ])
    fireEvent.mouseDown(screen.getByText('PPO'))
    expect(onPick).toHaveBeenCalledWith({ kind: 'thread', thread: { id: 't1', title: 'PPO' } })
  })

  it('numbers rows across both sections, so one highlight walks one list', () => {
    render(
      <MentionSuggestions
        threads={[{ id: 't1', title: 'PPO' }]}
        papers={PAPERS}
        highlighted={1}
        loading={false}
        onPick={() => {}}
      />,
    )
    const rows = screen.getAllByRole('option')
    // Row 1 is the FIRST paper, not the second: the thread took row 0.
    expect(rows[0].getAttribute('aria-selected')).toBe('false')
    expect(rows[1].getAttribute('aria-selected')).toBe('true')
  })

  it('pins the search row first and counts it in the numbering', () => {
    const onSearch = vi.fn()
    render(
      <MentionSuggestions
        threads={[{ id: 't1', title: 'PPO' }]}
        papers={PAPERS}
        search="dqn"
        highlighted={0}
        loading
        onPick={() => {}}
        onSearch={onSearch}
      />,
    )
    const rows = screen.getAllByRole('option')
    expect(rows[0].textContent).toBe('🔍Search for “dqn”')
    expect(rows[0].getAttribute('aria-selected')).toBe('true')
    expect(rows[1].textContent).toBe('💬PPO')
    expect(screen.getByText(/^Enter searches/)).toBeTruthy()
    fireEvent.mouseDown(rows[0])
    expect(onSearch).toHaveBeenCalledWith('dqn')
  })

  it('a search row with nothing loaded yet is still a row Enter can take', () => {
    // The race this row exists to end: Enter before the lookup lands.
    render(
      <MentionSuggestions
        threads={[]}
        papers={[]}
        search="dqn"
        highlighted={0}
        loading
        onPick={() => {}}
      />,
    )
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('Searching…')).toBeTruthy()
  })

  it('highlights nothing at -1 and says what Enter does', () => {
    render(
      <MentionSuggestions
        threads={[]}
        papers={PAPERS}
        highlighted={-1}
        loading={false}
        onPick={() => {}}
      />,
    )
    for (const row of screen.getAllByRole('option')) {
      expect(row.getAttribute('aria-selected')).toBe('false')
    }
    expect(screen.getByText(/Enter sends your message/)).toBeTruthy()
  })

  it('the hint follows the state: what Enter does right now', () => {
    const thread = { id: 't1', title: 'PPO' }
    expect(hintFor(null, 'dqn')).toMatch(/^Enter searches · ↓ to attach/)
    expect(hintFor(null, null)).toMatch(/^Enter sends your message/)
    expect(hintFor({ kind: 'paper', paper: PAPERS[0] }, null)).toBe(
      'Enter attaches this paper to your question',
    )
    expect(hintFor({ kind: 'thread', thread }, null)).toBe('Enter attaches this discussion')
    expect(hintFor({ kind: 'paper', paper: PAPERS[0] }, null, true)).toBe(
      'Enter attaches this paper · Shift+Enter opens it',
    )
    expect(hintFor({ kind: 'thread', thread }, null, true)).toBe('Enter attaches this discussion')
  })

  it('shows no paper section below the query floor, only the threads', () => {
    render(
      <MentionSuggestions
        threads={[{ id: 't1', title: 'PPO' }]}
        papers={[]}
        highlighted={-1}
        loading={false}
        onPick={() => {}}
      />,
    )
    expect(screen.queryByText('All paper results')).toBeNull()
    expect(screen.queryByText('Searching…')).toBeNull()
  })

  it('marks the highlighted row for assistive tech, not just visually', () => {
    render(
      <MentionSuggestions
        threads={[]}
        papers={PAPERS}
        highlighted={1}
        loading={false}
        onPick={() => {}}
      />,
    )
    const rows = screen.getAllByRole('option')
    expect(rows[0].getAttribute('aria-selected')).toBe('false')
    expect(rows[1].getAttribute('aria-selected')).toBe('true')
  })

  it('picks on pointer-DOWN, not click', () => {
    // The composer's blur closes the panel, which would unmount the row before
    // a click could ever land on it.
    const onPick = vi.fn()
    render(
      <MentionSuggestions
        threads={[]}
        papers={PAPERS}
        highlighted={0}
        loading={false}
        onPick={onPick}
      />,
    )
    fireEvent.mouseDown(screen.getByText('Dueling DQN'))
    expect(onPick).toHaveBeenCalledWith({ kind: 'paper', paper: PAPERS[1] })
  })

  it('gives each paper row an Open where the bar can open papers', () => {
    const onPick = vi.fn()
    const onOpen = vi.fn()
    render(
      <MentionSuggestions
        threads={[{ id: 't1', title: 'PPO' }]}
        papers={PAPERS}
        highlighted={-1}
        loading={false}
        onPick={onPick}
        onOpen={onOpen}
      />,
    )
    const opens = screen.getAllByRole('button', { name: /^Open / })
    // Papers only: a chat has nothing to open.
    expect(opens).toHaveLength(2)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Open Dueling DQN' }))
    expect(onOpen).toHaveBeenCalledWith(PAPERS[1])
    expect(onPick).not.toHaveBeenCalled()
    // The Open buttons sit beside the rows, not inside them: the keyboard
    // still walks options alone.
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('has no Open on a bar that only points at papers', () => {
    render(
      <MentionSuggestions
        threads={[]}
        papers={PAPERS}
        highlighted={0}
        loading={false}
        onPick={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
    expect(screen.getByText('Enter attaches this paper to your question')).toBeTruthy()
  })

  it('scrolls the keyboard row into view as the arrows move it', () => {
    // The list is capped and scrolls; arrowing past its bottom edge used to
    // move the selection out of sight.
    const scrolled: string[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent ?? '')
    }
    try {
      const { rerender } = render(
        <MentionSuggestions
          threads={[]}
          papers={PAPERS}
          highlighted={0}
          loading={false}
          onPick={() => {}}
        />,
      )
      rerender(
        <MentionSuggestions
          threads={[]}
          papers={PAPERS}
          highlighted={1}
          loading={false}
          onPick={() => {}}
        />,
      )
      expect(scrolled.at(-1)).toBe('📄Dueling DQN')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('hovering selects nothing', () => {
    // A list that opens under a resting mouse must not hand that row the
    // reader's Enter: hover is only a CSS shade, with no handler at all.
    render(
      <MentionSuggestions
        threads={[]}
        papers={PAPERS}
        highlighted={-1}
        loading={false}
        onPick={() => {}}
      />,
    )
    fireEvent.mouseEnter(screen.getAllByRole('option')[1])
    for (const row of screen.getAllByRole('option')) {
      expect(row.getAttribute('aria-selected')).toBe('false')
    }
  })

  it('says it is searching when a lookup is in flight with nothing yet', () => {
    render(
      <MentionSuggestions threads={[]} papers={[]} highlighted={0} loading onPick={() => {}} />,
    )
    expect(screen.getByText('Searching…')).toBeTruthy()
  })

  it('shows the phase the server named, in place of a generic spinner text', () => {
    render(
      <MentionSuggestions
        threads={[]}
        papers={PAPERS}
        highlighted={0}
        loading
        step="Working out which paper “dqn” is"
        onPick={() => {}}
      />,
    )
    expect(screen.getByText('Working out which paper “dqn” is')).toBeTruthy()
    expect(screen.queryByText('Searching…')).toBeNull()
  })

  it('shows the phase even with results already up', () => {
    // The provisional cached list lands first, so the reader needs to be able
    // to tell that more is still coming — and which phase is taking the time.
    render(
      <MentionSuggestions
        threads={[]}
        papers={PAPERS}
        highlighted={0}
        loading
        step="Searching Semantic Scholar"
        onPick={() => {}}
      />,
    )
    expect(screen.getByText('Searching Semantic Scholar')).toBeTruthy()
    expect(screen.getByText('Playing Atari with Deep RL')).toBeTruthy()
  })

  it('falls back to a generic line before the first phase arrives', () => {
    render(
      <MentionSuggestions threads={[]} papers={[]} highlighted={0} loading onPick={() => {}} />,
    )
    expect(screen.getByText('Searching…')).toBeTruthy()
  })

  it('announces the phase politely, without stealing focus from the textarea', () => {
    const { container } = render(
      <MentionSuggestions
        threads={[]}
        papers={[]}
        highlighted={0}
        loading
        step="Looking in your library"
        onPick={() => {}}
      />,
    )
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Looking in your library',
    )
  })
})
