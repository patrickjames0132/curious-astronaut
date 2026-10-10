// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The knowledge graph's camera (the one-shot fit waits for more than the lone paper)
 * and its clicks (a shift-click selects, never opens).
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { forwardRef, useImperativeHandle } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import KnowledgeGraph, { type KnowledgeGraphProps } from '../../src/knowledge/KnowledgeGraph'
import { createMap, withChildren } from '../../src/knowledge/model'

// The engine stands in as its handle and the props it was last given, so the
// test can stop the "simulation" at will and watch the camera calls.
const engine = vi.hoisted(() => ({
  zoomToFit: vi.fn(),
  props: {} as {
    onEngineStop?: () => void
    onNodeClick?: (node: { id: string }, event?: { shiftKey: boolean }) => void
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
    onOpen: () => {},
    onExpand: () => {},
    onSelect: () => {},
    onBackground: () => {},
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
      onOpen={() => {}}
      onExpand={() => {}}
      onSelect={() => {}}
      onBackground={() => {}}
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
      onOpen={() => {}}
      onExpand={() => {}}
      onSelect={() => {}}
      onBackground={() => {}}
      onPinned={() => {}}
    />,
  )
  expect(engine.zoomToFit).toHaveBeenCalledTimes(1)
})
