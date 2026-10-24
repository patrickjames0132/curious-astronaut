// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The Reader card — the parsed paper, its contents, live citations,
 * refs and footnotes, and what it says when there's nothing to read.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Reader from '../../src/reader/Reader'
import { readerSelectionText } from '../../src/reader/selectionText'
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import transcript from '../../src/store/transcript'
import workspace from '../../src/store/workspace'
import * as api from '../../src/api'
import type { ReaderDocument } from '../../src/api'

beforeEach(() => {
  // jsdom lays nothing out, so it has no scrolling to do.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const THREAD: ThreadRecord = {
  id: 'attention',
  title: 'Attention',
  identity: 's2:ATT',
  tool: 'reader',
  paper: {
    id: 'ATT',
    arxiv_id: '1706.03762',
    title: 'Attention Is All You Need',
    authors: 'Vaswani, Shazeer',
    year: 2017,
    citation_count: 1,
    url: null,
  },
  data: {
    chat: [],
    layout: 'timeline',
    provider: 's2',
    graph_ref: { seed: { id: 'ATT', title: 'Attention' }, seed_ref: 'ATT' },
  },
}

const DOCUMENT: ReaderDocument = {
  available: true,
  title: [{ kind: 'text', text: 'Attention Is All You Need' }],
  abstract: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: 'The dominant models.' }] }],
  sections: [
    {
      id: 'S1',
      level: 1,
      number: '1',
      title: [{ kind: 'text', text: 'Introduction' }],
      blocks: [
        {
          kind: 'paragraph',
          inlines: [
            { kind: 'text', text: 'Recurrent networks [' },
            { kind: 'cite', bib: 'bib.bib2', text: '2' },
            { kind: 'text', text: '], see Figure ' },
            { kind: 'ref', target: 'S3.F1', text: '1' },
            { kind: 'text', text: '.' },
            {
              kind: 'note',
              mark: '4',
              inlines: [{ kind: 'text', text: 'Dot products get large.' }],
            },
          ],
        },
      ],
    },
    {
      id: 'S3.SS2',
      level: 2,
      number: '3.2',
      title: [{ kind: 'text', text: 'Attention' }],
      blocks: [
        { kind: 'equation', id: 'S3.E1', latex: 'QK^{T}', tag: '(1)' },
        {
          kind: 'figure',
          id: 'S3.F1',
          tag: 'Figure 1',
          caption: [{ kind: 'text', text: 'The Transformer.' }],
          images: [
            { src: '/api/figure_proxy?src=x', alt: 'Refer to caption', width: 10, height: 10 },
          ],
        },
      ],
    },
    {
      id: 'S3.SS2.Px1',
      level: 4,
      number: '',
      title: [{ kind: 'text', text: 'Encoder:' }],
      blocks: [],
    },
  ],
  bibliography: [
    {
      id: 'bib.bib2',
      label: '2',
      text: [{ kind: 'text', text: 'Bahdanau et al. Neural MT. 2014.' }],
    },
  ],
}

/** Render inside a store holding the thread, as App does.
 * @param ui The element.
 * @returns The store and the render result.
 */
function mount(ui: ReactElement) {
  const store = configureStore({ reducer: { workspace, transcript, explorations } })
  const record = newExploration('saved')
  record.threads.push(structuredClone(THREAD))
  record.activeThreadId = THREAD.id
  store.dispatch(explorationOpened(record))
  return { store, ...render(<Provider store={store}>{ui}</Provider>) }
}

/** Select a phrase in a paragraph, as a reader's drag would, and let go.
 * @param paragraph The paragraph's text, to find it by.
 * @param phrase Text at the start of its first text node.
 */
async function highlight(paragraph: RegExp, phrase: string) {
  // jsdom lays nothing out; the pill only needs a box to sit by.
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(100, 200, 80, 16)
  const element = await screen.findByText(paragraph)
  const textNode = element.firstChild!
  const start = textNode.textContent!.indexOf(phrase)
  const range = document.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, start + phrase.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.mouseUp(element)
  await screen.findByRole('toolbar', { name: 'Highlighted text' })
}

