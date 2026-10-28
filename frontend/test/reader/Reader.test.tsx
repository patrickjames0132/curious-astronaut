// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The Reader card — the parsed paper, its contents, live citations,
 * refs and footnotes, the PDF view and its switch (v8.40.0, pdf.js stubbed),
 * and what it says when there's nothing to read.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, type ReactElement, type ReactNode, type RefObject } from 'react'
import { Provider, useSelector } from 'react-redux'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMap, nameKey, withChildren } from '../../src/knowledge/model'
import Reader from '../../src/reader/Reader'
import { readerSelectionText } from '../../src/reader/selectionText'
import explorations, {
  explorationOpened,
  newExploration,
  type ThreadRecord,
} from '../../src/store/explorations'
import transcript, { selectConversation } from '../../src/store/transcript'
import workspace from '../../src/store/workspace'
import library from '../../src/store/library'
import highlightReducer, { passagesLit } from '../../src/store/highlight'
import * as api from '../../src/api'
import type { ReaderDocument } from '../../src/api'

/** How the stubbed PDF view behaves: fails to open by default (no PDF),
 *  or opens two pages with the given outline. */
const pdfStub = vi.hoisted(() => ({
  fail: true,
  outline: [] as { title: string; level: number; page: number }[],
  urls: [] as string[],
}))

