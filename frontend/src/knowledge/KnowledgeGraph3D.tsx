/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph in 3D — "just for kicks" (Patrick, 2026-10-08), on
 * react-force-graph-3d (three.js). Same data, colours and gestures as the 2D
 * view (`look.ts`): spheres instead of discs, a floating label over each,
 * drag to orbit, scroll to zoom. **Loaded on demand** (`React.lazy` in
 * `KnowledgeNetwork`): three.js is several hundred kilobytes that nobody
 * should download until they flip the switch. A synthesis is a ◆ sprite
 * rather than a sphere (v8.23.0). The open item holds the citation graph's
 * focus here too; hover doesn't, because rebuilding every sprite on each
 * hover made 3D lag (v8.17.0). A find dims the spheres
 * that don't match and hides their names, as the 2D view does (v8.20.0).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef } from 'react'
import ForceGraph3DImport from 'react-force-graph-3d'
import SpriteText from 'three-spritetext'
import { SELECTION_RING, useCanvasInk } from '../graph/theme'
import type { KnowledgeGraphProps } from './KnowledgeGraph'
import type { KnowledgeMap, KnowledgeNode } from './model'
import { inBox } from '../ui/useBoxSelect'
import {
  labelled,
  nodeLook,
  nodeRadius,
  shortLabel,
  dimLook,
  edgeColor,
  useHierarchyForce,
  useGraphData,
  pinNode,
  releaseNodes,
  useFitButton,
  useNodeClicks,
  type CanvasLink,
  type CanvasNode,
} from './look'

// Untyped alias, for the same accessor-typing reason as the 2D view.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph3D = ForceGraph3DImport as any

/** A three.js vector's fields, as read off the camera and the orbit controls
 *  (no `@types/three` here). `x`/`y`/`z` are three's names. */
interface Point3 {
  // oxlint-disable-next-line id-length -- three's vector field names
  x: number
  // oxlint-disable-next-line id-length -- three's vector field names
  y: number
  // oxlint-disable-next-line id-length -- three's vector field names
  z: number
}

/** The outline's stroke, in world units; centred on the sphere's silhouette. */
const RING_WIDTH = 0.45

/**
 * A sphere's radius as three-forcegraph draws it: `cbrt(nodeVal) * nodeRelSize`,
 * with `nodeVal` set below to radius³ / 6 and `nodeRelSize` 1.
 *
 * @param map The course.
 * @param item The node.
 * @returns The sphere's radius in world units.
 */
function sphereRadius(map: KnowledgeMap, item: KnowledgeNode): number {
  return Math.cbrt(nodeRadius(map, item) ** 3 / 6)
}

/**
 * A camera-facing ring of the given radius: an empty `SpriteText` whose
 * rounded border is the ring. three-spritetext measures padding and border
 * in world units and draws at `fontSize / textHeight` canvas pixels per unit,
 * so the text height sets the texture's size. It is half the diameter here,
 * which keeps the canvas at about two font sizes square. (A first cut set it
 * to 0.01 to hide the empty text: 9,000 px per unit, a texture tens of
 * thousands of pixels wide on every node, and the 3D view crawled.) The empty
 * line still takes the text height, so the vertical padding is what is left.
 *
 * @param radius The ring's outer radius.
 * @param color Its stroke colour.
 * @returns The sprite.
 */
function outlineRing(radius: number, color: string): SpriteText {
  const diameter = radius * 2
  const ring = new SpriteText('')
  ring.textHeight = radius
  ring.borderWidth = RING_WIDTH
  ring.borderColor = color
  ring.borderRadius = radius
  ring.padding = [radius - RING_WIDTH, (diameter - radius) / 2 - RING_WIDTH]
  return ring
}

/** A synthesis's ◆ height in world units: about a concept sphere across. */
const DIAMOND_HEIGHT = 11

/**
 * A synthesis's shape (v8.23.0): a ◆ glyph, which a sprite keeps facing the
 * camera, so it reads as the 2D view's diamond from every angle.
 *
 * @param fill Its colour.
 * @param stroke Its outline (black, the open item's ink, the selection blue).
 * @returns The sprite.
 */
function diamond(fill: string, stroke: string): SpriteText {
  const glyph = new SpriteText('◆')
  glyph.textHeight = DIAMOND_HEIGHT
  glyph.color = fill
  glyph.strokeWidth = 1
  glyph.strokeColor = stroke
  return glyph
}

/**
 * The bits of a three.js sprite this file touches. `three-spritetext`'s own
 * typings extend three's `Sprite`, which has no types here (no
 * `@types/three`: it would be the only use), so these are spelled out.
 * `x`/`y` are three's names.
 */
interface SpriteParts {
  // oxlint-disable-next-line id-length -- three's vector field names
  position: { y: number }
  // oxlint-disable-next-line id-length -- three's vector field names
  scale: { x: number; y: number }
  visible: boolean
  add: (child: unknown) => void
}

/**
 * Render the 3D knowledge graph.
 *
 * @param props See {@link KnowledgeGraphProps}.
 * @returns The three.js scene.
 */
