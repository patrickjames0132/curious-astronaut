// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The Criticisms card — its states, its numbered criticisms and quotes, its contents, and the ways to a citing paper.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Criticisms, {
  emptyReason,
  forgetGathered,
  provenance,
} from '../../src/criticisms/Criticisms'
import workspace from '../../src/store/workspace'
import transcript from '../../src/store/transcript'
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import * as api from '../../src/api'
import type { CitingPaper, CriticismsCard } from '../../src/api'

beforeEach(() => forgetGathered())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const THREAD: ThreadRecord = {
  id: 'attn',
  title: 'Attention',
  identity: 's2:attn',
  tool: 'reviews',
  paper: {
    id: 'CorpusId:1',
    arxiv_id: '1706.03762',
    title: 'Attention Is All You Need',
    authors: 'Vaswani, Shazeer',
    year: 2017,
    citation_count: 1,
    url: 'https://arxiv.org/abs/1706.03762',
  },
  data: {
    chat: [],
    layout: 'timeline',
    provider: 's2',
    graph_ref: { seed: { id: 'CorpusId:1', title: 'Attention' }, seed_ref: '1706.03762' },
  },
}

/** A citing paper.
 * @param id Its id.
 * @param title Its title.
 * @param arxivId Its arXiv id, if any.
 * @returns The paper.
 */
function citer(id: string, title: string, arxivId: string | null = null): CitingPaper {
  return { id, arxiv_id: arxivId, title, year: 2020, authors: 'A', citation_count: 1200, url: null }
}

const CARD: CriticismsCard = {
  source: 'corpus',
  citers: 200,
  sentences: 310,
  critiques: 14,
  themes: [
    {
      name: 'Cost grows quadratically with length',
      summary: 'Self-attention is expensive on long inputs.',
      papers: 4,
      quotes: [
        {
          text: 'Self-attention is quadratic [1].',
          paper: citer('CorpusId:2', 'Linformer', '2006.04768'),
        },
        { text: 'It is memory-bound [1].', paper: citer('CorpusId:3', 'FlashAttention') },
        { text: 'Long inputs are costly [1].', paper: citer('CorpusId:4', 'Longformer') },
        { text: 'Quadratic again [1].', paper: citer('CorpusId:5', 'Reformer') },
      ],
    },
  ],
}

/** Mount the card over a store holding the thread.
 * @returns The store.
 */
function mount() {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  const record = newExploration('saved')
  record.threads.push(THREAD)
  record.activeThreadId = THREAD.id
  store.dispatch(explorationOpened(record))
  render(
    <Provider store={store}>
      <Criticisms thread={THREAD} />
    </Provider>,
  )
  return store
}

it('gathers the card for the thread’s paper and shows its themes and first quotes', async () => {
  const fetch = vi.spyOn(api, 'fetchCriticisms').mockResolvedValue(CARD)
  mount()
  expect(screen.getByText(/Reading what later papers said/)).toBeTruthy()
  await screen.findByRole('heading', { name: '1Cost grows quadratically with length' })
  expect(fetch).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'CorpusId:1', arxiv_id: '1706.03762', year: 2017 }),
    false,
  )
  expect(screen.getByText('Raised by 4 papers')).toBeTruthy()
  expect(screen.getByText('“Self-attention is quadratic [1].”')).toBeTruthy()
  expect(screen.queryByText('“Quadratic again [1].”')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }))
  expect(screen.getByText('“Quadratic again [1].”')).toBeTruthy()
  expect(screen.getByText(/310 sentences in which the 200 papers citing it/)).toBeTruthy()
})

it('says why there are no themes, and offers a retry on failure', async () => {
  const fetch = vi
    .spyOn(api, 'fetchCriticisms')
    .mockRejectedValueOnce(new Error('Semantic Scholar didn’t answer.'))
    .mockResolvedValueOnce({ ...CARD, themes: [], critiques: 0 })
  mount()
  await screen.findByText(/Semantic Scholar didn’t answer/)
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText(/None of the 310 sentences from 200 citing papers criticises/)
  expect(fetch).toHaveBeenLastCalledWith(expect.anything(), true)
})

it('opens a citing paper as its own thread, by arXiv id when it has one', async () => {
  vi.spyOn(api, 'fetchCriticisms').mockResolvedValue(CARD)
  const seed = vi.spyOn(api, 'fetchPaperDetail').mockRejectedValue(new Error('offline'))
  mount()
  await screen.findByText('Linformer')
  fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0])
  await waitFor(() => expect(seed).toHaveBeenCalledWith('2006.04768', 's2'))
})