// pdf.js needs a real browser; the view is stubbed with two marked pages.
vi.mock('../../src/reader/PdfView', () => ({
  default: function PdfViewStub({
    url,
    textRef,
    onLoaded,
    onFailed,
    notes = [],
    zoom = 1,
    lit = [],
  }: {
    url: string
    textRef: RefObject<HTMLDivElement | null>
    onLoaded: (info: { pages: number; outline: typeof pdfStub.outline }) => void
    onFailed: (message: string) => void
    notes?: { key: string; page: number; top: number; node: ReactNode }[]
    zoom?: number
    lit?: { page: number; rects: number[][] }[]
  }) {
    useEffect(() => {
      pdfStub.urls.push(url)
      if (pdfStub.fail) onFailed('no PDF')
      else onLoaded({ pages: 2, outline: pdfStub.outline })
      // Once per URL, as the real view opens a PDF once.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [url])
    return (
      <div ref={textRef} data-testid="pdf-view" data-zoom={zoom} data-lit={JSON.stringify(lit)}>
        {[1, 2].map((page) => (
          <div
            key={page}
            id={`reader-page:${page}`}
            className="reader-pdf-page"
            data-section-id={`page:${page}`}
            data-passage-from={`page ${page}`}
          >
            <span>{`Words on page ${page}.`}</span>
            {notes
              .filter((note) => note.page === page)
              .map((note) => (
                <div key={note.key} className="reader-pdf-note" data-top={note.top}>
                  {note.node}
                </div>
              ))}
          </div>
        ))}
      </div>
    )
  },
}))

beforeEach(() => {
  // jsdom lays nothing out, so it has no scrolling to do.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
  pdfStub.fail = true
  pdfStub.outline = []
  pdfStub.urls = []
  // Each test starts with the contents open at their default width: the
  // fold tests remember their choices, and jsdom's storage outlives a test.
  localStorage.removeItem('ca.readerContentsOpen')
  localStorage.removeItem('ca.readerContentsWidth')
  // The server's PDF contents: none unless a test says so (never a real fetch).
  vi.spyOn(api, 'fetchPdfContents').mockResolvedValue([])
  // The citation cards' matches: none unless a test says so.
  vi.spyOn(api, 'fetchCited').mockResolvedValue({})
  // The Knowledge Graph notes' placements: none unless a test says so.
  vi.spyOn(api, 'placeConcepts').mockResolvedValue({})
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
function mount(ui: ReactElement, thread: ThreadRecord = THREAD) {
  const store = configureStore({
    reducer: { workspace, transcript, explorations, highlight: highlightReducer, library },
  })
  const record = newExploration('saved')
  record.threads.push(structuredClone(thread))
  record.activeThreadId = THREAD.id
  store.dispatch(explorationOpened(record))
  return { store, ...render(<Provider store={store}>{ui}</Provider>) }
}

/**
 * The box's menu, once it's up. Found by its selector, not its role: a role
 * query names every element of the rendered paper, which under a loaded test
 * run took past the 1s wait and failed at random (the flake of v8.45.0's
 * release gate).
 *
 * @returns The menu.
 */
async function boxMenu(): Promise<HTMLElement> {
  return waitFor(() => {
    const menu = document.querySelector<HTMLElement>('.selection-menu[aria-label="Boxed area"]')
    if (!menu) throw new Error('no box menu yet')
    return menu
  })
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
  // Released until the menu shows: a view may enable its menu a moment after
  // its text appears (the PDF view, once the PDF reports open).
  await waitFor(() => {
    fireEvent.mouseUp(element)
    expect(screen.getByRole('toolbar', { name: 'Highlighted text' })).toBeTruthy()
  })
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
  expect(Element.prototype.scrollTo).toHaveBeenCalled()
})

/** The paper `[2]` was matched to (`fetchCited`). */
const BAHDANAU = {
  id: 'nmt',
  arxiv_id: '1409.0473',
  title: 'Neural Machine Translation by Jointly Learning to Align and Translate',
  year: 2014,
  citation_count: 27000,
  authors: 'Dzmitry Bahdanau, Kyunghyun Cho, Yoshua Bengio',
  venue: 'ICLR',
  tldr: 'Attention lets the decoder look back at the source.',
  url: null,
}

it('pins a citation’s card on click, showing the paper it cites', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const cited = vi.spyOn(api, 'fetchCited').mockResolvedValue({ 'bib.bib2': BAHDANAU })
  mount(<Reader thread={THREAD} />)
  const cite = await screen.findByText('2', { selector: 'a.reader-cite' })
  await waitFor(() => expect(cited).toHaveBeenCalledWith('1706.03762', 's2', expect.anything()))
  fireEvent.click(cite)
  const card = await screen.findByRole('dialog', { name: `Cited: ${BAHDANAU.title}` })
  expect(cite.getAttribute('aria-expanded')).toBe('true')
  expect(card.textContent).toContain('Dzmitry Bahdanau, Kyunghyun Cho, Yoshua Bengio · 2014 · ICLR')
  expect(card.textContent).toContain('27,000 citations')
  expect(card.textContent).toContain('Attention lets the decoder look back')
  // Hovering elsewhere leaves a pinned card be; Esc closes it.
  fireEvent.pointerLeave(cite)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('goes to the reference from the card, which closes', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Reader thread={THREAD} />)
  fireEvent.click(await screen.findByText('2', { selector: 'a.reader-cite' }))
  // Unmatched (the default stub): the entry's own text, and why.
  const card = await screen.findByRole('dialog', { name: 'Reference 2' })
  expect(card.textContent).toContain('Bahdanau et al. Neural MT. 2014.')
  await waitFor(() =>
    expect(card.textContent).toContain(
      'Not found in Semantic Scholar’s list of this paper’s references.',
    ),
  )
  expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reference ↓' }))
  const entry = document.getElementById('reader-bib.bib2')!
  expect(entry.classList.contains('landed')).toBe(true)
  expect(screen.queryByRole('dialog')).toBeNull()
  // It stays marked until the reader moves on (Patrick): a press anywhere,
  await new Promise((resolve) => setTimeout(resolve, 1800))
  expect(entry.classList.contains('landed')).toBe(true)
  fireEvent.pointerDown(document.body)
  expect(entry.classList.contains('landed')).toBe(false)
  // or Esc.
  fireEvent.click(await screen.findByText('2', { selector: 'a.reader-cite' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reference ↓' }))
  expect(entry.classList.contains('landed')).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(entry.classList.contains('landed')).toBe(false)
})

it('previews a card on hover and lets it go when the pointer leaves', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  vi.spyOn(api, 'fetchCited').mockResolvedValue({ 'bib.bib2': BAHDANAU })
  mount(<Reader thread={THREAD} />)
  const cite = await screen.findByText('2', { selector: 'a.reader-cite' })
  fireEvent.pointerEnter(cite)
  // Not at once: a pointer passing over the text shouldn't flash cards.
  expect(screen.queryByRole('dialog')).toBeNull()
  const card = await screen.findByRole('dialog')
  expect(card.classList.contains('pinned')).toBe(false)
  // On the card, it stays; off both, it goes.
  fireEvent.pointerLeave(cite)
  fireEvent.pointerEnter(card)
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(screen.queryByRole('dialog')).toBeTruthy()
  fireEvent.pointerLeave(card)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('opens the cited paper, or shows it in the Citation Graph', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  vi.spyOn(api, 'fetchCited').mockResolvedValue({ 'bib.bib2': BAHDANAU })
  const detail = vi.spyOn(api, 'fetchPaperDetail').mockResolvedValue(BAHDANAU)
  const { store } = mount(<Reader thread={THREAD} />)
  const cite = await screen.findByText('2', { selector: 'a.reader-cite' })
  await waitFor(() => expect(api.fetchCited).toHaveBeenCalled())
  fireEvent.click(cite)
  fireEvent.click(await screen.findByRole('button', { name: 'Show in Citation Graph' }))
  expect(store.getState().workspace.focusRequest).toBe('nmt')
  expect(screen.queryByRole('dialog')).toBeNull()
  // The Citation Graph offers the way back here (Patrick).
  const saved = store
    .getState()
    .explorations.byId.saved.threads.find((item) => item.id === THREAD.id)
  expect(saved?.returnTo).toEqual({ tool: 'reader', from: 'graph' })
  fireEvent.click(cite)
  fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
  // The paper opens as its own thread, by the thread's provider.
  await waitFor(() => expect(detail).toHaveBeenCalledWith('nmt', 's2'))
})

/** Attention's thread with a course: softmax (with a lesson) and dot
 *  products (checked off as known). */
function courseThread(): ThreadRecord {
  const course = withChildren(
    createMap({ id: 'ATT', title: 'Attention Is All You Need' }),
    nameKey('Attention Is All You Need'),
    [
      { name: 'Softmax function', why: 'Attention weights are a softmax.' },
      { name: 'Dot product', why: 'Scores are dot products.' },
    ],
  )
  const softmax = nameKey('Softmax function')
  course.nodes[softmax] = {
    ...course.nodes[softmax],
    lesson: '### Softmax\n\nSoftmax turns *scores* into weights.\n\nMore of the lesson.',
  }
  course.known = [nameKey('Dot product')]
  return { ...THREAD, knowledge: course }
}

it('notes the course’s concepts beside the sections that build on them', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const place = vi
    .spyOn(api, 'placeConcepts')
    .mockResolvedValue({ 'S3.SS2': ['Dot product', 'Softmax function'] })
  mount(<Harness />, courseThread())
  const note = await screen.findByRole('complementary', { name: 'From your Knowledge Graph' })
  expect(place).toHaveBeenCalledWith(
    { paper: '1706.03762', source: 'text' },
    expect.arrayContaining(['Softmax function', 'Dot product']),
    expect.anything(),
  )
  // Beside 3.2, in course order, the known one ticked (its ✓ shown by CSS).
  expect(note.closest('section')?.getAttribute('data-section-id')).toBe('S3.SS2')
  const chips = Array.from(note.querySelectorAll('button'))
  expect(chips.map((chip) => chip.getAttribute('title'))).toEqual([
    'Softmax function',
    'Dot product: you know this',
  ])
  expect(chips.map((chip) => chip.classList.contains('known'))).toEqual([false, true])
  expect(document.querySelector('.reader-article')?.classList.contains('has-notes')).toBe(true)
})

it('opens a concept’s card: why, its lesson’s opening, the check-off, the lesson', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  vi.spyOn(api, 'placeConcepts').mockResolvedValue({ 'S3.SS2': ['Softmax function'] })
  const { store } = mount(<Harness />, courseThread())
  fireEvent.click(await screen.findByRole('button', { name: 'Softmax function' }))
  const card = await screen.findByRole('dialog', { name: 'Concept: Softmax function' })
  expect(card.textContent).toContain('Attention weights are a softmax.')
  // The lesson's first paragraph of prose, not its heading.
  expect(card.textContent).toContain('Softmax turns scores into weights.')
  expect(card.textContent).not.toContain('More of the lesson.')
  const course = () =>
    store.getState().explorations.byId.saved.threads.find((item) => item.id === THREAD.id)!
      .knowledge!
  // The course's own check-off: the Knowledge Graph shows it too.
  fireEvent.click(screen.getByRole('button', { name: 'Mark as known' }))
  expect(course().known).toContain(nameKey('Softmax function'))
  const toggle = screen.getByRole('button', { name: 'Known' })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Read lesson in Knowledge Graph' }))
  expect(course().openId).toBe(nameKey('Softmax function'))
  // The Knowledge Graph will offer the way back to the paper.
  const thread = () =>
    store.getState().explorations.byId.saved.threads.find((item) => item.id === THREAD.id)!
  expect(thread().returnTo).toEqual({ tool: 'reader', from: 'knowledge' })
  await waitFor(() =>
    expect(
      store.getState().explorations.byId.saved.threads.find((item) => item.id === THREAD.id)!.tool,
    ).toBe('knowledge'),
  )
})

it('keeps a note’s order when a concept is checked off and back', async () => {
  // MDPs jumped to the front when known and the back when not (Patrick): a
  // check-off prunes what the item needs from the teaching order.
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const thread = courseThread()
  const course = withChildren(thread.knowledge!, nameKey('Softmax function'), [
    { name: 'Vectors', why: 'w' },
  ])
  course.known = []
  vi.spyOn(api, 'placeConcepts').mockResolvedValue({
    'S3.SS2': ['Softmax function', 'Dot product', 'Vectors'],
  })
  mount(<Harness />, { ...thread, knowledge: course })
  const note = await screen.findByRole('complementary', { name: 'From your Knowledge Graph' })
  const order = () =>
    Array.from(note.querySelectorAll('.reader-concept-name')).map((name) => name.textContent)
  await waitFor(() => expect(order()).toEqual(['Vectors', 'Softmax function', 'Dot product']))
  fireEvent.click(screen.getByRole('button', { name: 'Softmax function' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Mark as known' }))
  expect(order()).toEqual(['Vectors', 'Softmax function', 'Dot product'])
  fireEvent.click(screen.getByRole('button', { name: 'Known' }))
  expect(order()).toEqual(['Vectors', 'Softmax function', 'Dot product'])
})

it('shows a long note’s first three concepts and the rest on “+N more”', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const thread = courseThread()
  // Softmax broken down further: five concepts in all.
  const course = withChildren(
    thread.knowledge!,
    nameKey('Softmax function'),
    ['Vectors', 'Matrices', 'Scaling'].map((name) => ({ name, why: 'w' })),
  )
  vi.spyOn(api, 'placeConcepts').mockResolvedValue({
    'S3.SS2': ['Softmax function', 'Dot product', 'Vectors', 'Matrices', 'Scaling'],
  })
  mount(<Harness />, { ...thread, knowledge: course })
  const note = await screen.findByRole('complementary', { name: 'From your Knowledge Graph' })
  await waitFor(() => expect(note.querySelectorAll('.reader-concept')).toHaveLength(3))
  // Opening it tells the margin's layout, which moves the notes below.
  const changed = vi.fn()
  document.addEventListener('reader-notes-changed', changed)
  fireEvent.click(screen.getByRole('button', { name: '+2 more' }))
  expect(note.querySelectorAll('.reader-concept')).toHaveLength(5)
  await waitFor(() => expect(changed).toHaveBeenCalled())
  document.removeEventListener('reader-notes-changed', changed)
  fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
  expect(note.querySelectorAll('.reader-concept')).toHaveLength(3)
})

it('lights only the chip that was clicked when two notes share a concept', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  vi.spyOn(api, 'placeConcepts').mockResolvedValue({
    S1: ['Softmax function'],
    'S3.SS2': ['Softmax function'],
  })
  mount(<Harness />, courseThread())
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Softmax function' })).toHaveLength(2),
  )
  const [first, second] = screen.getAllByRole('button', { name: 'Softmax function' })
  fireEvent.click(second)
  expect(await screen.findByRole('dialog', { name: 'Concept: Softmax function' })).toBeTruthy()
  expect(second.getAttribute('aria-expanded')).toBe('true')
  expect(first.getAttribute('aria-expanded')).toBe('false')
})

it('reopens where the reader left off', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const scrolled: number[] = []
  // jsdom lays nothing out: the section sits 500px below the pane's top.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.sectionId === 'S3.SS2'
      ? new DOMRect(0, 500, 600, 400)
      : new DOMRect(0, 0, 600, 0)
  })
  vi.spyOn(Element.prototype, 'scrollTop', 'set').mockImplementation(function (
    this: Element,
    value: number,
  ) {
    if (this.classList.contains('reader-page')) scrolled.push(value)
  })
  mount(<Harness />, { ...THREAD, readerPlace: { view: 'text', at: 'S3.SS2', fraction: 0.25 } })
  await screen.findByRole('heading', { name: '3.2Attention' })
  // The section's top (500) plus a quarter of its height (100).
  await waitFor(() => expect(scrolled).toEqual([600]))
})

