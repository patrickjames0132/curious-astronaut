// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The "Links between papers" lookup: nothing is asked while the switch is
 * off, the graph's papers are asked about once it's on, a pair already drawn
 * as an edge is dropped, a graph that grows is asked again, and a failure
 * reports itself.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePaperLinks } from '../../../src/graph/hooks/usePaperLinks'
import type { Base, VNode } from '../../../src/graph/model'

const fetchPaperLinks = vi.fn()
vi.mock('../../../src/api', () => ({
  fetchPaperLinks: (...args: unknown[]) => fetchPaperLinks(...args),
}))

function makeBase(ids: string[]): Base {
  return {
    nodes: ids.map((id) => ({ id }) as VNode),
    // The seed's own edge to b is drawn already.
    links: [{ source: 'seed', target: 'b', type: 'reference', _s: 'seed', _t: 'b' }],
    minYear: 2000,
    maxYear: 2020,
    counts: {},
    minCitations: 0,
    maxCitations: 1,
  }
}

afterEach(() => fetchPaperLinks.mockReset())

describe('usePaperLinks', () => {
  it('asks nothing while the switch is off', () => {
    const { result } = renderHook(() =>
      usePaperLinks({ base: makeBase(['seed']), graphVersion: 0, provider: 's2', on: false }),
    )
    expect(fetchPaperLinks).not.toHaveBeenCalled()
    expect(result.current).toEqual({ links: [], status: 'off' })
  })

  it('hands back the same empty list on every render while off', () => {
    // GraphExplorer's view memo depends on this list. A fresh [] per render
    // recomputed the view every render, whose effect dispatched to the store,
    // which re-rendered: an update loop that blanked the whole screen.
    const base = makeBase(['seed'])
    const { result, rerender } = renderHook(() =>
      usePaperLinks({ base, graphVersion: 0, provider: 's2', on: false }),
    )
    const first = result.current.links
    rerender()
    expect(result.current.links).toBe(first)
  })

  it('fetches the links, drops pairs already drawn, and re-asks as the graph grows', async () => {
    fetchPaperLinks.mockResolvedValue([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'seed' },
    ])
    const base = makeBase(['seed', 'a', 'b'])
    const { result, rerender } = renderHook(
      ({ version }) =>
        usePaperLinks({ base, graphVersion: version, provider: 'openalex', on: true }),
      { initialProps: { version: 0 } },
    )
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchPaperLinks).toHaveBeenCalledWith(['seed', 'a', 'b'], 'openalex')
    // seed → b is an edge already, so b → seed would paint over it.
    expect(result.current.links).toEqual([{ source: 'a', target: 'b' }])

    rerender({ version: 1 })
    await waitFor(() => expect(fetchPaperLinks).toHaveBeenCalledTimes(2))
  })

  it('reports a failed lookup', async () => {
    fetchPaperLinks.mockRejectedValue(new Error('down'))
    const { result } = renderHook(() =>
      usePaperLinks({ base: makeBase(['seed']), graphVersion: 0, provider: 's2', on: true }),
    )
    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  it('asks again when the attempt is bumped (the button’s retry)', async () => {
    fetchPaperLinks.mockRejectedValueOnce(new Error('down')).mockResolvedValue([])
    const base = makeBase(['seed'])
    const { result, rerender } = renderHook(
      ({ attempt }) => usePaperLinks({ base, graphVersion: 0, provider: 's2', on: true, attempt }),
      { initialProps: { attempt: 0 } },
    )
    await waitFor(() => expect(result.current.status).toBe('error'))
    rerender({ attempt: 1 })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(fetchPaperLinks).toHaveBeenCalledTimes(2)
  })
})
