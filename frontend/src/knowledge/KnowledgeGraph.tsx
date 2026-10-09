/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph in 2D, on the same react-force-graph-2d engine as the
 * paper graph. Every item is a disc; an arrow points from an item to each
 * concept it needs. Visited and known items are greyed (a known one carries a
 * green ✓), an item not yet broken down wears a dashed ring — there is more beneath
 * it — and the open lesson's item gets the selection ring. Only the
 * neighbourhood in focus is named by default (`labelled` in `look.ts`), so a
 * growing course stays readable.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState } from 'react'
import ForceGraph2DImport from 'react-force-graph-2d'
import { SELECTION_RING, UNKNOWN_EDGE, useCanvasInk } from '../graph/theme'
import {
  KNOWLEDGE_COLOR,
  labelled,
  nodeLook,
  nodeRadius,
  shortLabel,
  useGraphData,
  useNodeClicks,
  type CanvasLink,
  type CanvasNode,
  type LabelMode,
} from './look'
import type { KnowledgeMap } from './model'

// The lib's generic prop typings fight our accessor signatures, as on the
// paper graph (graph/canvas/GraphCanvas.tsx); render via an untyped alias.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = ForceGraph2DImport as any

/** Props shared by the 2D and 3D views. */
export interface KnowledgeGraphProps {
  map: KnowledgeMap
  width: number
  height: number
  /** Items whose breakdown is in flight. */
  expanding: ReadonlySet<string>
  /** Center the view on this item when it changes (Next lesson, a panel link). */
  focusId: string | null
  /** Which nodes are named. */
  labels: LabelMode
  /** Bumped to fit the whole course in view. */
  fitSignal: number
  onOpen: (nodeId: string) => void
  onExpand: (nodeId: string) => void
  /** A click on empty canvas closes the lesson. */
  onBackground: () => void
}

/**
 * Render the 2D knowledge graph.
 *
 * @param props See {@link KnowledgeGraphProps}.
 * @returns The force-graph canvas.
 */
export default function KnowledgeGraph(props: KnowledgeGraphProps) {
  const { map, width, height, expanding, focusId, labels, fitSignal } = props
  const { onOpen, onExpand, onBackground } = props
  const ink = useCanvasInk()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const data = useGraphData(map)
  const onNodeClick = useNodeClicks(onOpen, onExpand)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const fitted = useRef(false)

  // A little more room than the engine's default: labels sit under the discs.
  useEffect(() => {
    fgRef.current?.d3Force('charge')?.strength(-160)
    fgRef.current?.d3Force('link')?.distance(48)
  }, [])

  useEffect(() => {
    if (fitSignal) fgRef.current?.zoomToFit(400, 80)
  }, [fitSignal])

  useEffect(() => {
    if (!focusId) return
    const node = data.nodes.find((item) => item.id === focusId)
    if (node?.x !== undefined) fgRef.current?.centerAt(node.x, node.y, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on a new focus only
  }, [focusId])

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
      onNodeHover={(node: CanvasNode | null) => setHoverId(node ? node.id : null)}
      onBackgroundClick={onBackground}
      cooldownTicks={140}
      onEngineStop={() => {
        if (fitted.current) return
        fitted.current = true
        fgRef.current?.zoomToFit(400, 80)
      }}
      // Keep repainting while something is being broken down, so its ring turns.
      autoPauseRedraw={expanding.size === 0}
      linkColor={(link: CanvasLink) => {
        const touches = [link.source, link.target].some(
          (end) => (typeof end === 'string' ? end : end.id) === map.openId,
        )
        return touches ? SELECTION_RING : UNKNOWN_EDGE
      }}
      linkWidth={(link: CanvasLink) =>
        [link.source, link.target].some(
          (end) => (typeof end === 'string' ? end : end.id) === map.openId,
        )
          ? 1.4
          : 0.8
      }
      linkDirectionalArrowLength={3.5}
      linkDirectionalArrowRelPos={1}
      nodeCanvasObject={(node: CanvasNode, ctx: CanvasRenderingContext2D, scale: number) => {
        const item = map.nodes[node.id]
        if (!item || node.x === undefined || node.y === undefined) return
        const radius = nodeRadius(map, item)
        const { color, faded } = nodeLook(map, item)
        const nodeX = node.x
        const nodeY = node.y

        ctx.beginPath()
        ctx.arc(nodeX, nodeY, radius, 0, 2 * Math.PI)
        ctx.globalAlpha = faded ? 0.55 : 1
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = 1

        if (map.known.includes(item.id)) {
          ctx.fillStyle = KNOWLEDGE_COLOR.known
          ctx.font = `bold ${radius * 1.5}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('✓', nodeX, nodeY + 0.5)
        }
        // More beneath it: a dashed ring, turning while it is being fetched.
        const busy = expanding.has(item.id)
        if (busy || !item.expanded) {
          ctx.beginPath()
          ctx.arc(nodeX, nodeY, radius + 2.5, 0, 2 * Math.PI)
          ctx.lineWidth = 1.2 / scale
          ctx.strokeStyle = busy ? SELECTION_RING : ink.soft
          ctx.setLineDash([3 / scale, 2.5 / scale])
          ctx.lineDashOffset = busy ? -performance.now() / 60 / scale : 0
          ctx.stroke()
          ctx.setLineDash([])
        }
        if (map.openId === item.id) {
          ctx.beginPath()
          ctx.arc(nodeX, nodeY, radius + (busy || !item.expanded ? 5 : 2.5), 0, 2 * Math.PI)
          ctx.lineWidth = 2 / scale
          ctx.strokeStyle = SELECTION_RING
          ctx.stroke()
        }

        // Names for the neighbourhood in focus (or all, by choice); zoomed far
        // out, only the paper keeps its name.
        if (!labelled(map, item.id, labels, hoverId)) return
        if (scale < 0.55 && item.id !== map.rootId && item.id !== hoverId) return
        const fontSize = Math.max(11 / scale, 2.4)
        ctx.font = `${item.id === map.rootId ? '600 ' : ''}${fontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = faded ? ink.soft : ink.ink
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
