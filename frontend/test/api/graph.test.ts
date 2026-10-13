/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * `expandPaper`'s request: the hop sized like the seed's own neighbourhood
 * needs the reader's build shape on the query string (as the graph stream
 * sends it) and the paper's arXiv id in the body.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandPaper } from '../../src/api'
import { DEFAULT_SHAPE, setBuildShape } from '../../src/graph/buildShape'

afterEach(() => {
  vi.unstubAllGlobals()
  setBuildShape(DEFAULT_SHAPE)
})

describe('expandPaper', () => {
  it('sends the build shape and the arXiv id with the hop', async () => {
    setBuildShape({ ...DEFAULT_SHAPE, adaptive: false, nodesPerBand: 30 })
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ nodes: [], edges: [] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expandPaper('CorpusId:7', 'citations', 's2', ['seed'], '1509.06461')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.startsWith('/api/graph/expand?')).toBe(true)
    expect(new URL(url, 'http://host').searchParams.get('adaptive')).toBe('0')
    expect(JSON.parse(init.body as string)).toEqual({
      id: 'CorpusId:7',
      hop: 'citations',
      provider: 's2',
      known_ids: ['seed'],
      arxiv_id: '1509.06461',
    })
  })
})