it('moves the text’s notes to the PDF’s headings in the PDF view', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const place = vi.spyOn(api, 'placeConcepts').mockResolvedValue({ 'S3.SS2': ['Softmax function'] })
  // The PDF's outline has no numbers (Attention's doesn't): matched by title.
  vi.spyOn(api, 'fetchPdfContents').mockResolvedValue([
    { title: 'Introduction', level: 1, page: 1, top: 72 },
    { title: 'Attention', level: 2, page: 2, top: 300 },
  ])
  pdfStub.fail = false
  mount(<Harness />, { ...courseThread(), readerView: 'pdf' })
  const note = await screen.findByRole('complementary', { name: 'From your Knowledge Graph' })
  // Beside page 2, at the heading's place, from the text's placement alone.
  const holder = note.closest('.reader-pdf-note') as HTMLElement
  expect(holder.closest('.reader-pdf-page')?.id).toBe('reader-page:2')
  expect(holder.dataset.top).toBe('300')
  expect(place).toHaveBeenCalledTimes(1)
  expect(place.mock.calls[0][0]).toEqual({ paper: '1706.03762', source: 'text' })
  // Its card opens in the PDF view too.
  fireEvent.click(screen.getByRole('button', { name: 'Softmax function' }))
  expect(await screen.findByRole('dialog', { name: 'Concept: Softmax function' })).toBeTruthy()
})

it('places the course in the PDF’s own contents when there is only a PDF', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  vi.spyOn(api, 'fetchPdfContents').mockResolvedValue([
    { title: '1 Introduction', level: 1, page: 1, top: 90 },
    { title: '2 Algorithm', level: 1, page: 2, top: 40 },
  ])
  const place = vi.spyOn(api, 'placeConcepts').mockResolvedValue({ 'pdf:1': ['Dot product'] })
  pdfStub.fail = false
  mount(<Harness />, courseThread())
  const note = await screen.findByRole('complementary', { name: 'From your Knowledge Graph' })
  expect(note.closest('.reader-pdf-page')?.id).toBe('reader-page:2')
  expect(place).toHaveBeenCalledWith(
    { paper: '1706.03762', source: 'pdf', provider: 's2' },
    expect.arrayContaining(['Dot product']),
    expect.anything(),
  )
})

it('notes nothing, and asks nothing, without a course', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Harness />)
  await screen.findByRole('heading', { name: '3.2Attention' })
  expect(api.placeConcepts).not.toHaveBeenCalled()
  expect(screen.queryByRole('complementary')).toBeNull()
})

it('lights an answer’s passages in the text, going there only when asked', async () => {
  // jsdom measures no range: each lit text node measures as one line here,
  // its own row, so the boxes count the lines lit.
  let row = 0
  Range.prototype.getClientRects = function () {
    row += 40
    return [new DOMRect(0, row, 120, 16)] as unknown as DOMRectList
  }
  const scrollTo = vi.fn()
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const { store } = mount(<Harness />)
  await screen.findByRole('heading', { name: '3.2Attention' })
  const lit = () => document.querySelectorAll('.reader-text-lit').length
  // An answer finished: lit where it is, the page left alone.
  act(() => {
    store.dispatch(
      passagesLit({
        threadId: THREAD.id,
        answer: 1,
        passage: null,
        places: [],
        labels: [],
        quotes: ['recurrent networks'],
        scroll: false,
      }),
    )
  })
  await waitFor(() => expect(lit()).toBe(1))
  expect(scrollTo).not.toHaveBeenCalled()
  // Clicked: lit, and gone to.
  act(() => {
    store.dispatch(
      passagesLit({
        threadId: THREAD.id,
        answer: 1,
        passage: null,
        places: [],
        labels: [],
        quotes: ['the dominant models'],
        scroll: true,
      }),
    )
  })
  await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1))
  expect(lit()).toBe(1)
  // Another thread's passages light nothing here; Esc puts these out.
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(store.getState().highlight.passages).toBeNull()
  await waitFor(() => expect(lit()).toBe(0))
  // @ts-expect-error -- jsdom's Range has none; this test gave it one.
  delete Range.prototype.getClientRects
})

