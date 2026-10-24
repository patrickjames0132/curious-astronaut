// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The Reader card — the parsed paper, its contents, live citations,
 * refs and footnotes, the PDF view and its switch (v8.40.0, pdf.js stubbed),
 * and what it says when there's nothing to read.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { configureStore } from '@reduxjs/toolkit'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type ReactElement, type RefObject } from 'react'
import { Provider, useSelector } from 'react-redux'
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
  }: {
    url: string
    textRef: RefObject<HTMLDivElement | null>
    onLoaded: (info: { pages: number; outline: typeof pdfStub.outline }) => void
    onFailed: (message: string) => void
  }) {
    useEffect(() => {
      pdfStub.urls.push(url)
      if (pdfStub.fail) onFailed('no PDF')
      else onLoaded({ pages: 2, outline: pdfStub.outline })
      // Once per URL, as the real view opens a PDF once.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [url])
    return (
      <div ref={textRef} data-testid="pdf-view">
        {[1, 2].map((page) => (
          <div
            key={page}
            id={`reader-page:${page}`}
            className="reader-pdf-page"
            data-section-id={`page:${page}`}
            data-passage-from={`page ${page}`}
          >
            <span>{`Words on page ${page}.`}</span>
          </div>
        ))}
      </div>
    )
  },
}))

beforeEach(() => {
  // jsdom lays nothing out, so it has no scrolling to do.
  Element.prototype.scrollIntoView = vi.fn()
  pdfStub.fail = true
  pdfStub.outline = []
  pdfStub.urls = []
  // Each test starts with the contents open at their default width: the
  // fold tests remember their choices, and jsdom's storage outlives a test.
  localStorage.removeItem('ca.readerContentsOpen')
  localStorage.removeItem('ca.readerContentsWidth')
  // The server's PDF contents: none unless a test says so (never a real fetch).
  vi.spyOn(api, 'fetchPdfContents').mockResolvedValue([])
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
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
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
  expect(second.querySelector('.reader-contents-number')?.textContent).toBe('3.2')
  expect(second.querySelector('.reader-contents-title')?.textContent).toBe('Attention')
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
