// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The knowledge graph's camera (the one-shot fit waits for more than the lone paper)
 * its clicks (a shift-click selects, never opens), a find's dimmed edges, and the
 * force that keeps the course a tree (rings by depth, syntheses beside their parent).
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { forwardRef, useImperativeHandle } from 'react'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import KnowledgeGraph, { type KnowledgeGraphProps } from '../../src/knowledge/KnowledgeGraph'
import { createMap, withChildren, withSynthesis } from '../../src/knowledge/model'
import {
  LEVEL_GAP,
  LINK_DISTANCE,
  SYNTHESIS_REACH,
  SYNTHESIS_STRENGTH,
  MEMBER_LINK_STRENGTH,
  type CanvasLink,
  courseDepths,
  hierarchyForce,
  synthesisHeight,
  useGraphData,
  useHierarchyForce,
} from '../../src/knowledge/look'
import { SELECTION_RING } from '../../src/graph/theme'
import { SYNTHESIS_EDGE_DIM } from '../../src/knowledge/look'

/** A "needs" edge's slate (v8.24.0) as `useCanvasInk` reads it with no
 *  stylesheet loaded (jsdom): the `--knowledge-edge*` fallbacks. */
const EDGE = 'rgba(148,163,184,0.38)'
const DIMMED = 'rgba(148,163,184,0.16)'
const BRIGHTER = 'rgba(203,213,225,0.8)'

// The engine stands in as its handle and the props it was last given, so the
// test can stop the "simulation" at will and watch the camera calls.
const engine = vi.hoisted(() => ({
  zoomToFit: vi.fn(),
  props: {} as {
    onEngineStop?: () => void
    onNodeClick?: (node: { id: string }, event?: { shiftKey: boolean }) => void
    linkColor?: (link: { source: string; target: string }) => string
  },
}))
vi.mock('react-force-graph-2d', () => ({
  default: forwardRef((props: typeof engine.props, ref) => {
    engine.props = props
    useImperativeHandle(ref, () => ({
      zoomToFit: engine.zoomToFit,
      centerAt: vi.fn(),
      d3Force: () => null,
    }))
    return null
  }),
}))

afterEach(() => {
  cleanup()
  engine.zoomToFit.mockClear()
})

const PAPER = createMap({ id: 'dqn', title: 'Playing Atari with Deep Reinforcement Learning' })

/**
 * Render the graph over a course.
 *
 * @param map The course to draw.
 * @returns The render result.
 */
function renderGraph(
  map: KnowledgeGraphProps['map'],
  overrides: Partial<KnowledgeGraphProps> = {},
) {
  const props: KnowledgeGraphProps = {
    map,
    width: 800,
    height: 600,
    expanding: new Set(),
    focus: null,
    fitSignal: 0,
    selected: new Set(),
    lit: null,
    anchorId: null,
    onOpen: () => {},
    onExpand: () => {},
    onSelect: () => {},
    onClose: () => {},
    onPinned: () => {},
    ...overrides,
  }
  const view = render(<KnowledgeGraph {...props} />)
  return {
    ...view,
    rerenderWith: (next: typeof map) => view.rerender(<KnowledgeGraph {...props} map={next} />),
  }
}

it('waits for the concepts before its one-shot fit, instead of zooming into the lone paper', () => {
  const { rerenderWith } = renderGraph(PAPER)
  // The paper alone settles while its first breakdown is still being written.
  act(() => engine.props.onEngineStop?.())
  expect(engine.zoomToFit).not.toHaveBeenCalled()

  // The concepts arrive, the sim settles again, and that is the fit.
  rerenderWith(
    withChildren(PAPER, PAPER.rootId, [
      { name: 'Q-learning', why: 'The update rule it approximates.' },
      { name: 'Experience replay', why: 'How it decorrelates samples.' },
    ]),
  )
  act(() => engine.props.onEngineStop?.())
  expect(engine.zoomToFit).toHaveBeenCalledTimes(1)

  // Once only: later settles leave the reader's camera alone.
  act(() => engine.props.onEngineStop?.())
  expect(engine.zoomToFit).toHaveBeenCalledTimes(1)
})

