/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph in 2D, on the same react-force-graph-2d engine as the
 * citation graph. Every item is a disc; an arrow points from an item to each
 * concept it needs. Visited and known items are greyed (a known one carries a
 * green ✓), an item not yet broken down wears a dashed ring — there is more beneath
 * it — and the open lesson's item gets the selection ring. Only the
 * neighbourhood in focus is named by default (`labelled` in `look.ts`), so a
 * growing course stays readable. A synthesis (v8.23.0) is a teal diamond, its
 * lines to its concepts and target dashed. While the find bar holds a query, the
 * items that don't match it dim and the matches keep their names (v8.20.0).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState } from 'react'
import ForceGraph2DImport from 'react-force-graph-2d'
import { SELECTION_RING, useCanvasInk } from '../graph/theme'
import {
  labelled,
  nodeLook,
  nodeRadius,
  shortLabel,
  dimLook,
  edgeColor,
  linkLit,
  touches,
  useHierarchyForce,
  useGraphData,
  pinNode,
  releaseNodes,
  useFitButton,
  useNodeClicks,
  type CanvasLink,
  type CanvasNode,
} from './look'
import type { KnowledgeMap } from './model'
import { inBox, type BoxBounds } from '../ui/useBoxSelect'

// The lib's generic prop typings fight our accessor signatures, as on the
// citation graph (graph/canvas/GraphCanvas.tsx); render via an untyped alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = ForceGraph2DImport as any

/** Props shared by the 2D and 3D views. */
export interface KnowledgeGraphProps {
  map: KnowledgeMap
  width: number
  height: number
  /** Items whose breakdown is in flight. */
  expanding: ReadonlySet<string>
  /**
   * Centre the view on this item: a click on a node, Next lesson, a panel
   * link. `seq` changes on every request, so the same item can be centred
   * again after the reader has panned away from it.
   */
  focus: { id: string; seq: number } | null
  /** Bumped to fit the whole course in view. */
  fitSignal: number
  /** Items picked to check off together (shift-click, alt-drag). */
  selected: ReadonlySet<string>
  /** The lit items, everything else dimming (v8.23.0, the citation graph's
   *  focus: a find, the open item's links, the hovered item's): null for none. */
  lit: ReadonlySet<string> | null
  /** The item the focus is centred on, whose edges alone stay lit; null
   *  under a find or with no focus. */
  anchorId: string | null
  /** The pointer moved onto an item, or off every one (2D only: 3D keeps no
   *  hover state, see `KnowledgeGraph3D`). */
  onHover?: (nodeId: string | null) => void
  onOpen: (nodeId: string) => void
  onExpand: (nodeId: string) => void
  /** Shift-click: add an item to the selection, or take it out. */
  onSelect: (nodeId: string) => void
  /** A slower second click on the open item: close its lesson (v8.23.0). */
  onClose: () => void
  /** Filled in by the view so the alt-drag box can hit-test its nodes. */
  engineRef?: { current: KnowledgeEngine | null }
  /** How many nodes are pinned, whenever a drag or a Release changes it. */
  onPinned: (count: number) => void
}

/** What a view offers the network: the nodes inside a box on screen, and Release. */
export interface KnowledgeEngine {
  nodesIn: (box: BoxBounds) => string[]
  /** Unpin every node and let the layout settle again. */
  release: () => void
}

/**
 * Trace a node's outline: a disc, or a diamond for a synthesis (v8.23.0), the
 * same size across so the two sit together. The caller fills and strokes.
 *
 * @param ctx The canvas.
 * @param diamond True for a synthesis.
 * @param centreX The node's x.
 * @param centreY The node's y.
 * @param radius Its radius (a diamond's half-width).
 */
function traceShape(
  ctx: CanvasRenderingContext2D,
  diamond: boolean,
  centreX: number,
  centreY: number,
  radius: number,
): void {
  if (!diamond) {
    ctx.arc(centreX, centreY, radius, 0, 2 * Math.PI)
    return
  }
  ctx.moveTo(centreX, centreY - radius)
  ctx.lineTo(centreX + radius, centreY)
  ctx.lineTo(centreX, centreY + radius)
  ctx.lineTo(centreX - radius, centreY)
  ctx.closePath()
}

/**
 * Render the 2D knowledge graph.
 *
 * @param props See {@link KnowledgeGraphProps}.
 * @returns The force-graph canvas.
 */
