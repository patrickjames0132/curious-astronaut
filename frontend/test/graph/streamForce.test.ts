/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Timeline's parallel streams: each expansion group pulled into a band above
 * the seed's timeline, stacked in the order the groups formed, sized by the
 * fullest year column, and never moving a frozen or pinned paper.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import { expansionGroups } from '../../src/graph/clusterForce'
import type { VNode } from '../../src/graph/model'
import { streamForce, streamHalfHeights } from '../../src/graph/streamForce'

function makeNode(id: string, overrides: Partial<VNode> = {}): VNode {
  return {
    id,
    arxiv_id: null,
    title: id,
    year: 2020,
    citation_count: 10,
    url: null,
    rels: ['citation'],
    is_seed: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ...overrides,
  } as VNode
}

describe('streamForce', () => {
  it('pulls each group above the seed’s timeline, later groups higher', () => {
    const nodes = [
      makeNode('seed', { is_seed: true, y: 0 }),
      makeNode('main', { y: -50 }),
      makeNode('first', { y: 0 }),
      makeNode('second', { y: 0 }),
      makeNode('a', { _origin: 'first', y: 0 }),
      makeNode('b', { _origin: 'second', y: 0 }),
    ]
    const force = streamForce()
    force.initialize(nodes)
    // A cool sim, so the pull stays under the speed cap and the two compare.
    force(0.05)
    const byId = new Map(nodes.map((node) => [node.id, node]))
    // Upward is negative y. Both groups head up, the second one harder.
    expect(byId.get('first')!.vy!).toBeLessThan(0)
    expect(byId.get('a')!.vy!).toBeLessThan(0)
    expect(byId.get('b')!.vy!).toBeLessThan(byId.get('a')!.vy!)
    // The seed's stream is left where it is.
    expect(byId.get('main')!.vy).toBe(0)
    expect(byId.get('seed')!.vy).toBe(0)
  })

  it('caps how fast a paper heads for its stream, so it glides', () => {
    const nodes = [
      makeNode('seed', { is_seed: true, y: 0 }),
      makeNode('first', { y: 0 }),
      makeNode('member', { _origin: 'first', y: 5000 }),
    ]
    const force = streamForce()
    force.initialize(nodes)
    force(1)
    // Held to its share of the trip left (about 4% of ~5000 a tick), well
    // under the raw pull (15% of it), and well over the floor.
    const speed = Math.abs(nodes[2].vy!)
    expect(speed).toBeGreaterThan(150)
    expect(speed).toBeLessThan(250)
  })

  it('never moves a paper whose height is fixed', () => {
    const frozen = makeNode('first', { y: 0, fy: 0 })
    const force = streamForce()
    force.initialize([
      makeNode('seed', { is_seed: true }),
      frozen,
      makeNode('a', { _origin: 'first' }),
    ])
    force(1)
    expect(frozen.vy).toBe(0)
  })

  it('does nothing on a graph with no expansions', () => {
    const plain = makeNode('plain', { y: -300 })
    const force = streamForce()
    force.initialize([makeNode('seed', { is_seed: true }), plain])
    force(1)
    expect(plain.vy).toBe(0)
  })
})

describe('streamHalfHeights', () => {
  it('sizes a stream by its fullest year column', () => {
    const nodes = [
      makeNode('seed', { is_seed: true }),
      makeNode('origin', { year: 2015 }),
      ...Array.from({ length: 10 }, (_, index) =>
        makeNode(`same-year-${index}`, { _origin: 'origin', year: 2019 }),
      ),
      makeNode('small', { year: 2015 }),
      makeNode('one', { _origin: 'small', year: 2016 }),
    ]
    const halves = streamHalfHeights(nodes, expansionGroups(nodes))
    expect(halves.get('origin')!).toBeGreaterThan(halves.get('small')!)
  })
})