it('a shift-click selects the node and never opens or breaks it down', () => {
  const onOpen = vi.fn()
  const onExpand = vi.fn()
  const onSelect = vi.fn()
  renderGraph(PAPER, { onOpen, onExpand, onSelect })
  const node = { id: PAPER.rootId }
  act(() => engine.props.onNodeClick?.(node, { shiftKey: true }))
  act(() => engine.props.onNodeClick?.(node, { shiftKey: true }))
  expect(onSelect).toHaveBeenCalledTimes(2)
  expect(onOpen).not.toHaveBeenCalled()
  expect(onExpand).not.toHaveBeenCalled()
  // A plain click still opens the lesson.
  act(() => engine.props.onNodeClick?.(node, { shiftKey: false }))
  expect(onOpen).toHaveBeenCalledWith(PAPER.rootId)
})

it('fits on a Fit press, never for the signal it mounted with (the blank 3D switch)', () => {
  const course = withChildren(PAPER, PAPER.rootId, [
    { name: 'Q-learning', why: 'w' },
    { name: 'Experience replay', why: 'w' },
  ])
  // Fit was pressed twice before this view mounted (say, in the other mode).
  const { rerender } = render(
    <KnowledgeGraph
      map={course}
      width={800}
      height={600}
      expanding={new Set()}
      focus={null}
      fitSignal={2}
      selected={new Set()}
      lit={null}
      anchorId={null}
      onOpen={() => {}}
      onExpand={() => {}}
      onSelect={() => {}}
      onClose={() => {}}
      onPinned={() => {}}
    />,
  )
  expect(engine.zoomToFit).not.toHaveBeenCalled()
  rerender(
    <KnowledgeGraph
      map={course}
      width={800}
      height={600}
      expanding={new Set()}
      focus={null}
      fitSignal={3}
      selected={new Set()}
      lit={null}
      anchorId={null}
      onOpen={() => {}}
      onExpand={() => {}}
      onSelect={() => {}}
      onClose={() => {}}
      onPinned={() => {}}
    />,
  )
  expect(engine.zoomToFit).toHaveBeenCalledTimes(1)
})

it('a find dims every edge except those touching a match', () => {
  const course = withChildren(PAPER, PAPER.rootId, [
    { name: 'Q-learning', why: 'w' },
    { name: 'Experience replay', why: 'w' },
  ])
  renderGraph(course, { lit: new Set(['q learning']) })
  const color = engine.props.linkColor!
  // Lit by a focus that isn't its own: a brighter slate.
  expect(color({ source: course.rootId, target: 'q learning' })).toBe(BRIGHTER)
  expect(color({ source: course.rootId, target: 'experience replay' })).toBe(DIMMED)
  // A synthesis's line stays teal, fainter when dimmed, never the slate.
  expect(color({ source: course.rootId, target: 'experience replay', synthesis: true })).toBe(
    SYNTHESIS_EDGE_DIM,
  )
})

it('paints edges a plain slate with no focus, and the open item’s own in blue', () => {
  const course = withChildren(PAPER, PAPER.rootId, [{ name: 'Q-learning', why: 'w' }])
  renderGraph(course, {})
  expect(engine.props.linkColor!({ source: course.rootId, target: 'q learning' })).toBe(EDGE)
  renderGraph({ ...course, openId: 'q learning' }, { lit: new Set(['q learning', course.rootId]) })
  expect(engine.props.linkColor!({ source: course.rootId, target: 'q learning' })).toBe(
    SELECTION_RING,
  )
})

it('under a focused item, lights only its own edges, as on the citation graph', () => {
  const course = withChildren(PAPER, PAPER.rootId, [
    { name: 'Q-learning', why: 'w' },
    { name: 'Experience replay', why: 'w' },
  ])
  const deeper = withChildren(course, 'q learning', [{ name: 'Bellman equations', why: 'w' }])
  renderGraph(deeper, {
    lit: new Set(['q learning', course.rootId, 'bellman equations']),
    anchorId: 'q learning',
  })
  const color = engine.props.linkColor!
  expect(color({ source: course.rootId, target: 'q learning' })).toBe(BRIGHTER)
  expect(color({ source: 'q learning', target: 'bellman equations' })).toBe(BRIGHTER)
  // The paper is lit, but its edge to replay isn't Q-learning's: dimmed.
  expect(color({ source: course.rootId, target: 'experience replay' })).toBe(DIMMED)
})