export default function KnowledgeGraph(props: KnowledgeGraphProps) {
  const { map, width, height, expanding, focus, fitSignal, lit, anchorId } = props
  const { selected, onOpen, onExpand, onSelect, onClose, engineRef, onPinned, onHover } = props
  const ink = useCanvasInk()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const data = useGraphData(map)
  const onNodeClick = useNodeClicks(map.openId, onOpen, onExpand, onSelect, onClose)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const fitted = useRef(false)

  // The alt-drag box reads the nodes on screen through this.
  useEffect(() => {
    if (!engineRef) return undefined
    engineRef.current = {
      nodesIn: (box) =>
        data.nodes
          .filter(
            (node) =>
              node.x !== undefined &&
              node.y !== undefined &&
              inBox(fgRef.current?.graph2ScreenCoords(node.x, node.y) ?? { x: -1, y: -1 }, box),
          )
          .map((node) => node.id),
      release: () => {
        releaseNodes(data.nodes)
        onPinned(0)
        fgRef.current?.d3ReheatSimulation()
      },
    }
    return () => {
      engineRef.current = null
    }
  }, [engineRef, data, onPinned])

  // A little more room than the engine's default: labels sit under the discs
  // (the links' lengths are useHierarchyForce's).
  useEffect(() => {
    fgRef.current?.d3Force('charge')?.strength(-160)
  }, [])
  // The course keeps a tree: rings by depth, syntheses beside their parent.
  useHierarchyForce(fgRef, map, data)

  useFitButton(fitSignal, () => {
    if (data.nodes.length > 1) fgRef.current?.zoomToFit(400, 80)
  })

  // Pan (no zoom change) so the focused item sits in the middle of the canvas.
  useEffect(() => {
    if (!focus) return
    const node = data.nodes.find((item) => item.id === focus.id)
    if (node?.x !== undefined) fgRef.current?.centerAt(node.x, node.y, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on a new focus request only
  }, [focus])

  return (
    <ForceGraph2D
      ref={fgRef}
      width={width}
      height={height}
      graphData={data}
      backgroundColor={ink.background}
      nodeId="id"
      nodeLabel={(node: CanvasNode) => map.nodes[node.id]?.title ?? ''}
      nodeRelSize={1}
      nodeVal={(node: CanvasNode) => {
        const item = map.nodes[node.id]
        return item ? nodeRadius(map, item) ** 2 : 1
      }}
      onNodeClick={onNodeClick}
      onNodeHover={(node: CanvasNode | null) => {
        setHoverId(node ? node.id : null)
        onHover?.(node ? node.id : null)
      }}
      // A drag pins the node where it is dropped; Release unpins them all.
      onNodeDragEnd={(node: CanvasNode) => {
        pinNode(node)
        onPinned(data.nodes.filter((item) => item.fx !== undefined).length)
      }}
      cooldownTicks={140}
      onEngineStop={() => {
        // Not on a lone node: a new course shows only the paper while its
        // first breakdown is written, and fitting one disc zooms in as far
        // as the engine allows. That used up the one-shot fit, so the course
        // then grew around a camera parked deep inside the paper (fixed in
        // v8.16.0). The concepts' arrival reheats the sim, which stops again
        // and fits then.
        if (fitted.current || data.nodes.length < 2) return
        fitted.current = true
        fgRef.current?.zoomToFit(400, 80)
      }}
      // Keep repainting while something is being broken down, so its ring turns.
      autoPauseRedraw={expanding.size === 0}
      // Under a focus only the focused item's own edges stay lit, as on the
      // citation graph; the open item's lit edges take the selection blue.
      // A neutral slate, dimmed or brightened by the focus (`edgeColor`, v8.24.0).
      linkColor={(link: CanvasLink) => edgeColor(link, lit, anchorId, map.openId, ink)}
      // A synthesis's lines are dashed: drawn, never a "needs" edge (v8.23.0).
      linkLineDash={(link: CanvasLink) => (link.synthesis ? [2, 1.5] : null)}
      linkWidth={(link: CanvasLink) =>
        touches(link, map.openId) && linkLit(link, lit, anchorId) ? 1.4 : 0.8
      }
      linkDirectionalArrowLength={3.5}
      linkDirectionalArrowRelPos={1}
      nodeCanvasObject={(node: CanvasNode, ctx: CanvasRenderingContext2D, scale: number) => {
        const item = map.nodes[node.id]
        if (!item || node.x === undefined || node.y === undefined) return
        const radius = nodeRadius(map, item)
        const { color } = nodeLook(map, item)
        const nodeX = node.x
        const nodeY = node.y
        const picked = selected.has(item.id)
        const dim = !!lit && !lit.has(item.id)

        ctx.beginPath()
        traceShape(ctx, item.kind === 'synthesis', nodeX, nodeY, radius)
        // The background first (v8.24.0): every line is drawn centre to centre
        // beneath the nodes, and a dimmed node's fill is see-through, so its
        // edges showed running into the middle of it.
        ctx.fillStyle = ink.background
        ctx.fill()
        // A dimmed item keeps a trace of its own colour (v8.23.0).
        ctx.fillStyle = dim ? dimLook(map, item) : color
        ctx.fill()

        // One outline, on the disc's own edge, as on the citation graph:
        // black on every node, the canvas's hard ink (white on dark, near
        // black on light) on the open one, the selection blue on picked ones.
        // While its breakdown is in flight the edge turns into moving blue
        // dashes.
        const busy = expanding.has(item.id)
        const open = map.openId === item.id
        ctx.lineWidth = (open || picked || busy ? 2 : 1) / scale
        ctx.strokeStyle =
          picked || busy ? SELECTION_RING : open ? ink.hard : dim ? ink.outlineDim : ink.outline
        if (busy) {
          ctx.setLineDash([3 / scale, 2.5 / scale])
          ctx.lineDashOffset = -performance.now() / 60 / scale
        }
        ctx.stroke()
        ctx.setLineDash([])

        // Every name once zoomed in, as on the citation graph; zoomed out,
        // only the paper, the open item, picked items and the hovered one. A
        // focus (or a find) names what it lights at any zoom, and only that.
        if (lit ? dim : !labelled(map, item.id, hoverId, picked, scale)) return
        const fontSize = Math.max(11 / scale, 2.4)
        ctx.font = `${item.id === map.rootId ? '600 ' : ''}${fontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = ink.ink
        ctx.fillText(shortLabel(item.title), nodeX, nodeY + radius + 3)
      }}
      nodePointerAreaPaint={(node: CanvasNode, color: string, ctx: CanvasRenderingContext2D) => {
        const item = map.nodes[node.id]
        if (!item || node.x === undefined || node.y === undefined) return
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.x, node.y, nodeRadius(map, item) + 3, 0, 2 * Math.PI)
        ctx.fill()
      }}
    />
  )
}
