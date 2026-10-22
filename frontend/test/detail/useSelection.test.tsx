// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What a freshly built graph leaves open: nothing. Selection starts (and, on
 * every new graph, returns to) null — v7.9.0's "a graph opens onto the graph,
 * not onto its panels" — so the detail panel only appears once a paper is
 * clicked. The seed is no longer auto-selected; the chat-citation path and the
 * guided tour open it explicitly, from GraphExplorer. And the clicks: a
 * lone second click on the open paper closes it once the double-click window
 * has passed, and a quick double-click goes to `onDoubleClick` (v8.33.0).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSelection } from '../../src/detail/useSelection'
import type { GraphResponse } from '../../src/api'
import type { Base, VNode } from '../../src/graph/model'

// The panel's lazy fetches fire the moment something IS selected; none of
// them is under test here, and the suite never touches the network.
vi.mock('../../src/api', () => ({
  fetchPaperDetail: vi.fn(() => Promise.resolve({})),
  fetchFigures: vi.fn(() => Promise.resolve({ available: false, figures: [] })),
  fetchCodeLinks: vi.fn(() => Promise.resolve({ available: false })),
  fetchCategories: vi.fn(() => Promise.resolve({ available: false })),
}))

/** A graph node carrying enough detail that selecting it hydrates nothing. */
function makeNode(id: string, isSeed = false): VNode {
  return {
    id,
    arxiv_id: null,
    title: id,
    year: 2020,
    month: null,
    pub_date: null,
    citation_count: 1,
    authors: null,
    url: null,
    rels: isSeed ? [] : ['citation'],
    is_seed: isSeed,
    abstract: `${id} abstract`,
    tldr: null,
  } as unknown as VNode
}

/** A graph and the matching per-graph dataset, seeded on `seedId`. */
function makeWorld(seedId: string) {
  const seed = makeNode(seedId, true)
  const neighbor = makeNode(`${seedId}-neighbor`)
  const graph: GraphResponse = {
    seed: { id: seedId, arxiv_id: null, title: seedId },
    nodes: [seed, neighbor],
    edges: [],
    counts: { reference: 0, citation: 1 },
  } as unknown as GraphResponse
  const base: Base = {
    nodes: [seed, neighbor],
    links: [],
    minYear: 2019,
    maxYear: 2021,
    counts: { reference: 0, citation: 1 },
    minCitations: 0,
    maxCitations: 10,
  }
  return { graph, base, seed, neighbor }
}

/** Mount the hook over one world; `onDoubleClick` records the re-seeds. */
function mount(world: ReturnType<typeof makeWorld>, onDoubleClick = vi.fn()) {
  return renderHook(
    ({ graph, base }: Pick<ReturnType<typeof makeWorld>, 'graph' | 'base'>) =>
      useSelection({ base, graph, provider: 's2', onDoubleClick }),
    { initialProps: { graph: world.graph, base: world.base } },
  )
}

describe('useSelection on a new graph', () => {
  it('opens nothing — the seed is not auto-selected', () => {
    const world = makeWorld('seed-1')
    const { result } = mount(world)
    expect(result.current.selectedId).toBeNull()
    expect(result.current.selected).toBeNull()
  })

  it('clears an open paper when the next graph lands', () => {
    const world = makeWorld('seed-1')
    const { result, rerender } = mount(world)

    act(() => result.current.onNodeClick(world.neighbor))
    expect(result.current.selectedId).toBe('seed-1-neighbor')

    const next = makeWorld('seed-2')
    rerender({ graph: next.graph, base: next.base })
    expect(result.current.selectedId).toBeNull()
    expect(result.current.selected).toBeNull()
  })

  it('still opens the paper a click asks for', () => {
    const world = makeWorld('seed-1')
    const { result } = mount(world)

    act(() => result.current.onNodeClick(world.seed))
    expect(result.current.selectedId).toBe('seed-1')
    expect(result.current.selected?.title).toBe('seed-1')

    // And the tour / chat-citation path sets it directly, the same way.
    act(() => result.current.setSelectedId(world.neighbor.id))
    expect(result.current.selected?.id).toBe('seed-1-neighbor')
  })
})

describe('useSelection clicks', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** Let the double-click window pass between two clicks. */
  const pause = () => act(() => vi.advanceTimersByTime(400))

  it('a second click on the open paper closes it once the double-click window passes', () => {
    const world = makeWorld('seed-1')
    const { result } = mount(world)
    act(() => result.current.onNodeClick(world.neighbor))
    expect(result.current.selectedId).toBe(world.neighbor.id)
    pause()
    act(() => result.current.onNodeClick(world.neighbor))
    // Not yet: a second click inside the window would be a double-click.
    expect(result.current.selectedId).toBe(world.neighbor.id)
    pause()
    expect(result.current.selectedId).toBeNull()
    act(() => result.current.onNodeClick(world.neighbor))
    expect(result.current.selectedId).toBe(world.neighbor.id)
  })

  it('a quick double-click hands the paper over and leaves it open', () => {
    const world = makeWorld('seed-1')
    const onDoubleClick = vi.fn()
    const { result } = mount(world, onDoubleClick)
    act(() => result.current.onNodeClick(world.neighbor))
    act(() => result.current.onNodeClick(world.neighbor))
    expect(onDoubleClick).toHaveBeenCalledExactlyOnceWith(world.neighbor)
    pause()
    expect(result.current.selectedId).toBe(world.neighbor.id)
  })

  it('a double-click on the open paper re-seeds instead of closing it', () => {
    const world = makeWorld('seed-1')
    const onDoubleClick = vi.fn()
    const { result } = mount(world, onDoubleClick)
    act(() => result.current.onNodeClick(world.neighbor))
    pause()
    act(() => result.current.onNodeClick(world.neighbor))
    act(() => result.current.onNodeClick(world.neighbor))
    expect(onDoubleClick).toHaveBeenCalledOnce()
    pause()
    expect(result.current.selectedId).toBe(world.neighbor.id)
  })

  it('two slow clicks are not a double-click', () => {
    const world = makeWorld('seed-1')
    const onDoubleClick = vi.fn()
    const { result } = mount(world, onDoubleClick)
    act(() => result.current.onNodeClick(world.neighbor))
    pause()
    act(() => result.current.onNodeClick(world.neighbor))
    pause()
    expect(onDoubleClick).not.toHaveBeenCalled()
  })

  it('a click on another paper moves the selection rather than closing it', () => {
    const world = makeWorld('seed-1')
    const onDoubleClick = vi.fn()
    const { result } = mount(world, onDoubleClick)
    act(() => result.current.onNodeClick(world.neighbor))
    act(() => result.current.onNodeClick(world.seed))
    expect(result.current.selectedId).toBe(world.seed.id)
    expect(onDoubleClick).not.toHaveBeenCalled()
  })

  it('a close still waiting when the next graph lands does nothing', () => {
    const world = makeWorld('seed-1')
    const { result, rerender } = mount(world)
    act(() => result.current.onNodeClick(world.neighbor))
    pause()
    act(() => result.current.onNodeClick(world.neighbor))
    const next = makeWorld('seed-2')
    rerender({ graph: next.graph, base: next.base })
    act(() => result.current.onNodeClick(next.neighbor))
    pause()
    expect(result.current.selectedId).toBe(next.neighbor.id)
  })
})
