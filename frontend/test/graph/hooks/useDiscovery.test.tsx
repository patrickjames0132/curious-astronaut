// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The discovery merge's origin tracking (the expansion-satellite half of the
 * v5.24.0 layout work): a discovery whose anchor edge lands on a NON-seed
 * node records that node as its `_origin` (the cluster force gathers it
 * there), a seed-anchored or ungrounded discovery records none — and in
 * Timeline, satellites band outward in y past their origin instead of
 * landing inside the settled columns.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDiscovery } from '../../../src/graph/hooks/useDiscovery'
import type { GraphEdge, GraphNode } from '../../../src/api'
import type { Base, VNode } from '../../../src/graph/model'

function makeNode(id: string, overrides: Partial<VNode> = {}): VNode {
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
    rels: ['citation'],
    is_seed: false,
    abstract: null,
    tldr: null,
    x: 100,
    y: 50,
    ...overrides,
  } as VNode
}

function makeBase(nodes: VNode[]): Base {
  return {
    nodes,
    links: [],
    minYear: 2015,
    maxYear: 2026,
    counts: { reference: 0, citation: 0 },
    minCitations: 0,
    maxCitations: 10,
  }
}

const discovery = (id: string): GraphNode =>
  ({ ...makeNode(id), discovered: true, x: undefined, y: undefined }) as GraphNode

function runDiscover(
  base: Base,
  layout: 'force' | 'timeline',
  nodes: GraphNode[],
  edges: GraphEdge[],
  pinned: Set<string> = new Set(),
) {
  const { result } = renderHook(() =>
    useDiscovery({
      base,
      layout,
      pinned,
      nodeTimelineX: (node) => (typeof node.year === 'number' ? node.year * 10 : 0),
      fgRef: { current: null },
      onYearLo: () => {},
      onYearHi: () => {},
    }),
  )
  result.current.onDiscover(nodes, edges)
}

describe('useDiscovery origin tracking', () => {
  it('records the anchor as _origin when the anchor edge lands on a non-seed node', () => {
    const base = makeBase([makeNode('seed', { is_seed: true }), makeNode('expanded')])
    runDiscover(
      base,
      'force',
      [discovery('found')],
      [{ source: 'expanded', target: 'found', type: 'reference' } as GraphEdge],
    )
    const merged = base.nodes.find((node) => node.id === 'found')!
    expect(merged._origin).toBe('expanded')
  })

  it('records no origin for seed-anchored or ungrounded discoveries', () => {
    const base = makeBase([makeNode('seed', { is_seed: true }), makeNode('other')])
    runDiscover(
      base,
      'force',
      [discovery('fromSeed'), discovery('searchHit')],
      [{ source: 'seed', target: 'fromSeed', type: 'reference' } as GraphEdge],
    )
    expect(base.nodes.find((node) => node.id === 'fromSeed')!._origin).toBeUndefined()
    expect(base.nodes.find((node) => node.id === 'searchHit')!._origin).toBeUndefined()
  })

  it('starts a Timeline group at its paper’s height, to glide up into its stream', () => {
    const base = makeBase([
      makeNode('seed', { is_seed: true, y: 0 }),
      makeNode('expanded', { y: 80 }),
      makeNode('high', { y: -200 }),
    ])
    runDiscover(
      base,
      'timeline',
      [discovery('found')],
      [{ source: 'expanded', target: 'found', type: 'reference' } as GraphEdge],
    )
    const merged = base.nodes.find((node) => node.id === 'found')!
    // Near the paper it was found from, not teleported above everything
    // (the stream force carries it up); the date column still pins x.
    expect(Math.abs(merged.y! - 80)).toBeLessThanOrEqual(20)
    expect(merged.fx).toBe(2020 * 10)
  })

  it('thaws the whole frozen timeline when a group forms, all but the reader’s pins', () => {
    // The group's papers have to get past the seed's stream to their own, so
    // nothing may stay frozen in their way; what the reader pinned stays put.
    const base = makeBase([
      makeNode('seed', { is_seed: true, y: 0, fy: 0 }),
      makeNode('expanded', { y: 80, fy: 80 }),
      makeNode('neighbour', { y: 40, fy: 40 }),
      makeNode('pinnedOne', { y: 20, fy: 20 }),
    ])
    runDiscover(
      base,
      'timeline',
      [discovery('found')],
      [{ source: 'expanded', target: 'found', type: 'reference' } as GraphEdge],
      new Set(['pinnedOne']),
    )
    const byId = new Map(base.nodes.map((node) => [node.id, node]))
    expect(byId.get('expanded')!.fy).toBeUndefined()
    expect(byId.get('neighbour')!.fy).toBeUndefined()
    expect(byId.get('seed')!.fy).toBeUndefined()
    expect(byId.get('pinnedOne')!.fy).toBe(20)
  })

  it('leaves a pinned expanded paper where the user put it', () => {
    const base = makeBase([
      makeNode('seed', { is_seed: true, y: 0 }),
      makeNode('expanded', { y: 80, fy: 80 }),
    ])
    runDiscover(
      base,
      'force',
      [discovery('found')],
      [{ source: 'expanded', target: 'found', type: 'reference' } as GraphEdge],
      new Set(['expanded']),
    )
    expect(base.nodes.find((node) => node.id === 'expanded')!.fy).toBe(80)
  })
})

