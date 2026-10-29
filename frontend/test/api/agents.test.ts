/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * `routeMessage`'s one real contract: it never rejects — and neither does
 * `resolveRoutedPapers`, its second half. And since v9.0.0, which view each
 * of the client's functions asks the one assistant from.
 *
 * The first sits in front of every message the reader sends, so a throw here
 * would break asking questions in order to protect a routing nicety. The
 * backend takes the same position for its own failures; these cover the ones
 * it never gets to see — the request that dies in the browser.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveRoutedPapers,
  routeMessage,
  routePlace,
  routeReaderMessage,
  streamAsk,
  streamAskCourse,
  streamAskReader,
  streamAskSources,
  streamGuideReader,
  streamLecture,
} from '../../src/api'
import type { CourseContext, GraphNode } from '../../src/api'

const ANSWER = {
  target: 'answer',
  framing: 'summary',
  scope: 'screen',
  year_from: null,
  year_to: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('routeMessage', () => {
  it('returns the backend decision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          workflow: 'lecture',
          framing: 'history',
          scope: 'references',
          year_from: null,
          year_to: null,
        }),
      })),
    )
    expect(await routeMessage('lecture me on the references')).toEqual({
      target: 'lecture',
      framing: 'history',
      scope: 'references',
      year_from: null,
      year_to: null,
    })
  })

  it('sends the message untrimmed', async () => {
    // The backend's fast path anchors on how the message opens, and an `@`
    // mention is the router's to read — so the client must not tidy either
    // away first.
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ANSWER }))
    vi.stubGlobal('fetch', fetchMock)
    await routeMessage('  @DQN what is this?  ')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ message: '  @DQN what is this?  ', view: { kind: 'citations' } })
  })

  it('answers when the request fails outright', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await routeMessage('what is attention?')).toEqual(ANSWER)
  })

  it('answers on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    )
    expect(await routeMessage('what is attention?')).toEqual(ANSWER)
  })

  it('answers when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error('not json')
        },
      })),
    )
    expect(await routeMessage('what is attention?')).toEqual(ANSWER)
  })
})

describe('resolveRoutedPapers', () => {
  const papers = [{ id: 'p1', title: 'BERT', year: 2019, authors: 'Devlin' }]

  it('returns the ids the backend picked, and sends the paper list', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ids: ['p1'] }) }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await resolveRoutedPapers('lecture me on BERT', papers)).toEqual(['p1'])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ message: 'lecture me on BERT', papers })
  })

  it('keeps only string ids from a malformed body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ids: ['p1', 7, null] }) })),
    )
    expect(await resolveRoutedPapers('lecture me on BERT', papers)).toEqual(['p1'])
  })

  it('matches nothing when the request fails outright', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await resolveRoutedPapers('lecture me on BERT', papers)).toEqual([])
  })

  it('matches nothing on a non-OK response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    )
    expect(await resolveRoutedPapers('lecture me on BERT', papers)).toEqual([])
  })
})

describe('one assistant, asked from each view (v9.0.0)', () => {
  const seed = { id: 'seed01', title: 'Playing Atari' } as GraphNode
  const course: CourseContext = { paper: 'Playing Atari', open: null, items: [] }

  /** Stub fetch with a finished stream, and return what each call posted. */
  function posted() {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response('event: done\ndata: {}\n\n', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return () =>
      fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init.body))] as const)
  }

  it('routes a Reader message in the reader view, and answers on any failure', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ workflow: 'guide' }) }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await routeReaderMessage('walk me through it')).toEqual({ target: 'guide' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).view).toEqual({ kind: 'reader' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    )
    expect(await routeReaderMessage('walk me through it')).toEqual({ target: 'answer' })
  })

  it('asks every answer from its view, with the rest beside it', async () => {
    const calls = posted()
    const handlers = { onToken: () => {}, onCited: () => {} }
    await streamAsk({ question: 'q', seed, nodes: [seed], provider: 's2', quick: true }, handlers)
    await streamAskSources({ question: 'q', provider: 'openalex', year_from: 2020 }, handlers)
    await streamAskCourse({ question: 'q', course, provider: 's2' }, handlers)
    await streamAskReader(
      { question: 'q', paper: '1706.03762', section: 'S1', provider: 's2', model: 'openai:x' },
      handlers,
    )
    expect(calls()).toEqual([
      [
        '/api/assistant',
        {
          question: 'q',
          provider: 's2',
          quick: true,
          view: { kind: 'citations', seed, nodes: [seed] },
        },
      ],
      [
        '/api/assistant',
        { question: 'q', provider: 'openalex', view: { kind: 'general', year_from: 2020 } },
      ],
      ['/api/assistant', { question: 'q', provider: 's2', view: { kind: 'knowledge', course } }],
      [
        '/api/assistant',
        {
          question: 'q',
          provider: 's2',
          model: 'openai:x',
          view: { kind: 'reader', paper: '1706.03762', section: 'S1' },
        },
      ],
    ])
  })

  it('asks for a lecture and a guided read by workflow', async () => {
    const calls = posted()
    const onBeat = () => {}
    await streamLecture({ seed, nodes: [seed], framing: 'history', target: seed }, { onBeat })
    await streamGuideReader(
      { paper: '1706.03762', section: null, known: ['Softmax'], learning: [], provider: 's2' },
      { onBeat },
    )
    expect(calls()).toEqual([
      [
        '/api/assistant',
        {
          workflow: 'lecture',
          view: { kind: 'citations', seed, nodes: [seed], framing: 'history', bridge: seed },
        },
      ],
      [
        '/api/assistant',
        {
          workflow: 'guide',
          provider: 's2',
          view: {
            kind: 'reader',
            paper: '1706.03762',
            section: null,
            known: ['Softmax'],
            learning: [],
          },
        },
      ],
    ])
  })

  it('relays only the frames a caller has handlers for', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            'event: token\ndata: {"text":"Hi"}\n\nevent: cited\ndata: {"node_ids":["seed01"]}\n\n' +
              'event: done\ndata: {}\n\n',
            { status: 200 },
          ),
      ),
    )
    const tokens: string[] = []
    const cited: string[][] = []
    let done = false
    await streamAsk(
      { question: 'q', seed, nodes: [seed], provider: 's2' },
      {
        onToken: (text) => tokens.push(text),
        onCited: (ids) => cited.push(ids),
        onDone: () => {
          done = true
        },
      },
    )
    expect([tokens, cited, done]).toEqual([['Hi'], [['seed01']], true])
  })
})

describe('routePlace (v9.0.0, stage 4b)', () => {
  it('sends the papers and the screen, and keeps it here on any failure', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ place: 'paper', paper: 2, tool: 'graph' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await routePlace('and Atari?', ['A', 'B'], { paper: 1, tool: 'reader' })).toEqual({
      place: 'paper',
      paper: 2,
      tool: 'graph',
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      message: 'and Atari?',
      papers: ['A', 'B'],
      screen: { paper: 1, tool: 'reader' },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    )
    expect((await routePlace('x', ['A'], { paper: null, tool: null })).place).toBe('here')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect((await routePlace('x', ['A'], { paper: null, tool: null })).place).toBe('here')
  })
})