it('lights places in the PDF: the passage where it was highlighted, the quotes where the server finds them', async () => {
  const scrollTo = vi.fn()
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  const quoted = { page: 1, rects: [[10, 20, 30, 40]] }
  const find = vi.spyOn(api, 'findPdfQuotes').mockResolvedValue({ found: [[quoted]], labelled: [] })
  pdfStub.fail = false
  const { store } = mount(<Harness />)
  const view = await screen.findByTestId('pdf-view')
  const lit = () => JSON.parse(view.getAttribute('data-lit') ?? '[]')
  const highlighted = { page: 2, rects: [[50, 60, 70, 80]] }
  act(() => {
    store.dispatch(
      passagesLit({
        threadId: THREAD.id,
        answer: 1,
        passage: 'the words as asked',
        places: [highlighted],
        labels: [],
        quotes: ['a quote'],
        scroll: true,
      }),
    )
  })
  await waitFor(() => expect(lit()).toEqual([highlighted, quoted]))
  // Only the quotes are searched for: the passage has its places.
  expect(find).toHaveBeenCalledWith('1706.03762', 's2', ['a quote'], [], expect.anything())
  // Once the page's scale has settled.
  await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1))
  // A passage with no places (asked in the text view) is searched for by its
  // words and a part-formula's glyphs, never its LaTeX.
  act(() => {
    store.dispatch(
      passagesLit({
        threadId: THREAD.id,
        answer: 3,
        passage: 'Vψ(st) − Qθ (part of $$V_\\psi(s_t) - Q_\\theta$$)',
        places: [],
        labels: [],
        quotes: [],
        scroll: false,
      }),
    )
  })
  await waitFor(() =>
    expect(find).toHaveBeenLastCalledWith(
      '1706.03762',
      's2',
      ['Vψ(st) − Qθ'],
      [],
      expect.anything(),
    ),
  )
  await waitFor(() => expect(lit()).toEqual([quoted]))
  expect(scrollTo).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(lit()).toEqual([]))
})

it('goes to what is lit on switching between the text and the PDF', async () => {
  const scrollTo = vi.fn()
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  vi.spyOn(api, 'findPdfQuotes').mockResolvedValue({ found: [], labelled: [] })
  pdfStub.fail = false
  const { store } = mount(<Harness />)
  await screen.findByRole('heading', { name: '3.2Attention' })
  // Lit in place (an answer finishing): nothing moves.
  act(() => {
    store.dispatch(
      passagesLit({
        threadId: THREAD.id,
        answer: 1,
        passage: 'Recurrent networks',
        places: [{ page: 2, rects: [[10, 20, 30, 40]] }],
        labels: [],
        quotes: [],
        scroll: false,
      }),
    )
  })
  expect(scrollTo).not.toHaveBeenCalled()
  // To the PDF: it goes there, once its page is laid out.
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(1))
  // Back to the text: there too.
  fireEvent.click(screen.getByRole('button', { name: 'Text' }))
  await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2))
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
  await screen.findByRole('heading', { name: 'Couldn’t reach arXiv’s HTML' })
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('links to arXiv’s PDF when neither the HTML nor the PDF opens here', async () => {
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
  const handle = container.querySelector('.contents-rail-handle')!

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
  expect(container.querySelector('.contents-rail-handle')).toBeNull()
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
  // The pane takes its new width at once and its contents glide there (a
  // transform, not a resize every frame), until the glide ends.
  const main = document.querySelector('.reader-main')!
  expect(main.classList.contains('glide-close')).toBe(true)
  // Its animationend can't reach React in jsdom; the fallback ends it.
  await waitFor(() => expect(main.classList.contains('glide-close')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Show contents' }))
  expect(main.classList.contains('glide-open')).toBe(true)
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
    expect(selectConversation(store.getState()).chat.map((turn) => turn.text)).toEqual([
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

it('credits whichever renderer the text came from', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({
    ...DOCUMENT,
    available: true,
    source: { name: 'ar5iv', url: 'https://ar5iv.labs.arxiv.org/html/1706.03762' },
  } as ReaderDocument)
  mount(<Reader thread={THREAD} />)
  const credit = await screen.findByRole('link', { name: 'ar5iv' })
  expect(credit.getAttribute('href')).toBe('https://ar5iv.labs.arxiv.org/html/1706.03762')
})

/** The Reader as App renders it: the thread read from the store, so a
 *  choice saved on it (the Text/PDF switch) reaches the Reader.
 * @param props Component props.
 * @param props.onAssistant Open the assistant.
 * @returns The Reader.
 */
function Harness({ onAssistant }: { onAssistant?: () => void }) {
  const thread = useSelector(
    (state: { explorations: { byId: Record<string, { threads: ThreadRecord[] }> } }) =>
      state.explorations.byId.saved.threads.find((item) => item.id === THREAD.id),
  )!
  return <Reader thread={thread} onAssistant={onAssistant} />
}

it('shows the PDF, with its outline as the contents, when there is no HTML render', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  pdfStub.fail = false
  pdfStub.outline = [
    { title: 'Introduction', level: 1, page: 1 },
    { title: 'Experiments', level: 1, page: 2 },
  ]
  mount(<Harness />)
  await screen.findByTestId('pdf-view')
  expect(pdfStub.urls).toEqual(['/api/paper/1706.03762/pdf?provider=s2'])
  expect(screen.queryByRole('heading', { name: /No HTML render/ })).toBeNull()
  // The switch stays, its Text button off and saying why (Patrick).
  const text = screen.getByRole('button', { name: 'Text' })
  expect(text.getAttribute('aria-disabled')).toBe('true')
  expect(text.getAttribute('title')).toBe(
    'No text: arXiv couldn’t convert this paper’s LaTeX to HTML',
  )
  fireEvent.click(text)
  expect(screen.getByTestId('pdf-view')).toBeTruthy()
  const contents = await screen.findByRole('navigation', { name: 'Contents' })
  const entries = Array.from(contents.querySelectorAll('ol button')).map(
    (button) => button.textContent,
  )
  expect(entries).toEqual(['Introduction', 'Experiments'])
  fireEvent.click(screen.getByRole('button', { name: 'Experiments' }))
  expect(Element.prototype.scrollTo).toHaveBeenCalled()
  expect(document.getElementById('reader-page:2')?.classList.contains('landed')).toBe(true)
})

it('switches between the text and the PDF, remembering the choice on the thread', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  pdfStub.fail = false
  const { store } = mount(<Harness />)
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
  const switcher = screen.getByRole('group', { name: 'Show the paper as' })
  expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await screen.findByTestId('pdf-view')
  const saved = store
    .getState()
    .explorations.byId.saved.threads.find((item) => item.id === THREAD.id)
  expect(saved?.readerView).toBe('pdf')
  expect(switcher.isConnected).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Text' }))
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
})

it('offers the text when a chosen PDF won’t open', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  mount(<Harness />)
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await screen.findByRole('heading', { name: 'Couldn’t open the PDF' })
  fireEvent.click(screen.getByRole('button', { name: 'Show the text' }))
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
})

it('explains a passage highlighted in the PDF, from its page', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  pdfStub.fail = false
  const ask = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  mount(<Harness onAssistant={() => {}} />)
  await highlight(/^Words on page 2/, 'Words on page 2')
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Explain' }))
  await waitFor(() => expect(ask).toHaveBeenCalled())
  expect(ask.mock.calls[0][0]).toMatchObject({
    paper: '1706.03762',
    section: 'page:2',
    title: 'Attention Is All You Need',
    question: 'Explain this passage from page 2:\n\n“Words on page 2”',
  })
})

it('asks about a PDF highlight in the PDF’s own words, sending and keeping where it is', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  pdfStub.fail = false
  const ask = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  const snapped = [{ page: 2, rects: [[50, 100, 90, 108]] }]
  const read = vi
    .spyOn(api, 'fetchPdfPassage')
    .mockResolvedValue({ text: 'The words, in order', places: snapped })
  // jsdom lays nothing out: page 2 sits at the top left, at scale 2, and the
  // highlight is one line on it.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.id === 'reader-page:2' ? new DOMRect(0, 0, 600, 800) : new DOMRect(0, 0, 0, 0)
  })
  Range.prototype.getClientRects = function () {
    return [new DOMRect(100, 200, 80, 16)] as unknown as DOMRectList
  }
  const { store } = mount(<Harness onAssistant={() => {}} />)
  await highlight(/^Words on page 2/, 'Words on page 2')
  document.getElementById('reader-page:2')!.dataset.scale = '2'
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Explain' }))
  await waitFor(() => expect(ask).toHaveBeenCalled())
  // Where the drag began and ended: the left of its first box, the right of
  // its last, in points on page 2.
  expect(read).toHaveBeenCalledWith('1706.03762', 's2', {
    span: { start: { page: 2, left: 50, top: 104 }, end: { page: 2, left: 90, top: 104 } },
  })
  expect(ask.mock.calls[0][0]).toMatchObject({
    question: 'Explain this passage from page 2:\n\n“The words, in order”',
    places: snapped,
  })
  // The turn keeps them: its answer lights them, a retry sends them again.
  expect(selectConversation(store.getState()).chat[0].places).toEqual(snapped)
  // @ts-expect-error -- jsdom's Range has none; this test gave it one.
  delete Range.prototype.getClientRects
})