export default function KnowledgeGraph3D(props: KnowledgeGraphProps) {
  const { map, width, height, expanding, focus, fitSignal, lit, anchorId } = props
  const { selected, onOpen, onExpand, onSelect, onClose, engineRef, onPinned } = props
  const ink = useCanvasInk()
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
              inBox(
                fgRef.current?.graph2ScreenCoords(node.x, node.y, node.z ?? 0) ?? { x: -1, y: -1 },
                box,
              ),
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

  useEffect(() => {
    fgRef.current?.d3Force('charge')?.strength(-160)
  }, [])
  // The course keeps a tree: rings by depth, syntheses beside their parent.
  useHierarchyForce(fgRef, map, data)

  useFitButton(fitSignal, () => {
    if (data.nodes.length > 1) fgRef.current?.zoomToFit(600, 60)
  })

  // Centre the focused item from where the reader is looking (Patrick,
  // v8.17.0): the camera slides by the gap between what it looks at and the
  // node, so its angle and distance stay as they were. It used to fly to a
  // fixed point on the line from the origin through the node, which swung
  // the view round to a new angle.
  useEffect(() => {
    if (!focus) return
    const node = data.nodes.find((item) => item.id === focus.id)
    const engine = fgRef.current
    if (!engine || node?.x === undefined || node.y === undefined || node.z === undefined) return
    const camera = engine.camera()?.position as Point3 | undefined
    const target = (engine.controls()?.target as Point3 | undefined) ?? { x: 0, y: 0, z: 0 }
    if (!camera) return
    engine.cameraPosition(
      {
        x: camera.x + node.x - target.x,
        y: camera.y + node.y - target.y,
        z: camera.z + node.z - target.z,
      },
      { x: node.x, y: node.y, z: node.z },
      700,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on a new focus request only
  }, [focus])

  // The label floats above the sphere; three-forcegraph draws the sphere
  // itself (`nodeThreeObjectExtend`), coloured by `nodeColor` (green once
  // known). The 2D view's edge outline becomes a ring on the sphere's
  // silhouette (v8.17.0): an empty `SpriteText` whose rounded border is the
  // ring, always facing the camera so it reads as an outline from any angle.
  // As in 2D: black, the canvas's hard ink on the open node, the selection
  // blue on picked ones or while being broken down. The ring is then the root and the label its
  // child, so the label can still hide on its own; a child inherits its
  // parent's scale, so the label's offset and size are divided by the ring's.
  const nodeObject = useCallback(
    (node: CanvasNode) => {
      const item = map.nodes[node.id]
      const lift = (item ? nodeRadius(map, item) : 5) + 5
      const sprite = new SpriteText(item ? shortLabel(item.title) : '')
      sprite.color = ink.ink
      sprite.textHeight = item?.id === map.rootId ? 3.4 : 2.4
      const label = sprite as unknown as SpriteParts
      // 3D names every node (`labelled` with no zoom): no hover state, since
      // rebuilding every node's sprites on each hover made the view lag.
      // A find names its matches only.
      // A focus names only what it lights.
      const dim = !!lit && !lit.has(node.id)
      label.visible = !dim && labelled(map, node.id, null, false)

      if (!item) {
        label.position.y = lift
        return sprite
      }
      const busyOrPicked = selected.has(item.id) || expanding.has(item.id)
      const outline = busyOrPicked
        ? SELECTION_RING
        : item.id === map.openId
          ? ink.hard
          : dim
            ? ink.outlineDim
            : ink.outline
      // A synthesis is a camera-facing ◆, the 2D view's diamond from any
      // angle (v8.23.0), drawn instead of the sphere (`nodeThreeObjectExtend`
      // below), its glyph's own stroke the outline.
      const ringSprite =
        item.kind === 'synthesis'
          ? diamond(dim ? dimLook(map, item) : nodeLook(map, item).color, outline)
          : outlineRing(sphereRadius(map, item) + RING_WIDTH / 2, outline)
      const ring = ringSprite as unknown as SpriteParts
      label.position.y = lift / ring.scale.y
      label.scale.x /= ring.scale.x
      label.scale.y /= ring.scale.y
      ring.add(sprite)
      return ringSprite
    },
    [map, ink.ink, ink.hard, ink.outline, ink.outlineDim, selected, expanding, lit],
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
        // Its own colour unless a find dims it; open, picked and busy show
        // on the ring.
        if (!item) return ink.soft
        return lit && !lit.has(item.id) ? dimLook(map, item) : nodeLook(map, item).color
      }}
      nodeOpacity={0.92}
      nodeThreeObject={nodeObject}
      // The sphere stays under every node but a synthesis, whose ◆ replaces it.
      nodeThreeObjectExtend={(node: CanvasNode) => map.nodes[node.id]?.kind !== 'synthesis'}
      onNodeClick={onNodeClick}
      // A synthesis's lines in its teal (v8.23.0); three has no dashes to spare.
      linkColor={(link: CanvasLink) => edgeColor(link, lit, anchorId, map.openId, ink)}
      linkOpacity={0.45}
      linkWidth={(link: CanvasLink) => (touchesOpen(link) ? 0.5 : 0)}
      linkDirectionalArrowLength={3}
      linkDirectionalArrowRelPos={1}
      // A drag pins the node where it is dropped; Release unpins them all.
      onNodeDragEnd={(node: CanvasNode) => {
        pinNode(node)
        onPinned(data.nodes.filter((item) => item.fx !== undefined).length)
      }}
      cooldownTicks={140}
      // Frame the course once it settles, as the 2D view does (and, like it,
      // not around a lone paper still waiting for its breakdown).
      onEngineStop={() => {
        if (fitted.current || data.nodes.length < 2) return
        fitted.current = true
        fgRef.current?.zoomToFit(600, 60)
      }}
    />
  )
}
