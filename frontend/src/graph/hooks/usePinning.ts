/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Pin state for the explorer: which nodes the user has fixed in place, plus
 * the drag / toggle / release handlers that set and clear fx/fy on the live
 * simulation nodes.
 *
 * Timeline-aware throughout: in Timeline mode a node's x always stays pinned
 * to its date column — dragging only sets its height, and releasing restores
 * the column pin rather than freeing the node entirely.
 *
 * **Group drag (v8.18.0's polish):** dragging a paper in the hand-picked
 * selection (the cyan rings) moves the whole selection with it, by the same
 * offset each step, and drops every one of them pinned where it lands: the
 * way a set of selected shapes moves together in a slide editor. A selection
 * is the set the reader acts on, and moving it is one more action on it.
 * Dragging a paper outside the selection moves just that paper.
 *
 * Only the selection moves. While a focus is held, a selected paper outside
 * it is dimmed and its ring hidden, so it stays behind (`visibleIds`). And
 * every other paper is held still for the length of the drag, then let go on
 * the drop: until then the links towed every paper linked to the selection
 * along behind it.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Base, DragStep, VNode } from '../model'

/** Arguments for {@link usePinning}. */
export interface UsePinningArgs {
  /** The stable per-graph dataset whose node objects carry the fx/fy pins. */
  base: Base | null
  /** The current layout mode (release semantics differ in Timeline). */
  layout: 'force' | 'timeline'
  /** A node's date-column x (from useTimeline), for Timeline-mode re-pinning. */
  nodeTimelineX: (node: { year: number | null; month?: number | null }) => number
  /** The ForceGraph2D ref, to reheat the sim after releasing pins. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: { current: any }
  /** The hand-picked selection: dragging one of them moves them all. */
  selectedIds: Set<string>
  /** The papers on show when a focus is held (the rest are dimmed), else
   *  null: a group drag carries only the selected papers among them. A ref,
   *  because the explorer works the focus out after the pins it depends on. */
  visibleIds: { current: Set<string> | null }
}

/** What {@link usePinning} returns for GraphExplorer to wire up. */
export interface PinningApi {
  /** Ids of the nodes the user has pinned. */
  pinned: Set<string>
  /** Clear pin STATE only (layout switches re-pin the nodes themselves). */
  clearPins: () => void
  /** Drag-step handler: carry the rest of the selection along with a
   *  selected paper (`translate` is the step's offset in graph units). */
  onNodeDrag: (node: VNode, translate: DragStep) => void
  /** Drag-release handler: pin the node where it was dropped (and the rest
   *  of the selection, when it was one of them). */
  onNodeDragEnd: (node: VNode) => void
  /** Pin a node at its current position, or release it if already pinned. */
  togglePin: (id: string) => void
  /** Unpin every node (keeps Timeline date columns when in Timeline). */
  releaseAll: () => void
}

/**
 * Own the pinned-node state and the fx/fy mutations behind it.
 *
 * Pin state resets whenever a new graph loads (the fresh node objects carry
 * no pins).
 *
 * @returns The pinned-id set + the pin/unpin/release handlers.
 */
export function usePinning({
  base,
  layout,
  nodeTimelineX,
  fgRef,
  selectedIds,
  visibleIds,
}: UsePinningArgs): PinningApi {
  const [pinned, setPinned] = useState<Set<string>>(new Set())

  // A new graph starts unpinned.
  useEffect(() => {
    setPinned(new Set())
  }, [base])

  const clearPins = useCallback(() => setPinned(new Set()), [])

  /** The rest of a dragged paper's group: the other selected papers on show,
   *  when it's selected; none otherwise. */
  const companionsOf = useCallback(
    (node: VNode): VNode[] =>
      base && selectedIds.has(node.id)
        ? base.nodes.filter(
            (other) =>
              other.id !== node.id &&
              selectedIds.has(other.id) &&
              (!visibleIds.current || visibleIds.current.has(other.id)),
          )
        : [],
    [base, selectedIds, visibleIds],
  )

  // The papers held still during a group drag, with the pins they had before,
  // to give back on the drop. Null between drags.
  const heldStill = useRef<Map<VNode, { fx?: number; fy?: number }> | null>(null)

  const onNodeDrag = useCallback(
    (node: VNode, translate: DragStep) => {
      const companions = companionsOf(node)
      if (companions.length && base && !heldStill.current) {
        const moving = new Set([node, ...companions])
        heldStill.current = new Map()
        for (const other of base.nodes) {
          if (moving.has(other) || typeof other.x !== 'number') continue
          heldStill.current.set(other, { fx: other.fx, fy: other.fy })
          other.fx = other.x
          other.fy = other.y
        }
      }
      for (const other of companions) {
        if (typeof other.x !== 'number' || typeof other.y !== 'number') continue
        // Held where the drag puts them, like the dragged paper. In Timeline
        // only the height moves: x belongs to the date column.
        other.y += translate.y
        other.fy = other.y
        if (layout !== 'timeline') {
          other.x += translate.x
          other.fx = other.x
        }
      }
    },
    [companionsOf, base, layout],
  )

  const onNodeDragEnd = useCallback(
    (node: VNode) => {
      // Let go of everything held still, back to the pins it had.
      for (const [other, pins] of heldStill.current ?? []) {
        other.fx = pins.fx
        other.fy = pins.fy
      }
      heldStill.current = null
      const dropped = [node, ...companionsOf(node)]
      for (const paper of dropped) {
        if (layout === 'timeline') {
          // Keep the paper at its date column; the drag only sets its height.
          paper.fx = nodeTimelineX(paper)
          paper.fy = paper.y
        } else {
          paper.fx = paper.x
          paper.fy = paper.y
        }
      }
      setPinned((prev) => {
        const next = new Set(prev)
        for (const paper of dropped) next.add(paper.id)
        return next
      })
    },
    [companionsOf, layout, nodeTimelineX],
  )

  const togglePin = useCallback(
    (id: string) => {
      if (!base) return
      const node = base.nodes.find((candidate) => candidate.id === id)
      if (!node) return
      if (pinned.has(id)) {
        // Unpin: in Timeline, keep the date-column x-pin; in Force, fully release.
        node.fx = layout === 'timeline' ? nodeTimelineX(node) : undefined
        node.fy = undefined
        setPinned((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        fgRef.current?.d3ReheatSimulation?.()
      } else {
        node.fx = node.x
        node.fy = node.y
        setPinned((prev) => new Set(prev).add(id))
      }
    },
    [base, pinned, layout, nodeTimelineX, fgRef],
  )

  const releaseAll = useCallback(() => {
    base?.nodes.forEach((node) => {
      // Clearing user pins keeps the timeline structure (re-pin x by date).
      node.fx = base && layout === 'timeline' ? nodeTimelineX(node) : undefined
      node.fy = undefined
    })
    setPinned(new Set())
    // Deliberately NOT resetting the fitDone latch: Release re-settles the
    // layout under the user's current camera. Re-arming it made the engine
    // stop re-run zoomToFit, yanking the zoom out to the whole graph —
    // exactly the "reheat without camera yank" rule discoveries follow.
    fgRef.current?.d3ReheatSimulation?.()
  }, [base, layout, nodeTimelineX, fgRef])

  return { pinned, clearPins, onNodeDrag, onNodeDragEnd, togglePin, releaseAll }
}
