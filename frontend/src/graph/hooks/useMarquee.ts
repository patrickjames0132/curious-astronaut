/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The marquee node-selector: alt-drag a rectangle over the canvas to hand-pick
 * the nodes the AI teacher works over (its grounding scope). A modifier-drag,
 * not a mode — plain drag still pans the graph, so this arms only while Alt is
 * held and captures the drag through a transparent overlay so react-force-graph
 * never sees it (no pan fight). Shift-click single-node add/remove lives in
 * GraphExplorer's click handler; this owns the rectangle gesture.
 *
 * The marquee is **additive**: each alt-drag UNIONS the enclosed nodes onto the
 * current pick, so you can sweep several clusters into one scope. An alt-click
 * on empty canvas (a negligible drag) clears the pick, as does the controls'
 * Clear button. (We deliberately don't gate "add" behind Alt+Shift — that combo
 * is the OS keyboard-layout switch on Windows, which steals the modifier and
 * the window focus mid-drag.)
 *
 * The gesture itself lives in `ui/useBoxSelect` (v8.17.0), shared with the
 * knowledge graph. Hit-testing runs in SCREEN space: `fgRef.graph2ScreenCoords` maps each
 * visible node's sim position to canvas-local pixels, compared against the
 * dragged rectangle (also canvas-local, measured off the wrap's bounding box —
 * the RFG canvas fills the wrap, so their top-lefts coincide).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import { useAppDispatch } from '../../store'
import { nodeSelectionAdded, nodeSelectionCleared } from '../../store/workspace'
import {
  inBox,
  useBoxSelect,
  type BoxBounds,
  type BoxRect,
  type BoxSelectApi,
} from '../../ui/useBoxSelect'
import type { VNode, VLink } from '../model'

/** A drag rectangle in wrap-local pixels, for painting the marquee outline. */
export type MarqueeRect = BoxRect

/** Arguments for {@link useMarquee}. */
export interface UseMarqueeArgs {
  /** The filtered live view — only visible nodes are eligible for a marquee. */
  view: { nodes: VNode[]; links: VLink[] }
  /** The ForceGraph2D instance ref (for `graph2ScreenCoords`). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: { current: any }
  /** The canvas wrap element — the coordinate origin for the rectangle. */
  wrapRef: RefObject<HTMLDivElement | null>
}

/** What {@link useMarquee} returns for GraphExplorer to render. */
export type MarqueeApi = BoxSelectApi

/**
 * Own the alt-drag marquee: the gesture is `ui/useBoxSelect` (shared with the
 * knowledge graph since v8.17.0); this supplies the hit test over the visible
 * view and unions the enclosed node ids onto the selection on release.
 *
 * @param args The live view, the ForceGraph ref, and the wrap element ref.
 * @returns The arm/rect state and the overlay mousedown handler.
 */
export function useMarquee({ view, fgRef, wrapRef }: UseMarqueeArgs): MarqueeApi {
  const dispatch = useAppDispatch()
  const viewRef = useRef(view)
  viewRef.current = view
  const hitTest = useCallback(
    (box: BoxBounds) => {
      const forceGraph = fgRef.current
      if (!forceGraph?.graph2ScreenCoords) return []
      return viewRef.current.nodes
        .filter(
          (node) =>
            typeof node.x === 'number' &&
            typeof node.y === 'number' &&
            inBox(forceGraph.graph2ScreenCoords(node.x, node.y), box),
        )
        .map((node) => node.id)
    },
    [fgRef],
  )
  return useBoxSelect({
    wrapRef,
    hitTest,
    // Additive: union this rectangle onto the current pick so several sweeps
    // build one scope. Reset is alt-click / Clear, not a fresh drag.
    onPick: (ids) => dispatch(nodeSelectionAdded(ids)),
    onClear: () => dispatch(nodeSelectionCleared()),
  })
}