it('keeps the course a tree: rings by depth, syntheses beside their parent', () => {
  let map = withChildren(PAPER, PAPER.rootId, [
    { name: 'Q-learning', why: 'w' },
    { name: 'Experience replay', why: 'w' },
    { name: 'Vision', why: 'w' },
  ])
  map = withChildren(map, 'q learning', [{ name: 'Bellman equations', why: 'w' }])
  map = withSynthesis(map, {
    name: 'Stable learning',
    why: 'w',
    members: ['q learning', 'experience replay'],
    toward: PAPER.rootId,
  })
  map = withSynthesis(map, {
    name: 'Whole picture',
    why: 'w',
    members: ['synthesis:stable learning', 'vision'],
    toward: PAPER.rootId,
  })
  expect(courseDepths(map).get('bellman equations')).toBe(2)
  expect(synthesisHeight(map, 'synthesis:stable learning')).toBe(1)
  expect(synthesisHeight(map, 'synthesis:whole picture')).toBe(2)

  const nodes = [
    { id: PAPER.rootId, x: 0, y: 0 },
    // One step out, but sitting at 10: pushed outward to its ring.
    { id: 'q learning', x: 10, y: 0, vx: 0, vy: 0 },
    { id: 'experience replay', x: LEVEL_GAP, y: 0, vx: 0, vy: 0 },
    // Two steps out, sitting on the first ring: pushed out to the second.
    { id: 'bellman equations', x: 0, y: LEVEL_GAP, vx: 0, vy: 0 },
    { id: 'synthesis:stable learning', x: 200, y: 200, vx: 0, vy: 0 },
    { id: 'synthesis:whole picture', x: 200, y: 200, vx: 0, vy: 0 },
  ]
  hierarchyForce(map, nodes)(1)
  expect(nodes[1].vx).toBeGreaterThan(0)
  expect(nodes[2].vx).toBeCloseTo(0)
  expect(nodes[3].vy).toBeGreaterThan(0)
  // The synthesis is drawn toward a spot beside the paper, on its members' side.
  const reach = SYNTHESIS_REACH * LEVEL_GAP
  const spotX = ((10 + LEVEL_GAP) / 2 / ((10 + LEVEL_GAP) / 2)) * reach
  expect(nodes[4].vx).toBeCloseTo((spotX - 200) * SYNTHESIS_STRENGTH)
  expect(nodes[4].vy).toBeCloseTo((0 - 200) * SYNTHESIS_STRENGTH)
})

it('sits a more abstract synthesis nearer its parent', () => {
  const pull = (height: number) => {
    let map = withChildren(PAPER, PAPER.rootId, [
      { name: 'A', why: 'w' },
      { name: 'B', why: 'w' },
      { name: 'C', why: 'w' },
    ])
    map = withSynthesis(map, { name: 'Inner', why: 'w', members: ['a', 'b'], toward: PAPER.rootId })
    const members = height === 1 ? ['a', 'c'] : ['synthesis:inner', 'c']
    map = withSynthesis(map, { name: 'Outer', why: 'w', members, toward: PAPER.rootId })
    const nodes = [
      { id: PAPER.rootId, x: 0, y: 0 },
      { id: 'a', x: 100, y: 0 },
      { id: 'b', x: 100, y: 0 },
      { id: 'c', x: 100, y: 0 },
      { id: 'synthesis:inner', x: 100, y: 0 },
      { id: 'synthesis:outer', x: 0, y: 0, vx: 0, vy: 0 },
    ]
    hierarchyForce(map, nodes)(1)
    return nodes[5].vx
  }
  // Both are drawn outward from the paper; the abstract one less far.
  expect(pull(2)).toBeLessThan(pull(1))
  expect(pull(2)).toBeGreaterThan(0)
})