it('reads the paper by its arXiv id and renders it', async () => {
  const fetch = vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  expect(screen.getByText(/Reading the paper/)).toBeTruthy()
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
  expect(fetch.mock.calls[0][0]).toBe('1706.03762')
  expect(screen.getByText('The dominant models.')).toBeTruthy()
  expect(screen.getByText('(1)')).toBeTruthy()
  expect(document.querySelector('.katex')).toBeTruthy()
  // The figure's "Refer to caption" placeholder alt gives way to its tag.
  expect(screen.getByRole('img', { name: 'Figure 1' })).toBeTruthy()
  expect(screen.getByText(/Bahdanau et al/)).toBeTruthy()
})

it('lists sections down to subsubsections in the contents, and jumps', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  const contents = await screen.findByRole('navigation', { name: 'Contents' })
  const entries = Array.from(contents.querySelectorAll('ol button')).map(
    (button) => button.textContent,
  )
  expect(entries).toEqual(['1Introduction', '3.2Attention']) // the paragraph heading stays out
  fireEvent.click(screen.getByRole('button', { name: /3\.2/ }))
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
})

it('ties a citation to its entry and jumps there', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  const cite = await screen.findByText('2', { selector: 'a.reader-cite' })
  expect(cite.getAttribute('title')).toBe('Bahdanau et al. Neural MT. 2014.')
  fireEvent.click(cite)
  const entry = document.getElementById('reader-bib.bib2')
  expect(entry?.classList.contains('landed')).toBe(true)
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
})

it('opens a footnote in place', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  const mark = await screen.findByRole('button', { name: '4' })
  expect(screen.queryByText('Dot products get large.')).toBeNull()
  fireEvent.click(mark)
  expect(screen.getByText('Dot products get large.')).toBeTruthy()
  expect(mark.getAttribute('aria-expanded')).toBe('true')
})

it('says why there is nothing to read, and retries an outage', async () => {
  const fetch = vi
    .spyOn(api, 'fetchDocument')
    .mockResolvedValueOnce({ available: false, reason: 'error' })
    .mockResolvedValueOnce(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  await screen.findByRole('heading', { name: 'Couldn’t reach ar5iv' })
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('offers the PDF when ar5iv has no render', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  mount(<Reader thread={THREAD} />)
  const link = await screen.findByRole('link', { name: 'Open the PDF on arXiv' })
  expect(link.getAttribute('href')).toBe('https://arxiv.org/pdf/1706.03762')
})

it('names a paper that is not on arXiv', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'not_arxiv' })
  mount(<Reader thread={{ ...THREAD, paper: { ...THREAD.paper!, arxiv_id: null } }} />)
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Not on arXiv' })).toBeTruthy())
})

it('enlarges a figure panel with its caption', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Figure 1' }))
  const dialog = screen.getByRole('dialog', { name: 'Enlarged figure' })
  expect(dialog.textContent).toContain('Figure 1')
  expect(dialog.textContent).toContain('The Transformer.')
})

it("keeps an algorithm's line numbers and nesting", async () => {
  const listing: ReaderDocument = {
    ...DOCUMENT,
    available: true,
    sections: [
      {
        id: 'S2',
        level: 1,
        number: '2',
        title: [{ kind: 'text', text: 'Method' }],
        blocks: [
          {
            kind: 'listing',
            id: 'alg1.7',
            lines: [
              { number: '1', indent: 0, inlines: [{ kind: 'text', text: 'for each step do' }] },
              { number: '2', indent: 1.5, inlines: [{ kind: 'text', text: 'sample a batch' }] },
            ],
          },
        ],
      },
    ],
  }
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(listing)
  mount(<Reader thread={THREAD} />)
  const inner = await screen.findByText('sample a batch')
  expect(inner.style.paddingLeft).toBe('1.5em')
  expect(screen.getByText('2', { selector: '.reader-listing-number' })).toBeTruthy()
})