it('lists the headings the server found when the PDF has no outline, numbers apart', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  vi.spyOn(api, 'fetchPdfContents').mockResolvedValue([
    { title: 'Abstract', level: 1, page: 1 },
    { title: '3.2 Attention', level: 2, page: 2 },
  ])
  pdfStub.fail = false
  mount(<Harness />)
  const contents = await screen.findByRole('navigation', { name: 'Contents' })
  await waitFor(() => expect(contents.querySelectorAll('ol button')).toHaveLength(2))
  const second = contents.querySelectorAll('ol button')[1]
  expect(second.querySelector('.contents-rail-number')?.textContent).toBe('3.2')
  expect(second.querySelector('.contents-rail-title')?.textContent).toBe('Attention')
})

it('jumps to a PDF heading’s place on its page, and keeps the clicked one active', async () => {
  // The SHARSA paper's page 8 starts two sections: the contents knew only
  // the page, so a click on the first landed on (and lit) the second.
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  vi.spyOn(api, 'fetchPdfContents').mockResolvedValue([
    { title: 'The curse of horizon in policy learning', level: 2, page: 2, top: 364 },
    { title: 'Horizon reduction makes RL scale better', level: 1, page: 2, top: 597 },
  ])
  const scrollTo = vi.fn()
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo
  // jsdom lays nothing out: every page's top is 0, and a tall pane puts the
  // reading line (a third of the way down) below both headings.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(3000)
  pdfStub.fail = false
  mount(<Harness />)
  const contents = await screen.findByRole('navigation', { name: 'Contents' })
  await waitFor(() => expect(contents.querySelectorAll('ol button')).toHaveLength(2))
  const [first, second] = Array.from(contents.querySelectorAll('ol button'))
  // Both headings have passed the line, so the later one lights.
  await waitFor(() => expect(second.classList.contains('active')).toBe(true))
  fireEvent.click(first)
  // Straight to the heading, with room above it, not to the page's top.
  expect(scrollTo).toHaveBeenCalledWith({ top: 364 - 24, behavior: 'smooth' })
  expect(first.classList.contains('active')).toBe(true)
  expect(second.classList.contains('active')).toBe(false)
  // Scrolling by hand lets the contents follow the reading again.
  fireEvent.wheel(document.querySelector('.reader-page')!)
  await waitFor(() => expect(second.classList.contains('active')).toBe(true))
})

it('zooms the PDF in steps around fitting the width, and back to fitting', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  pdfStub.fail = false
  mount(<Harness />)
  const pdf = await screen.findByTestId('pdf-view')
  expect(pdf.dataset.zoom).toBe('1')
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(screen.getByTestId('pdf-view').dataset.zoom).toBe('1.25')
  expect(screen.getByRole('button', { name: '125%' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '125%' }))
  expect(screen.getByTestId('pdf-view').dataset.zoom).toBe('1')
  // Out to the floor, where the button stops.
  for (let step = 0; step < 6; step++)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
  expect(screen.getByTestId('pdf-view').dataset.zoom).toBe('0.5')
  expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
})

it('folds the zoom away in the text view and grows it out for the PDF', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  pdfStub.fail = false
  mount(<Harness />)
  await screen.findByRole('heading', { name: '3.2Attention' })
  expect(screen.queryByRole('group', { name: 'Zoom' })).toBeNull()
  // Folded into the switch, out of reach, ready to grow out on the way to the PDF.
  const fold = document.querySelector('.reader-zoom-fold') as HTMLElement
  expect(fold.classList.contains('open')).toBe(false)
  expect(fold.hasAttribute('inert')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  const opened = () => document.querySelector('.reader-zoom-fold') as HTMLElement
  await waitFor(() => expect(opened().classList.contains('open')).toBe(true))
  expect(opened().hasAttribute('inert')).toBe(false)
})

