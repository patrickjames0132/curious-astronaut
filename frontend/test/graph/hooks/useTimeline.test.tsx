// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Timeline x-placement: a paper sits at its year plus a month fraction, so it
 * lands *between* the yearly gridlines rather than on them.
 *
 * The undated case is the interesting one. Papers with no year used to be parked
 * on the seed's own exact column, which stacked every one of them on a single x
 * and drew them as a vertical bar skewered through the seed. They're filtered out
 * of the Timeline view now (GraphExplorer's `nodeOk`), so nothing should place
 * them there any more.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTimeline } from '../../../src/graph/hooks/useTimeline'
import { YEAR_SPACING } from '../../../src/graph/theme'
import type { Base, VNode } from '../../../src/graph/model'

/** A node carrying only what the timeline reads off it. */
function node(id: string, year: number | null, month: number | null, isSeed = false): VNode {
  return {
    id,
    arxiv_id: null,
    title: id,
    year,
    month,
    citation_count: 1,
    url: null,
    rels: [isSeed ? 'seed' : 'citation'],
    is_seed: isSeed,
  } as unknown as VNode
}

/** A Base spanning 2018–2026 with a March-2020 seed. */
function base(nodes: VNode[]): Base {
  return {
    nodes,
    links: [],
    minYear: 2018,
    maxYear: 2026,
    counts: {},
    minCitations: 0,
    maxCitations: 10,
  }
}

function timelineX(nodes: VNode[]) {
  const { result } = renderHook(() =>
    useTimeline({
      base: base(nodes),
      layout: 'timeline',
      fgRef: { current: null },
      size: { width: 800, height: 600 },
      fitDone: { current: false },
      yearLo: 2018,
      yearHi: 2026,
    }),
  )
  return result.current.nodeTimelineX
}

describe('nodeTimelineX', () => {
  it('places a paper at its year offset from the graph’s earliest year', () => {
    const place = timelineX([node('seed', 2020, 3, true)])
    expect(place({ year: 2018, month: 1 })).toBe(0)
    expect(place({ year: 2021, month: 1 })).toBe(3 * YEAR_SPACING)
  })

  it('offsets by month so papers sit between the gridlines', () => {
    const place = timelineX([node('seed', 2020, 3, true)])
    // July is the 7th month → six twelfths into the year.
    expect(place({ year: 2020, month: 7 })).toBeCloseTo((2 + 6 / 12) * YEAR_SPACING)
  })

  it('puts a paper with a year but no month on its year’s gridline', () => {
    const place = timelineX([node('seed', 2020, 3, true)])
    expect(place({ year: 2022, month: null })).toBe(4 * YEAR_SPACING)
  })

  it('does not park an undated paper on the seed’s column', () => {
    // The regression: the seed sits at 2020+2/12, and an undated paper landing
    // there is what drew the vertical bar. Timeline filters undated papers out,
    // so this only guards an undated *seed*, which anchors at the earliest year.
    const place = timelineX([node('seed', 2020, 3, true)])
    const seedX = place({ year: 2020, month: 3 })
    expect(seedX).toBeCloseTo((2 + 2 / 12) * YEAR_SPACING)
    expect(place({ year: null, month: null })).not.toBeCloseTo(seedX)
    expect(place({ year: null, month: null })).toBe(0)
  })
})

/** A stand-in for ForceGraph2D's d3Force registry, with a real-enough link force. */
function fakeGraph() {
  const forces = new Map<string, unknown>()
  let strength: unknown = 1
  let distance: unknown = 30
  const link = {
    strength: (value?: unknown) => (value === undefined ? strength : ((strength = value), link)),
    distance: (value?: unknown) => (value === undefined ? distance : ((distance = value), link)),
  }
  forces.set('link', link)
  forces.set('charge', { strength: () => undefined })
  return {
    fg: {
      d3Force: (name: string, value?: unknown) => {
        if (value === undefined) return forces.get(name)
        forces.set(name, value)
        return undefined
      },
      d3ReheatSimulation: () => {},
    },
    strengthOf: () => strength as (link: unknown, index: number, links: unknown[]) => number,
  }
}

describe('Timeline link pull', () => {
  it('lets no link pull between an expansion’s stream and the seed’s', () => {
    const nodes = [
      node('seed', 2020, 3, true),
      { ...node('origin', 2021, 1), y: 0 },
      { ...node('member', 2022, 1), _origin: 'origin' },
      node('shared', 2021, 5),
    ] as VNode[]
    const graph = fakeGraph()
    const { result } = renderHook(() =>
      useTimeline({
        base: base(nodes),
        layout: 'timeline',
        fgRef: { current: graph.fg },
        size: { width: 800, height: 600 },
        fitDone: { current: false },
        yearLo: 2018,
        yearHi: 2026,
      }),
    )
    result.current.applyLayoutPhysics('timeline')
    const strength = graph.strengthOf()
    const links = [
      { _s: 'origin', _t: 'member' },
      { _s: 'origin', _t: 'seed' },
      { _s: 'shared', _t: 'origin' },
      { _s: 'shared', _t: 'seed' },
    ]
    // Inside the group, and inside the seed's stream: the default pull.
    expect(strength(links[0], 0, links)).toBe(1)
    expect(strength(links[3], 3, links)).toBe(1)
    // Across the two streams: none.
    expect(strength(links[1], 1, links)).toBe(0)
    expect(strength(links[2], 2, links)).toBe(0)
  })
})