describe('useDiscovery edge safety', () => {
  // The server upholds this invariant itself (the researcher's
  // `_canvas_growth` only ever draws growth that attaches to a drawn paper),
  // but a dangling link is not a cosmetic defect that shows up as a stray
  // line: d3-force raises `missing: <id>` while resolving link endpoints and
  // takes the whole graph down. Too severe to rest on a server-side rule.
  it('drops an edge whose endpoint is not on the canvas', () => {
    const base = makeBase([makeNode('seed', { is_seed: true })])
    runDiscover(
      base,
      'force',
      [discovery('found')],
      [
        { source: 'seed', target: 'found', type: 'reference' } as GraphEdge,
        // Points at a paper that was numbered for the agent but never drawn.
        { source: 'undrawn', target: 'found', type: 'reference' } as GraphEdge,
      ],
    )
    expect(base.links.map((link) => `${link._s}->${link._t}`)).toEqual(['seed->found'])
  })

  it('keeps an edge between two papers arriving in the same discovery', () => {
    const base = makeBase([makeNode('seed', { is_seed: true })])
    runDiscover(
      base,
      'force',
      [discovery('first'), discovery('second')],
      [
        { source: 'seed', target: 'first', type: 'reference' } as GraphEdge,
        { source: 'first', target: 'second', type: 'reference' } as GraphEdge,
      ],
    )
    expect(base.links).toHaveLength(2)
  })

  it('leaves out a discovery stranded off the canvas, and one found only from it', () => {
    // Saved against a paper the rebuilt graph names differently, so every
    // edge points at nothing drawn: it would only float loose.
    const base = makeBase([makeNode('seed', { is_seed: true })])
    runDiscover(
      base,
      'force',
      [discovery('stranded'), discovery('fromStranded'), discovery('kept')],
      [
        { source: 'gone', target: 'stranded', type: 'reference' } as GraphEdge,
        { source: 'stranded', target: 'fromStranded', type: 'reference' } as GraphEdge,
        { source: 'seed', target: 'kept', type: 'reference' } as GraphEdge,
      ],
    )
    expect(base.nodes.map((node) => node.id)).toEqual(['seed', 'kept'])
  })
})

describe('useDiscovery prune', () => {
  it('lets go of the papers and edges the store no longer holds, in place', () => {
    const origin = makeNode('origin')
    const member = makeNode('member', { _origin: 'origin', rels: ['reference'] })
    const base = makeBase([makeNode('seed', { is_seed: true }), origin, member])
    base.counts.reference = 1
    base.links.push(
      { _s: 'seed', _t: 'origin', type: 'citation' } as never,
      { _s: 'origin', _t: 'member', type: 'reference' } as never,
    )
    const nodesArray = base.nodes
    const { result } = renderHook(() =>
      useDiscovery({
        base,
        layout: 'force',
        pinned: new Set(),
        nodeTimelineX: () => 0,
        fgRef: { current: null },
        onYearLo: () => {},
        onYearHi: () => {},
      }),
    )
    act(() =>
      result.current.onPrune(new Set(['seed', 'origin']), new Set(['seed|origin|citation'])),
    )
    // Same array, so the sim's node objects survive.
    expect(base.nodes).toBe(nodesArray)
    expect(base.nodes.map((node) => node.id)).toEqual(['seed', 'origin'])
    expect(base.links).toHaveLength(1)
    expect(base.counts.reference).toBe(0)
    expect(result.current.graphVersion).toBe(1)
  })

  it('thaws the timeline so an undone paper comes back down to the seed’s stream', () => {
    const origin = makeNode('origin', { y: -400, fy: -400 })
    const base = makeBase([
      makeNode('seed', { is_seed: true, y: 0, fy: 0 }),
      origin,
      makeNode('member', { _origin: 'origin' }),
    ])
    base.links.push({ _s: 'origin', _t: 'member', type: 'reference' } as never)
    const { result } = renderHook(() =>
      useDiscovery({
        base,
        layout: 'timeline',
        pinned: new Set(),
        nodeTimelineX: () => 0,
        fgRef: { current: null },
        onYearLo: () => {},
        onYearHi: () => {},
      }),
    )
    act(() => result.current.onPrune(new Set(['seed', 'origin']), new Set()))
    expect(origin.fy).toBeUndefined()
  })
})