it('slides the arriving view in from its button’s side', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  pdfStub.fail = false
  mount(<Harness />)
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
  // Arriving at the Reader doesn't slide.
  expect(document.querySelector('.reader-page')?.className).toBe('reader-page')
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await screen.findByTestId('pdf-view')
  expect(document.querySelector('.reader-page')?.classList.contains('from-right')).toBe(true)
  expect(document.querySelector('.reader-view-switch')?.classList.contains('on-pdf')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Text' }))
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
  expect(document.querySelector('.reader-page')?.classList.contains('from-left')).toBe(true)
})

it('lights what an answer is about when it finishes, and goes there when clicked', async () => {
  const { default: Teacher } = await import('../../src/teacher/Teacher')
  vi.spyOn(api, 'streamAskReader').mockImplementation(async (_body, handlers) => {
    handlers.onToken('As it says, ⟦the dominant models⟧ are recurrent.')
  })
  const { store } = mount(<Teacher />)
  const box = screen.getByPlaceholderText('Ask about this paper, or @ another chat…')
  fireEvent.change(box, { target: { value: 'What came before?' } })
  fireEvent.submit(box.closest('form')!)
  const passages = () => store.getState().highlight.passages
  // Finished: lit, not gone to.
  await waitFor(() => expect(passages()?.quotes).toEqual(['the dominant models']))
  expect(passages()).toMatchObject({ threadId: THREAD.id, answer: 1, scroll: 0 })
  // The answer clicked: gone to; clicked again: put out.
  const answer = (await screen.findByText(/are recurrent/)).closest('.chat') as HTMLElement
  expect(answer.classList.contains('active')).toBe(true)
  fireEvent.click(answer)
  expect(passages()).toBeNull()
  fireEvent.click(answer)
  expect(passages()).toMatchObject({ answer: 1, scroll: 1 })
  // A quote clicked: just it, gone to.
  fireEvent.click(screen.getByRole('button', { name: '“the dominant models”' }))
  expect(passages()).toMatchObject({ quotes: ['the dominant models'], answer: null, scroll: 2 })
})

it('lights only the highlighted passage for an answer to one, its quotes one at a time', async () => {
  const { default: Teacher } = await import('../../src/teacher/Teacher')
  vi.spyOn(api, 'streamAskReader').mockImplementation(async (_body, handlers) => {
    handlers.onToken('It says ⟦the dominant models⟧ are recurrent.')
  })
  const places = [{ page: 3, rects: [[10, 20, 30, 40]] }]
  const { store } = mount(
    <Teacher quote={{ text: 'Recurrent networks', from: 'page 3', places, seq: 1 }} />,
  )
  const box = screen.getByRole('textbox')
  fireEvent.change(box, { target: { value: 'Why?' } })
  fireEvent.submit(box.closest('form')!)
  const passages = () => store.getState().highlight.passages
  // The answer stands for the passage exactly as highlighted (Patrick).
  await waitFor(() =>
    expect(passages()).toMatchObject({ passage: 'Recurrent networks', places, quotes: [] }),
  )
  // A quote clicked: just it.
  fireEvent.click(screen.getByRole('button', { name: '“the dominant models”' }))
  expect(passages()).toMatchObject({ passage: null, places: [], quotes: ['the dominant models'] })
})

it('asks about a box drawn over the PDF with ⌥-drag, by its place', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  pdfStub.fail = false
  const ask = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  const read = vi
    .spyOn(api, 'fetchPdfPassage')
    .mockResolvedValue({ text: 'J(π) = Σ E[r]', places: [] })
  // jsdom lays nothing out: page 2 sits at the top left, at scale 1.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.id === 'reader-page:2' ? new DOMRect(0, 0, 600, 800) : new DOMRect(0, 0, 0, 0)
  })
  const { store } = mount(<Harness onAssistant={() => {}} />)
  await screen.findByTestId('pdf-view')
  const page = document.getElementById('reader-page:2')!
  const drag = (altKey: boolean, to: [number, number]) => {
    fireEvent.mouseDown(page.firstChild!, { altKey, button: 0, clientX: 10, clientY: 20 })
    fireEvent.mouseMove(window, { clientX: to[0], clientY: to[1] })
    fireEvent.mouseUp(window, { clientX: to[0], clientY: to[1] })
  }
  // A click with ⌥ is too small to be a box; a plain drag is a text selection's.
  drag(true, [12, 22])
  drag(false, [110, 70])
  expect(screen.queryByRole('toolbar', { name: 'Boxed area' })).toBeNull()
  // ⌥-drag: a box, its words read, its menu up.
  drag(true, [110, 70])
  const menu = await boxMenu()
  const box = [{ page: 2, rects: [[10, 20, 110, 70]] }]
  expect(read).toHaveBeenCalledWith('1706.03762', 's2', { places: box })
  // Esc lets it go; drawn again, Explain asks about it by its place.
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Boxed area' })).toBeNull())
  drag(true, [110, 70])
  fireEvent.mouseDown(
    within(await boxMenu()).getByRole('button', {
      name: 'Explain',
    }),
  )
  await waitFor(() => expect(ask).toHaveBeenCalled())
  expect(ask.mock.calls[0][0]).toMatchObject({
    question: 'Explain this passage from page 2:\n\n“J(π) = Σ E[r]”',
    places: box,
  })
  expect(selectConversation(store.getState()).chat[0].places).toEqual(box)
  expect(screen.queryByRole('toolbar', { name: 'Boxed area' })).toBeNull()
  expect(menu.isConnected).toBe(false)
})

it('shows a crosshair over the PDF while ⌥ is held, and says how in the controls’ ⓘ', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  pdfStub.fail = false
  mount(<Harness />)
  await screen.findByRole('heading', { name: '3.2Attention' })
  const help = screen.getByRole('button', { name: 'How to use the reader' })
  fireEvent.click(help)
  expect(screen.getByText(/drag a box over equations, figures or tables/)).toBeTruthy()
  fireEvent.click(help)
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }))
  await screen.findByTestId('pdf-view')
  const pane = document.querySelector('[data-tour="reader-page"]') as HTMLElement
  fireEvent.keyDown(document, { key: 'Alt', altKey: true })
  expect(pane.classList.contains('reader-boxing')).toBe(true)
  fireEvent.keyUp(document, { key: 'Alt' })
  expect(pane.classList.contains('reader-boxing')).toBe(false)
  // Pointing with ⌥ already held shows it too.
  fireEvent.mouseMove(document.getElementById('reader-page:1')!, { altKey: true })
  expect(pane.classList.contains('reader-boxing')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'How to use the reader' }))
  expect(screen.getByText(/Hold ⌥ \(Alt\) and drag to draw a box/)).toBeTruthy()
})

