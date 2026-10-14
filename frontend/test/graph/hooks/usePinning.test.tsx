// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Drag-to-pin, and the group drag (v8.18.0's polish): dragging a selected
 * paper carries the rest of the selection with it and pins them all where
 * they land; in Timeline only their heights move.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePinning } from '../../../src/graph/hooks/usePinning'
import type { Base, VNode } from '../../../src/graph/model'

/** A positioned paper. */
function paper(id: string, left: number, top: number): VNode {
  return { id, title: id, year: 2020, rels: ['citation'], x: left, y: top } as unknown as VNode
}

/** A Base over the given papers. */
function makeBase(nodes: VNode[]): Base {
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

/** Mount the hook over three papers, two of them selected. */
function mount(layout: 'force' | 'timeline') {
  const dragged = paper('dragged', 0, 0)
  const companion = paper('companion', 100, 50)
  const bystander = paper('bystander', 200, 200)
  // Built once, outside the render: a new base each render would reset the
  // pins each render (the hook's per-graph reset) and never settle.
  const base = makeBase([dragged, companion, bystander])
  const selectedIds = new Set(['dragged', 'companion'])
  const fgRef = { current: null }
  const nodeTimelineX = () => 777
  const visibleIds: { current: Set<string> | null } = { current: null }
  const { result } = renderHook(() =>
    usePinning({ base, layout, nodeTimelineX, fgRef, selectedIds, visibleIds }),
  )
  return { result, dragged, companion, bystander, visibleIds }
}

describe('usePinning group drag', () => {
  it('carries the rest of the selection along and pins them all on drop', () => {
    const { result, dragged, companion, bystander } = mount('force')
    act(() => result.current.onNodeDrag(dragged, { x: 10, y: -5 }))
    act(() => result.current.onNodeDrag(dragged, { x: 10, y: -5 }))
    expect([companion.x, companion.y]).toEqual([120, 40])
    expect([companion.fx, companion.fy]).toEqual([120, 40])
    // Outside the selection, nothing moves.
    expect([bystander.x, bystander.y]).toEqual([200, 200])
    act(() => result.current.onNodeDragEnd(dragged))
    expect([...result.current.pinned].sort()).toEqual(['companion', 'dragged'])
  })

  it('moves only the heights in Timeline, re-pinning the date columns on drop', () => {
    const { result, dragged, companion } = mount('timeline')
    act(() => result.current.onNodeDrag(dragged, { x: 10, y: -5 }))
    expect([companion.x, companion.y]).toEqual([100, 45])
    act(() => result.current.onNodeDragEnd(dragged))
    expect([companion.fx, companion.fy]).toEqual([777, 45])
  })

  it('drags an unselected paper alone', () => {
    const { result, companion, bystander } = mount('force')
    act(() => result.current.onNodeDrag(bystander, { x: 10, y: 10 }))
    act(() => result.current.onNodeDragEnd(bystander))
    expect([companion.x, companion.y]).toEqual([100, 50])
    expect([...result.current.pinned]).toEqual(['bystander'])
  })

  it('holds every other paper still through the drop, letting go once it settles', () => {
    const { result, dragged, bystander } = mount('force')
    act(() => result.current.onNodeDrag(dragged, { x: 10, y: 10 }))
    // Pinned in place, so no link can tow it after the selection.
    expect([bystander.fx, bystander.fy]).toEqual([200, 200])
    // Still held on the drop: the drag left the sim hot (v8.22.0).
    act(() => result.current.onNodeDragEnd(dragged))
    expect([bystander.fx, bystander.fy]).toEqual([200, 200])
    act(() => result.current.releaseHeld())
    expect([bystander.fx, bystander.fy]).toEqual([undefined, undefined])
  })

  it('a paper dropped alone while still held keeps its new pin through the release', () => {
    const { result, dragged, bystander } = mount('force')
    act(() => result.current.onNodeDrag(dragged, { x: 10, y: 10 }))
    act(() => result.current.onNodeDragEnd(dragged))
    // Before the settle, the held bystander is dragged on its own.
    bystander.x = 300
    bystander.y = 320
    act(() => result.current.onNodeDrag(bystander, { x: 100, y: 120 }))
    act(() => result.current.onNodeDragEnd(bystander))
    act(() => result.current.releaseHeld())
    expect([bystander.fx, bystander.fy]).toEqual([300, 320])
    expect(result.current.pinned.has('bystander')).toBe(true)
  })

  it('a second group drag first gives back what the first one held', () => {
    const { result, dragged, companion, bystander } = mount('force')
    act(() => result.current.onNodeDrag(dragged, { x: 10, y: 10 }))
    act(() => result.current.onNodeDragEnd(dragged))
    act(() => result.current.onNodeDrag(companion, { x: 5, y: 5 }))
    // Held again by this drag, from where it stands now.
    expect([bystander.fx, bystander.fy]).toEqual([bystander.x, bystander.y])
    act(() => result.current.onNodeDragEnd(companion))
    act(() => result.current.releaseHeld())
    expect([bystander.fx, bystander.fy]).toEqual([undefined, undefined])
  })

  it('leaves a selected paper outside the held focus behind', () => {
    const { result, dragged, companion, visibleIds } = mount('force')
    visibleIds.current = new Set(['dragged'])
    act(() => result.current.onNodeDrag(dragged, { x: 10, y: 10 }))
    expect([companion.x, companion.y]).toEqual([100, 50])
    act(() => result.current.onNodeDragEnd(dragged))
    expect([...result.current.pinned]).toEqual(['dragged'])
  })
})