it('describes each source and each empty card honestly', () => {
  expect(provenance({ ...CARD, source: 'live' })).toMatch(
    /most recently cite it.*isn’t in the offline corpus/,
  )
  expect(emptyReason({ ...CARD, source: null, themes: [] })).toMatch(/doesn’t know this paper/)
  expect(emptyReason({ ...CARD, citers: 0, themes: [] })).toMatch(/No paper cited widely enough/)
})

it('shows a citing paper in the Citation Graph with a way back here, and keeps its place', async () => {
  vi.spyOn(api, 'fetchCriticisms').mockResolvedValue(CARD)
  vi.spyOn(api, 'fetchGraph').mockRejectedValue(new Error('offline'))
  vi.spyOn(api, 'fetchGraphStream').mockRejectedValue(new Error('offline'))
  const store = mount()
  await screen.findByText('Linformer')
  fireEvent.click(screen.getByRole('button', { name: 'Show 1 more' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Show in Citation Graph' })[0])
  const record = store.getState().explorations
  const thread = record.byId[record.activeId].threads.find((item) => item.id === 'attn')!
  expect(thread.returnTo).toEqual({ tool: 'reviews', from: 'graph' })
  expect(thread.tool).toBe('graph')

  // Back again: the theme still shows all its quotes.
  cleanup()
  mount()
  await screen.findByText('“Quadratic again [1].”')
  expect(screen.getByRole('button', { name: 'Show fewer' })).toBeTruthy()
})

it('trades the ↑ to the cards for Back to top once scrolled down', async () => {
  vi.spyOn(api, 'fetchCriticisms').mockResolvedValue(CARD)
  const store = mount()
  await screen.findByText('Linformer')
  expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()
  const page = document.querySelector<HTMLElement>('.criticisms-page')!
  page.scrollTop = 600
  fireEvent.scroll(page)
  fireEvent.click(await screen.findByRole('button', { name: 'Back to top' }))
  expect(page.scrollTop).toBe(0)
  fireEvent.scroll(page)
  fireEvent.click(await screen.findByRole('button', { name: 'Back to this paper’s cards' }))
  const record = store.getState().explorations
  expect(record.byId[record.activeId].threads.find((item) => item.id === 'attn')!.tool).toBe(
    'cards',
  )
})

it('numbers the criticisms and lists them in the contents, going to one on a click', async () => {
  localStorage.removeItem('ca.criticismsContentsOpen')
  const second = {
    ...CARD.themes[0],
    name: 'Positional encodings don’t extrapolate',
    summary: 'Lengths unseen in training break it.',
  }
  vi.spyOn(api, 'fetchCriticisms').mockResolvedValue({ ...CARD, themes: [CARD.themes[0], second] })
  mount()
  await screen.findByRole('heading', { name: '2Positional encodings don’t extrapolate' })
  const contents = screen.getByRole('navigation', { name: 'Contents' })
  const entries = Array.from(contents.querySelectorAll('button')).filter(
    (button) => button.closest('li') !== null,
  )
  expect(entries.map((button) => button.textContent)).toEqual([
    '1Cost grows quadratically with length',
    '2Positional encodings don’t extrapolate',
  ])
  // A click lights the one clicked, whatever the scroll says (jsdom lays
  // every section at 0), and scrolls the page to it.
  const page = document.querySelector<HTMLElement>('.criticisms-page')!
  page.scrollTo = vi.fn()
  fireEvent.click(entries[0])
  expect(entries[0].getAttribute('aria-current')).toBe('location')
  expect(entries[1].getAttribute('aria-current')).toBeNull()
  expect(page.scrollTo).toHaveBeenCalled()
  fireEvent.click(entries[1])
  expect(entries[1].getAttribute('aria-current')).toBe('location')
})

it('folds the contents away and remembers it, apart from the Reader’s', async () => {
  localStorage.removeItem('ca.criticismsContentsOpen')
  localStorage.removeItem('ca.readerContentsOpen')
  vi.spyOn(api, 'fetchCriticisms').mockResolvedValue(CARD)
  mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Hide contents' }))
  expect(localStorage.getItem('ca.criticismsContentsOpen')).toBe('0')
  expect(localStorage.getItem('ca.readerContentsOpen')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Show contents' }))
  expect(localStorage.getItem('ca.criticismsContentsOpen')).toBe('1')
})

it('draws no contents for an empty card', async () => {
  vi.spyOn(api, 'fetchCriticisms').mockResolvedValue({ ...CARD, themes: [], critiques: 0 })
  mount()
  await screen.findByText(/None of the 310 sentences/)
  expect(screen.queryByRole('navigation', { name: 'Contents' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show contents' })).toBeNull()
})