it('quotes a box with no words in it as its picture', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue({ available: false, reason: 'no_render' })
  pdfStub.fail = false
  const ask = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  vi.spyOn(api, 'fetchPdfPassage').mockResolvedValue({ text: '', places: [] })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.id === 'reader-page:1' ? new DOMRect(0, 0, 600, 800) : new DOMRect(0, 0, 0, 0)
  })
  mount(<Harness onAssistant={() => {}} />)
  await screen.findByTestId('pdf-view')
  const page = document.getElementById('reader-page:1')!
  fireEvent.mouseDown(page.firstChild!, { altKey: true, button: 0, clientX: 100, clientY: 100 })
  fireEvent.mouseUp(window, { clientX: 300, clientY: 250 })
  fireEvent.mouseDown(
    within(await boxMenu()).getByRole('button', {
      name: 'Simplify',
    }),
  )
  await waitFor(() => expect(ask).toHaveBeenCalled())
  expect(ask.mock.calls[0][0].question).toBe(
    'Simplify, in plain words, this passage from page 1:\n\n“the boxed area, pictured”',
  )
})

it('asks about a box over the text by the whole elements it takes, a figure as its image', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const ask = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  const read = vi.spyOn(api, 'fetchPdfPassage')
  const { store } = mount(<Harness onAssistant={() => {}} />)
  await screen.findByRole('heading', { name: '3.2Attention' })
  const article = document.querySelector('.reader-article') as HTMLElement
  const equation = document.querySelector('.reader-equation') as HTMLElement
  const figure = document.querySelector('.reader-figure') as HTMLElement
  // jsdom lays nothing out: the article at the top left, the equation and
  // the figure one under the other, everything else out of the way.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this === article) return new DOMRect(0, 0, 800, 3000)
    if (this === equation) return new DOMRect(40, 400, 600, 40)
    if (this === figure) return new DOMRect(40, 460, 600, 200)
    return new DOMRect(0, 2000, 0, 0)
  })
  fireEvent.mouseDown(equation, { altKey: true, button: 0, clientX: 100, clientY: 410 })
  fireEvent.mouseMove(window, { clientX: 300, clientY: 500 })
  fireEvent.mouseUp(window, { clientX: 300, clientY: 500 })
  const menu = await boxMenu()
  // Snapped to what it took: the equation and the figure, whole.
  const box = document.querySelector('.reader-text-box') as HTMLElement
  expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual([
    '40px',
    '400px',
    '600px',
    '260px',
  ])
  fireEvent.mouseDown(within(menu).getByRole('button', { name: 'Explain' }))
  await waitFor(() => expect(ask).toHaveBeenCalled())
  const body = ask.mock.calls[0][0]
  // The equation as its LaTeX, the figure as its caption; no PDF read.
  expect(body.question).toContain('$$QK^{T}$$')
  expect(body.question).toContain('Figure 1. The Transformer.')
  expect(body.figures).toEqual(['/api/figure_proxy?src=x'])
  expect(body.places).toBeUndefined()
  expect(read).not.toHaveBeenCalled()
  const turn = selectConversation(store.getState()).chat[0]
  expect(turn.boxedFigures).toEqual(body.figures)
  expect(document.querySelector('.reader-text-box')).toBeNull()
})

it('lights a passage from the other view by its labels, and says when part of it isn’t here', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  vi.spyOn(api, 'findPdfQuotes').mockResolvedValue({ found: [[]], labelled: [[]] })
  pdfStub.fail = false
  const { store } = mount(<Harness />)
  await screen.findByRole('heading', { name: '3.2Attention' })
  const ask = (labels: string[]) =>
    act(() => {
      store.dispatch(
        passagesLit({
          threadId: THREAD.id,
          answer: 1,
          passage: 'glyphs the text has nowhere',
          places: [{ page: 2, rects: [[1, 2, 3, 4]] }],
          labels,
          quotes: [],
          scroll: false,
        }),
      )
    })
  // Asked in the PDF over Figure 1: the text has it, by its label.
  ask(['Figure 1'])
  expect(screen.queryByRole('status')).toBeNull()
  // Over an equation the text has no label for: said, with the PDF offered.
  ask(['(9)'])
  const note = await screen.findByRole('status')
  expect(note.textContent).toContain('Part of this passage isn’t in the text')
  fireEvent.click(within(note).getByRole('button', { name: 'Show in PDF' }))
  await screen.findByTestId('pdf-view')
  // In the PDF it was asked in, nothing is missing.
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
})

it('says when part of a passage asked in the text has no place in the PDF', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const find = vi
    .spyOn(api, 'findPdfQuotes')
    .mockResolvedValue({ found: [[]], labelled: [[{ page: 2, rects: [[1, 2, 3, 4]] }]] })
  pdfStub.fail = false
  const { store } = mount(<Harness />, { ...THREAD, readerView: 'pdf' })
  await screen.findByTestId('pdf-view')
  act(() => {
    store.dispatch(
      passagesLit({
        threadId: THREAD.id,
        answer: 1,
        passage: 'An unnumbered $$x^2$$ and Figure 1. The Transformer.',
        places: [],
        labels: ['Figure 1'],
        quotes: [],
        scroll: false,
      }),
    )
  })
  await waitFor(() =>
    expect(find).toHaveBeenCalledWith(
      '1706.03762',
      's2',
      ['An unnumbered', 'and Figure 1. The Transformer.'],
      ['Figure 1'],
      expect.anything(),
    ),
  )
  // The unnumbered equation has no place in a PDF.
  const note = await screen.findByRole('status')
  expect(note.textContent).toContain('isn’t in the PDF')
  expect(within(note).getByRole('button', { name: 'Show in text' })).toBeTruthy()
})

it('carries the labels a text selection or box reaches into the question', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const opened = vi.fn()
  mount(<Reader thread={THREAD} onAssistant={opened} />)
  const tag = await screen.findByText('(1)')
  const equation = tag.closest('.reader-equation')!
  Range.prototype.getBoundingClientRect ??= () => new DOMRect(100, 200, 80, 16)
  const range = document.createRange()
  range.selectNodeContents(equation.querySelector('.reader-equation-body')!)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.mouseUp(document)
  fireEvent.mouseDown(await screen.findByRole('button', { name: 'Chat' }))
  await waitFor(() => expect(opened).toHaveBeenCalled())
  expect(opened.mock.calls[0][0]).toMatchObject({ labels: ['(1)'] })
})

it('gives a lecture on the paper from the button by its title, its first beat lit', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const guide = vi.spyOn(api, 'streamGuideReader').mockImplementation(async (_body, handlers) => {
    handlers.onBeat({
      heading: 'Queries',
      text: 'A query asks.',
      node_ids: [],
      quote: 'mapping a query',
    })
  })
  const opened = vi.fn()
  const { store } = mount(<Harness onAssistant={opened} />)
  await screen.findByRole('heading', { name: 'Attention Is All You Need' })
  fireEvent.click(screen.getByRole('button', { name: 'Give Lecture On Paper' }))
  // The assistant opens on it, and the whole paper is lectured on.
  expect(opened).toHaveBeenCalledWith()
  await waitFor(() => expect(guide).toHaveBeenCalled())
  expect(guide.mock.calls[0][0]).toMatchObject({ paper: '1706.03762' })
  expect(guide.mock.calls[0][0]).not.toHaveProperty('scope')
  await waitFor(() =>
    expect(store.getState().highlight.passages).toMatchObject({
      answer: 1,
      beat: 0,
      passage: 'mapping a query',
    }),
  )
  expect(selectConversation(store.getState()).chat[0].text).toBe('Give me a lecture on this paper')
})