it('folds the contents away by a drag, and back only by the bump', async () => {
  localStorage.removeItem('ca.readerContentsOpen')
  localStorage.removeItem('ca.readerContentsWidth')
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const { container } = mount(<Reader thread={THREAD} />)
  const contents = await screen.findByRole('navigation', { name: 'Contents' })
  expect(contents.style.width).toBe('248px')
  const handle = container.querySelector('.reader-contents-handle')!

  // A drag sizes the panel like the other side panels...
  fireEvent.pointerDown(handle, { clientX: 248 })
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 }))
  })
  expect(contents.style.width).toBe('300px')
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup'))
  })
  expect(localStorage.getItem('ca.readerContentsWidth')).toBe('300')

  // ...and well past the floor it folds them away, remembered.
  fireEvent.pointerDown(handle, { clientX: 300 })
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 }))
  })
  expect(screen.queryByRole('navigation', { name: 'Contents' })).toBeNull()
  expect(localStorage.getItem('ca.readerContentsOpen')).toBe('0')
  // Folded, there's no handle to drag open: only the bump brings them back.
  expect(container.querySelector('.reader-contents-handle')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Show contents' }))
  expect(screen.getByRole('navigation', { name: 'Contents' }).style.width).toBe('300px')
  expect(localStorage.getItem('ca.readerContentsOpen')).toBe('1')
})

it("puts the shell's overlays over the reading pane, beside the contents", async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(
    <Reader thread={THREAD}>
      <button type="button">back</button>
    </Reader>,
  )
  await screen.findByRole('navigation', { name: 'Contents' })
  const back = screen.getByRole('button', { name: 'back' })
  expect(back.parentElement?.classList.contains('reader-main')).toBe(true)
})

it('folds the contents away by the bump on their edge', async () => {
  localStorage.removeItem('ca.readerContentsOpen')
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Hide contents' }))
  expect(screen.queryByRole('navigation', { name: 'Contents' })).toBeNull()
  expect(localStorage.getItem('ca.readerContentsOpen')).toBe('0')
  expect(screen.getByRole('button', { name: 'Show contents' })).toBeTruthy()
})

it('explains a highlighted passage in the Reader Assistant, from its section', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const ask = vi.spyOn(api, 'streamAskReader').mockImplementation(async (_body, handlers) => {
    handlers.onToken('They process tokens one at a time.')
  })
  const opened = vi.fn()
  const { store } = mount(<Reader thread={THREAD} onAssistant={opened} />)
  await highlight(/^Recurrent networks/, 'Recurrent networks')
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Explain' }))
  expect(opened).toHaveBeenCalledWith()
  await waitFor(() =>
    expect(
      store.getState().transcript.byKey['attention:reader'].chat.map((turn) => turn.text),
    ).toEqual([
      'Explain this passage from section 1, Introduction:\n\n“Recurrent networks”',
      'They process tokens one at a time.',
    ]),
  )
  expect(ask.mock.calls[0][0]).toMatchObject({ paper: '1706.03762', section: 'S1' })
  expect(screen.queryByRole('toolbar', { name: 'Highlighted text' })).toBeNull()
})

it('asks for a passage in plain words with Simplify', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const ask = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  mount(<Reader thread={THREAD} onAssistant={() => {}} />)
  await highlight(/^Recurrent networks/, 'Recurrent networks')
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Simplify' }))
  await waitFor(() => expect(ask).toHaveBeenCalled())
  expect(ask.mock.calls[0][0].question).toBe(
    'Simplify, in plain words, this passage from section 1, Introduction:\n\n“Recurrent networks”',
  )
})

it('attaches a highlighted passage to the assistant with Chat', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const ask = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  const opened = vi.fn()
  mount(<Reader thread={THREAD} onAssistant={opened} />)
  await highlight(/^Recurrent networks/, 'Recurrent networks')
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Chat' }))
  expect(opened).toHaveBeenCalledWith({
    text: 'Recurrent networks',
    from: 'section 1, Introduction',
  })
  expect(ask).not.toHaveBeenCalled()
})

it("reads a highlighted formula back as its LaTeX, not KaTeX's doubled glyphs", async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  const tag = await screen.findByText('(1)')
  const range = document.createRange()
  range.selectNodeContents(tag.closest('.reader-equation')!)
  expect(readerSelectionText(range)).toBe('$$QK^{T}$$ (1)')
})
