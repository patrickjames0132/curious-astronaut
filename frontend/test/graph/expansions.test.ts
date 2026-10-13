/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Reading a paper's Expand hops back off the discovery lists, and undoing
 * one: its edges go, and so does every discovered paper the graph can no
 * longer reach.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode } from '../../src/api'
import { hopAdded, isHopEdge, withoutHop } from '../../src/graph/expansions'

const paper = (id: string): GraphNode => ({ id, title: id, rels: ['citation'] }) as GraphNode
const edge = (source: string, target: string, type: 'reference' | 'citation'): GraphEdge =>
  ({ source, target, type }) as GraphEdge

/** A seed with one citer, `origin`, expanded both ways. */
function grown() {
  const graph = {
    nodes: [paper('seed'), paper('origin'), paper('shared')],
    edges: [edge('origin', 'seed', 'citation'), edge('shared', 'seed', 'citation')],
  }
  const discoveredNodes = [paper('newRef'), paper('newCiter'), paper('grandchild')]
  const discoveredEdges = [
    edge('origin', 'newRef', 'reference'),
    edge('origin', 'shared', 'reference'),
    edge('newCiter', 'origin', 'citation'),
    // newRef was expanded in turn.
    edge('newRef', 'grandchild', 'reference'),
  ]
  return { graph, discoveredNodes, discoveredEdges }
}

describe('isHopEdge', () => {
  it('tells the hops apart by direction and type', () => {
    expect(isHopEdge(edge('origin', 'x', 'reference'), 'origin', 'references')).toBe(true)
    expect(isHopEdge(edge('x', 'origin', 'citation'), 'origin', 'citations')).toBe(true)
    // Expanding x's citations links origin as a citer of x: not origin's hop.
    expect(isHopEdge(edge('origin', 'x', 'citation'), 'origin', 'citations')).toBe(false)
    expect(isHopEdge(edge('origin', 'x', 'citation'), 'origin', 'references')).toBe(false)
  })
})

describe('hopAdded', () => {
  it('counts the papers a hop brought, null when it has not run', () => {
    const { discoveredNodes, discoveredEdges } = grown()
    // newRef is new; shared was already on the graph, so it is linked, not added.
    expect(hopAdded('origin', 'references', discoveredNodes, discoveredEdges)).toBe(1)
    expect(hopAdded('origin', 'citations', discoveredNodes, discoveredEdges)).toBe(1)
    expect(hopAdded('shared', 'citations', discoveredNodes, discoveredEdges)).toBeNull()
  })

  it('counts a hop that only linked papers already there as run, adding none', () => {
    expect(hopAdded('origin', 'references', [], [edge('origin', 'shared', 'reference')])).toBe(0)
  })
})

describe('withoutHop', () => {
  it('takes the hop’s papers away, with an expansion of one of them', () => {
    const { graph, discoveredNodes, discoveredEdges } = grown()
    const left = withoutHop('origin', 'references', graph, discoveredNodes, discoveredEdges)
    expect(left.nodes.map((node) => node.id)).toEqual(['newCiter'])
    expect(left.edges).toEqual([edge('newCiter', 'origin', 'citation')])
  })

  it('keeps a paper something else still links', () => {
    const { graph, discoveredNodes, discoveredEdges } = grown()
    // newCiter also cites newRef, from another expansion.
    const linked = [...discoveredEdges, edge('newCiter', 'newRef', 'citation')]
    const left = withoutHop('origin', 'references', graph, discoveredNodes, linked)
    expect(left.nodes.map((node) => node.id)).toEqual(['newRef', 'newCiter', 'grandchild'])
    expect(left.edges.some((one) => isHopEdge(one, 'origin', 'references'))).toBe(false)
  })

  it('leaves a legacy discovery that never had an edge', () => {
    const left = withoutHop('origin', 'references', grown().graph, [paper('searchHit')], [])
    expect(left.nodes.map((node) => node.id)).toEqual(['searchHit'])
  })
})