it('lectures when asked in the chat, and steps beat by beat, one place each', async () => {
  const { default: Teacher } = await import('../../src/teacher/Teacher')
  const guide = vi.spyOn(api, 'streamGuideReader').mockImplementation(async (_body, handlers) => {
    handlers.onBeat({
      heading: 'Queries',
      text: 'A query asks.',
      node_ids: [],
      quote: 'mapping a query',
    })
    // A labelled beat lights its equation alone, not the sentence naming it.
    handlers.onBeat({
      heading: 'The equation',
      text: 'Read it.',
      node_ids: [],
      quote: 'We compute the matrix of outputs as:',
      labels: ['(1)'],
    })
  })
  const route = vi.spyOn(api, 'routeReaderMessage').mockResolvedValue({ target: 'guide' })
  const answer = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  const { store } = mount(<Teacher />)
  // The panel has no lecture button of its own: that's by the title.
  expect(screen.queryByRole('button', { name: /Guide me|Give Lecture/ })).toBeNull()
  const box = screen.getByRole('textbox')
  fireEvent.change(box, { target: { value: 'take me through it all' } })
  fireEvent.submit(box.closest('form')!)
  await waitFor(() => expect(guide).toHaveBeenCalled())
  const chat = () => selectConversation(store.getState()).chat
  await waitFor(() => expect(chat()[0].text).toBe('take me through it all'))
  const lit = () => store.getState().highlight.passages
  // It followed itself to its last beat as it was written.
  await waitFor(() => expect(lit()).toMatchObject({ answer: 1, beat: 1, labels: ['(1)'] }))
  fireEvent.click(await screen.findByRole('button', { name: '‹ Back' }))
  expect(lit()).toMatchObject({ beat: 0, passage: 'mapping a query' })
  fireEvent.click(await screen.findByRole('button', { name: 'Next ›' }))
  expect(lit()).toMatchObject({ answer: 1, beat: 1, passage: null, labels: ['(1)'] })
  // Its bubble is never lit as a whole: only the beat is (Patrick).
  const bubble = screen.getByText('A query asks.').closest('.chat') as HTMLElement
  expect(bubble.classList.contains('active')).toBe(false)
  // Said as a lecture at the top of its bubble, by the timer.
  expect(within(bubble).getByText('Answered as a lecture')).toBeTruthy()
  expect(chat()[1].routedTo).toBe('lecture')
  // It folds behind its caret, and opens again.
  const caret = screen.getByRole('button', { name: /2 beats/ })
  expect(caret.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(caret)
  expect(caret.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(caret)
  expect(caret.getAttribute('aria-expanded')).toBe('true')
  // A question stays a question.
  route.mockResolvedValue({ target: 'answer' })
  fireEvent.change(box, { target: { value: 'what is a query?' } })
  fireEvent.submit(box.closest('form')!)
  await waitFor(() => expect(answer).toHaveBeenCalled())
  expect(guide).toHaveBeenCalledTimes(1)
})

it('never routes a question about an attached passage', async () => {
  const { default: Teacher } = await import('../../src/teacher/Teacher')
  const route = vi.spyOn(api, 'routeReaderMessage')
  const answer = vi.spyOn(api, 'streamAskReader').mockResolvedValue()
  mount(<Teacher quote={{ text: 'Recurrent networks', from: 'section 1', seq: 1 }} />)
  const box = screen.getByRole('textbox')
  fireEvent.change(box, { target: { value: 'walk me through this' } })
  fireEvent.submit(box.closest('form')!)
  await waitFor(() => expect(answer).toHaveBeenCalled())
  expect(route).not.toHaveBeenCalled()
})

it('follows a lecture beat by beat as it is written, until the reader takes over', async () => {
  const { default: Teacher } = await import('../../src/teacher/Teacher')
  let resume: () => void = () => {}
  const paused = new Promise<void>((resolve) => {
    resume = resolve
  })
  vi.spyOn(api, 'routeReaderMessage').mockResolvedValue({ target: 'guide' })
  vi.spyOn(api, 'streamGuideReader').mockImplementation(async (_body, handlers) => {
    handlers.onBeat({ heading: 'One', text: 'First.', node_ids: [], quote: 'first words' })
    handlers.onBeat({ heading: 'Two', text: 'Second.', node_ids: [], quote: 'second words' })
    await paused
    handlers.onBeat({ heading: 'Three', text: 'Third.', node_ids: [], quote: 'third words' })
  })
  const { store } = mount(<Teacher />)
  const lit = () => store.getState().highlight.passages
  const box = screen.getByRole('textbox')
  fireEvent.change(box, { target: { value: 'lecture me' } })
  fireEvent.submit(box.closest('form')!)
  // Following: each beat lit and gone to as it arrives.
  await waitFor(() => expect(lit()).toMatchObject({ beat: 1, passage: 'second words', scroll: 2 }))
  // The reader steps back: the third beat, arriving, leaves them there.
  fireEvent.click(await screen.findByRole('button', { name: '‹ Back' }))
  expect(lit()).toMatchObject({ beat: 0 })
  resume()
  await waitFor(() => expect(selectConversation(store.getState()).chat[1].beats).toHaveLength(3))
  expect(lit()).toMatchObject({ beat: 0, passage: 'first words' })
})

it('has one button over the paper: Back to top when scrolled, the ↑ to the cards at the top', async () => {
  vi.spyOn(api, 'fetchDocument').mockResolvedValue(DOCUMENT)
  const { store } = mount(<Reader thread={THREAD} />)
  await screen.findByRole('heading', { name: '3.2Attention' })
  const pane = document.querySelector('[data-tour="reader-page"]') as HTMLElement
  // At the top: the ↑ to the cards.
  expect(screen.getByRole('button', { name: 'Back to this paper’s cards' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull()
  // Scrolled down: Back to top, back up the paper.
  pane.scrollTop = 900
  fireEvent.scroll(pane)
  fireEvent.click(await screen.findByRole('button', { name: 'Back to top' }))
  expect(Element.prototype.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  expect(screen.queryByRole('button', { name: 'Back to this paper’s cards' })).toBeNull()
  // At the top again: the ↑, to the cards.
  pane.scrollTop = 0
  fireEvent.scroll(pane)
  fireEvent.click(await screen.findByRole('button', { name: 'Back to this paper’s cards' }))
  const saved = store
    .getState()
    .explorations.byId.saved.threads.find((item) => item.id === THREAD.id)
  expect(saved?.tool).toBe('cards')
  // No second Back to top in the contents.
  expect(document.querySelector('.contents-rail-top')).toBeNull()
})