it('starts a new item beside its anchor without a z in 2D, so nothing turns NaN', () => {
  let map = withChildren(PAPER, PAPER.rootId, [
    { name: 'A', why: 'w' },
    { name: 'B', why: 'w' },
  ])
  const { result, rerender } = renderHook(({ course }) => useGraphData(course), {
    initialProps: { course: map },
  })
  // The engine has placed the 2D course; no node has a z.
  for (const node of result.current.nodes) Object.assign(node, { x: 10, y: 20 })
  map = withSynthesis(map, { name: 'Both', why: 'w', members: ['a', 'b'], toward: PAPER.rootId })
  rerender({ course: map })
  const synthesis = result.current.nodes.find((node) => node.id === 'synthesis:both')!
  expect(Math.abs(synthesis.x! - 10)).toBeLessThan(20)
  expect('z' in synthesis).toBe(false)
})

it('keeps a NaN z out of x and y', () => {
  // d3's centring force once turned a 2D course's missing z into NaN.
  let map = withChildren(PAPER, PAPER.rootId, [
    { name: 'A', why: 'w' },
    { name: 'B', why: 'w' },
  ])
  map = withSynthesis(map, { name: 'Both', why: 'w', members: ['a', 'b'], toward: PAPER.rootId })
  const nodes = [
    { id: PAPER.rootId, x: 0, y: 0, z: Number.NaN },
    { id: 'a', x: 10, y: 0, z: Number.NaN, vx: 0, vy: 0 },
    { id: 'b', x: 0, y: 10, z: Number.NaN, vx: 0, vy: 0 },
    { id: 'synthesis:both', x: 50, y: 50, z: 3, vx: 0, vy: 0 },
  ]
  hierarchyForce(map, nodes)(1)
  for (const node of nodes.slice(1)) {
    expect(Number.isFinite(node.vx)).toBe(true)
    expect(Number.isFinite(node.vy)).toBe(true)
  }
})

it('holds a synthesis to its parent with a short, firm line, and barely to its members', () => {
  let map = withChildren(PAPER, PAPER.rootId, [
    { name: 'A', why: 'w' },
    { name: 'B', why: 'w' },
  ])
  map = withSynthesis(map, { name: 'Both', why: 'w', members: ['a', 'b'], toward: PAPER.rootId })
  const links: CanvasLink[] = [
    { source: PAPER.rootId, target: 'a' },
    { source: PAPER.rootId, target: 'b' },
    { source: 'synthesis:both', target: 'a', synthesis: true },
    { source: PAPER.rootId, target: 'synthesis:both', synthesis: true },
  ]
  const linkForce = {
    lengthOf: (_link: CanvasLink) => 0,
    pullOf: (_link: CanvasLink) => 0,
    distance(lengthOf: (link: CanvasLink) => number) {
      linkForce.lengthOf = lengthOf
      return linkForce
    },
    strength(pullOf: (link: CanvasLink) => number) {
      linkForce.pullOf = pullOf
      return linkForce
    },
  }
  const fgRef = { current: { d3Force: (name: string) => (name === 'link' ? linkForce : null) } }
  renderHook(() => useHierarchyForce(fgRef, map, { nodes: [], links }))
  expect(linkForce.lengthOf(links[3])).toBeCloseTo(SYNTHESIS_REACH * LEVEL_GAP)
  expect(linkForce.pullOf(links[3])).toBe(1)
  expect(linkForce.lengthOf(links[2])).toBe(LINK_DISTANCE)
  expect(linkForce.pullOf(links[2])).toBe(MEMBER_LINK_STRENGTH)
  // The paper has three lines, A two: one over the busier end's count.
  expect(linkForce.pullOf(links[0])).toBeCloseTo(1 / 2)
})

it('a lone click on the open item closes it; a quick second click still breaks it down', () => {
  vi.useFakeTimers()
  try {
    const open = { ...PAPER, openId: PAPER.rootId }
    const onClose = vi.fn()
    const onExpand = vi.fn()
    const onOpen = vi.fn()
    renderGraph(open, { onClose, onExpand, onOpen })
    const node = { id: PAPER.rootId }
    act(() => engine.props.onNodeClick?.(node))
    // Not yet: the double-click window has to pass first.
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(400))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpen).not.toHaveBeenCalled()

    // A double-click on the open item breaks it down and leaves it open.
    vi.advanceTimersByTime(1000)
    act(() => engine.props.onNodeClick?.(node))
    act(() => engine.props.onNodeClick?.(node))
    act(() => vi.advanceTimersByTime(400))
    expect(onExpand).toHaveBeenCalledWith(PAPER.rootId)
    expect(onClose).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})
