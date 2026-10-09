/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph in 3D — "just for kicks" (Patrick, 2026-10-08), on
 * react-force-graph-3d (three.js). Same data, colours and gestures as the 2D
 * view (`look.ts`): spheres instead of discs, a floating label over each,
 * drag to orbit, scroll to zoom. **Loaded on demand** (`React.lazy` in
 * `KnowledgeNetwork`): three.js is several hundred kilobytes that nobody
 * should download until they flip the switch.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import ForceGraph3DImport from 'react-force-graph-3d'
import SpriteText from 'three-spritetext'
import { SELECTION_RING, useCanvasInk } from '../graph/theme'
import type { KnowledgeGraphProps } from './KnowledgeGraph'
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
} from './look'

// Untyped alias, for the same accessor-typing reason as the 2D view.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph3D = ForceGraph3DImport as any

/** Camera distance from a focused node. */
const FOCUS_DISTANCE = 120

/**
 * Render the 3D knowledge graph.
 *
 * @param props See {@link KnowledgeGraphProps}.
 * @returns The three.js scene.
 */
export default function KnowledgeGraph3D(props: KnowledgeGraphProps) {
  const { map, width, height, expanding, focusId, labels, fitSignal } = props
  const { onOpen, onExpand, onBackground } = props
  const ink = useCanvasInk()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const data = useGraphData(map)
  const onNodeClick = useNodeClicks(onOpen, onExpand)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)

  useEffect(() => {
    fgRef.current?.d3Force('charge')?.strength(-160)
    fgRef.current?.d3Force('link')?.distance(48)
  }, [])

  useEffect(() => {
    if (fitSignal) fgRef.current?.zoomToFit(600, 60)
  }, [fitSignal])

  // Fly the camera to a newly focused item, keeping it in view from a fixed distance.
  useEffect(() => {
    if (!focusId) return
    const node = data.nodes.find((item) => item.id === focusId)
    if (node?.x === undefined || node.y === undefined || node.z === undefined) return
    const length = Math.hypot(node.x, node.y, node.z) || 1
    const ratio = 1 + FOCUS_DISTANCE / length
    fgRef.current?.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
      { x: node.x, y: node.y, z: node.z },
      900,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on a new focus only
  }, [focusId])

  // The label floats above the sphere; three-forcegraph draws the sphere
  // itself (`nodeThreeObjectExtend`), coloured by `nodeColor`.
  const label = useCallback(
    (node: CanvasNode) => {
      const item = map.nodes[node.id]
      // A known item's label carries the green ✓ the 2D view draws on the disc.
      const known = !!item && map.known.includes(item.id)
      const sprite = new SpriteText(item ? `${known ? '✓ ' : ''}${shortLabel(item.title)}` : '')
      const faded = item ? nodeLook(map, item).faded : false
      sprite.color = known ? KNOWLEDGE_COLOR.known : faded ? ink.soft : ink.ink
      sprite.textHeight = item?.id === map.rootId ? 3.4 : 2.4
      // Hidden rather than absent, so hovering can name it without a rebuild.
      ;(sprite as unknown as { visible: boolean }).visible = labelled(map, node.id, labels, hoverId)
      // A three.js Sprite underneath; its typings omit the inherited position
      // (no @types/three here — it would be the only use). `y` is three's name.
      // oxlint-disable-next-line id-length
      const lifted = sprite as unknown as { position: { y: number } }
      lifted.position.y = (item ? nodeRadius(map, item) : 5) + 5
      return sprite
    },
    [map, ink.ink, ink.soft, labels, hoverId],
  )

  const touchesOpen = (link: CanvasLink) =>
    [link.source, link.target].some(
      (end) => (typeof end === 'string' ? end : end.id) === map.openId,
    )

  return (
    <ForceGraph3D
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
        return item ? nodeRadius(map, item) ** 3 / 6 : 1
      }}
      nodeColor={(node: CanvasNode) => {
        const item = map.nodes[node.id]
        if (!item) return ink.soft
        if (item.id === map.openId || expanding.has(item.id)) return SELECTION_RING
        return nodeLook(map, item).color
      }}
      nodeOpacity={0.92}
      nodeThreeObject={label}
      nodeThreeObjectExtend
      onNodeClick={onNodeClick}
      onNodeHover={(node: CanvasNode | null) => setHoverId(node ? node.id : null)}
      onBackgroundClick={onBackground}
      linkColor={(link: CanvasLink) => (touchesOpen(link) ? SELECTION_RING : ink.soft)}
      linkOpacity={0.45}
      linkWidth={(link: CanvasLink) => (touchesOpen(link) ? 0.5 : 0)}
      linkDirectionalArrowLength={3}
      linkDirectionalArrowRelPos={1}
      cooldownTicks={140}
    />
  )
}
