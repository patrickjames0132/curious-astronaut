/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The ForceGraph2D wrapper: all canvas painting for the explorer — node
 * fills by relation (pink for a paper that has been expanded), the
 * dim/highlight/pin/selection rings, the faint
 * "added by expanding" halo, node labels, edge colors/widths/arrows (the
 * links between papers among them, drawn finer), and pointer areas.
 *
 * Purely presentational: the simulation's node/link objects, the fgRef, and
 * every piece of interaction state live in GraphExplorer and arrive as props.
 * The one rule this component must respect is object identity — `data` is
 * the live view whose nodes RFG mutates (x/y/fx/fy), so nothing here may
 * copy or recreate them.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import ForceGraph2DImport from 'react-force-graph-2d'
import type { GraphNode } from '../../api'
import { latexToUnicode } from '../../notation/latexToUnicode'
import { edgeLit, edgeTypeFrom, nodeRadius, primaryRel } from '../model'
import type { DragStep, PositionedVNode, VLink, VNode } from '../model'
import {
  ARROW_COLOR,
  DIM_EDGE,
  EDGE_COLOR,
  EXPANDED_COLOR,
  REL_COLOR,
  SELECTION_RING,
  UNKNOWN_EDGE,
  dimColor,
  useCanvasInk,
} from '../theme'

// The lib's generic prop typings fight our accessor signatures; render via an
// untyped alias so our canvas/link callbacks stay readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = ForceGraph2DImport as any

/** Props for {@link GraphCanvas}. */
export interface GraphCanvasProps {
  /** The ForceGraph2D instance ref, owned by GraphExplorer (reheat/zoom/forces). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: { current: any }
  /** Canvas dimensions (tracked by GraphExplorer's ResizeObserver). */
  width: number
  height: number
  /** The filtered live view — node objects the sim mutates; do not copy. */
  data: { nodes: VNode[]; links: VLink[] }
  /** Nodes in focus (hover neighborhood or teacher highlights); null = no dimming. */
  focusSet: Set<string> | null
  /** The paper the edges are coloured from (`model.focusAnchor`): blue where
   *  it cites, green where it is cited. Null: the seed's point of view. */
  anchorId: string | null
  /** User-pinned node ids (drawn with a pale ring). */
  pinned: Set<string>
  /** Papers an Expand hop has run on (filled pink, see theme's EXPANDED_COLOR). */
  expandedIds: Set<string>
  /** The selected node id (bright ring + always-on label). */
  selectedId: string | null
  /** The teacher's scope — the running turn's message scope, else the
   *  hand-picked selection (cyan ring; others dim). */
  selectedIds: Set<string>
  /** Whether the selection dims everything outside it. Off while a focus is
   *  held (the paper open in the detail panel): then the focus owns the dimming, and the
   *  selection shows as its cyan rings alone, so dimming means one thing at
   *  a time. */
  selectionDims: boolean
  /** Scoped nodes the view filters would hide, drawn anyway (dotted outer
   *  ring: "shown because it is in scope"). A subset of `selectedIds`. */
  ghostIds: Set<string>
  /** Nodes the teacher is currently talking about (gold glow + ring). */
  highlightIds: Set<string>
  /** Click handler (open / close a paper); the DOM event carries the shift
   *  modifier used for add/remove selection. */
  onNodeClick: (node: VNode, event?: MouseEvent) => void
  /** Hover handler — receives the node id, or null when leaving. */
  onNodeHover: (id: string | null) => void
  /** Drag-step handler (carries the rest of a selection along). */
  onNodeDrag: (node: VNode, translate: DragStep) => void
  /** Drag-release handler (pins the node where it was dropped). */
  onNodeDragEnd: (node: VNode) => void
  /** Sim-settled handler (timeline y-freeze + one-shot zoomToFit). */
  onEngineStop: () => void
  /** Pre-frame painter (the timeline year axis). */
  onRenderFramePre: (ctx: CanvasRenderingContext2D, globalScale: number) => void
}

/**
 * Render the force-directed graph canvas.
 *
 * @returns The configured ForceGraph2D element.
 */
/** Zoom past which every node wears its title. */
const LABEL_ZOOM = 1.6

/**
 * How many nodes a pick or highlight may hold and still be labelled while
 * zoomed out. Small sets are the reason the exemption exists — you picked
 * three papers and want to see which — while a large marquee labelled at every
 * zoom paints an unreadable block of overlapping text over the graph.
 */
const LABEL_ALL_MAX = 12

export default function GraphCanvas({
  fgRef,
  width,
  height,
  data,
  focusSet,
  anchorId,
  pinned,
  expandedIds,
  selectedId,
  selectedIds,
  selectionDims,
  ghostIds,
  highlightIds,
  onNodeClick,
  onNodeHover,
  onNodeDrag,
  onNodeDragEnd,
  onEngineStop,
  onRenderFramePre,
}: GraphCanvasProps) {
  const canvasInk = useCanvasInk()
  return (
    <ForceGraph2D
      ref={fgRef}
      width={width}
      height={height}
      graphData={data}
      backgroundColor={canvasInk.background}
      nodeLabel={(node: GraphNode) =>
        `${latexToUnicode(node.title)}${node.year ? ` (${node.year})` : ''}`
      }
      nodeRelSize={1}
      // The drawn radius, squared: the engine never draws a node here (the
      // canvas object below does), but it ends each arrow at the target's
      // edge by this size. Unset, it took every node for radius 1, and every
      // arrowhead sat hidden under the disc it pointed at (until v8.22.0).
      nodeVal={(node: VNode) => nodeRadius(node) ** 2}
      onNodeClick={onNodeClick}
      onNodeHover={(node: VNode | null) => onNodeHover(node ? node.id : null)}
      onNodeDrag={onNodeDrag}
      onNodeDragEnd={onNodeDragEnd}
      onEngineStop={onEngineStop}
      onRenderFramePre={onRenderFramePre}
      // d3's own full cool-down (alpha 1 → 0.001 at the default decay). At
      // 120 the engine stopped mid-flight: an expansion group still on its
      // way out past the formation froze wherever it was, worst on a restore,
      // where every group starts from scratch at once (v8.18.0).
      cooldownTicks={300}
      // Under a focused paper only its own edges stay lit (`edgeLit`).
      linkColor={(link: VLink) =>
        edgeLit(link, focusSet, anchorId)
          ? (EDGE_COLOR[edgeTypeFrom(link, anchorId)] ?? UNKNOWN_EDGE)
          : DIM_EDGE
      }
      // Arrowheads a step bolder than their line, so the direction reads.
      linkDirectionalArrowColor={(link: VLink) =>
        edgeLit(link, focusSet, anchorId)
          ? (ARROW_COLOR[edgeTypeFrom(link, anchorId)] ?? UNKNOWN_EDGE)
          : DIM_EDGE
      }
      // A link between papers draws finer than a seed edge: there can be
      // hundreds, and they are the web, not the story.
      linkWidth={(link: VLink) => (link._between ? 0.35 : link.influential ? 1.6 : 0.6)}
      // Every edge type is a citation now, so every edge gets an arrow,
      // pointing from the citing paper to the one it cites. The exception
      // this used to carry was `similar`, retired in v7.5.0 — direction meant
      // nothing on an embedding neighbour. A link between papers takes a
      // smaller head, as it takes a finer line.
      linkDirectionalArrowLength={(link: VLink) => (link._between ? 3 : 4.5)}
      linkDirectionalArrowRelPos={1}
      nodeCanvasObject={(
        node: PositionedVNode,
        ctx: CanvasRenderingContext2D,
        globalScale: number,
      ) => {
        const radius = nodeRadius(node)
        // A hand-picked selection dims everything outside it (like focus), on
        // top of any hover/highlight dimming, so the scoped cluster stands out:
        // unless a focus is held, which then owns the dimming (selectionDims).
        const hasSelection = selectionDims && selectedIds.size > 0
        // Whether the pick / highlight is small enough to label at any zoom.
        const pickedFew = selectedIds.size <= LABEL_ALL_MAX
        const litFew = highlightIds.size <= LABEL_ALL_MAX
        const dim =
          (focusSet ? !focusSet.has(node.id) : false) || (hasSelection && !selectedIds.has(node.id))
        const isPicked = selectedIds.has(node.id)
        const isPinned = pinned.has(node.id)
        const isSel = selectedId === node.id
        const isLit = highlightIds.has(node.id)

        // Glow behind papers the teacher is highlighting.
        if (isLit && !dim) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, radius + 5, 0, 2 * Math.PI)
          ctx.fillStyle = 'rgba(255,209,102,0.22)'
          ctx.fill()
        }
        ctx.beginPath()
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI)
        // A dimmed paper keeps a faint trace of its own colour, so who cites
        // and who is cited still shows behind a focus (v8.22.0; grey before).
        const fill = expandedIds.has(node.id) ? EXPANDED_COLOR : REL_COLOR[primaryRel(node)]
        ctx.fillStyle = dim ? dimColor(fill) : fill
        ctx.fill()
        // A thin black outline on every disc (v8.16.0), so overlapping papers
        // read as separate shapes. Its colour is the theme's `--node-outline`
        // (black in both today). Constant on screen at any zoom,
        // and it strokes the fill's own arc, so the rings below still find
        // it as the current path.
        ctx.lineWidth = 1 / globalScale
        ctx.strokeStyle = dim ? canvasInk.outlineDim : canvasInk.outline
        ctx.stroke()
        if (node.discovered && !dim) {
          // A faint halo marks a paper added by expanding (the reader's
          // Expand buttons or the teacher's): a hairline with a little air
          // round the disc. It was a bold dashed ring until v8.18.0, which
          // made a cluster of them look like a stack of poker chips; the
          // group's own place on the map already says where they came from.
          ctx.beginPath()
          ctx.arc(node.x, node.y, radius + 2, 0, 2 * Math.PI)
          ctx.lineWidth = 0.8 / globalScale
          ctx.strokeStyle = canvasInk.soft
          ctx.stroke()
          // Restore the fill's arc as the current path — the lit/pinned/
          // selected rings below stroke it.
          ctx.beginPath()
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI)
        }
        if (isLit && !dim) {
          ctx.lineWidth = 2 / globalScale
          ctx.strokeStyle = '#ffd166'
          ctx.stroke()
        }
        if (isPinned && !dim) {
          ctx.lineWidth = 1.5 / globalScale
          ctx.strokeStyle = canvasInk.soft
          ctx.stroke()
        }
        if (isPicked && !dim) {
          // Cyan ring marks a node in the teacher's scope. Drawn just outside
          // the fill so it coexists with a pin/select/lit ring.
          ctx.beginPath()
          ctx.arc(node.x, node.y, radius + 2.5, 0, 2 * Math.PI)
          ctx.lineWidth = 2 / globalScale
          ctx.strokeStyle = SELECTION_RING
          ctx.stroke()
          if (ghostIds.has(node.id)) {
            // A dotted ring outside the scope ring: this paper is on screen
            // ONLY because it is in scope — the view filters would hide it.
            // The mark is what keeps "the filters are a lens" honest: the
            // reader can see which papers the lens would have dropped.
            ctx.beginPath()
            ctx.arc(node.x, node.y, radius + 5, 0, 2 * Math.PI)
            ctx.lineWidth = 1.2 / globalScale
            ctx.strokeStyle = canvasInk.soft
            ctx.setLineDash([1.5 / globalScale, 2.5 / globalScale])
            ctx.stroke()
            ctx.setLineDash([])
          }
        }
        if (isSel) {
          ctx.lineWidth = 2 / globalScale
          ctx.strokeStyle = canvasInk.hard
          ctx.stroke()
        }
        // Labels: always for the seed and the detail selection, and for a
        // *small* pick or highlight — otherwise only when zoomed in past
        // `LABEL_ZOOM`.
        //
        // The count gate is what keeps a large selection readable. The
        // exemption exists so a deliberate pick of a few papers stays
        // identifiable while zoomed out; a hundred-node marquee is not that,
        // and labelling all of it painted a solid white block over the graph
        // (and over the papers it was meant to name). Same for a beat's
        // highlight, which can now light every paper the beat cites.
        const labelled =
          node.is_seed ||
          isSel ||
          (isLit && litFew) ||
          (isPicked && pickedFew) ||
          globalScale > LABEL_ZOOM
        if (!dim && labelled) {
          const fontSize = Math.max(11 / globalScale, 2)
          ctx.font = `${fontSize}px -apple-system, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = canvasInk.ink
          const title = latexToUnicode(node.title)
          ctx.fillText(
            title.length > 42 ? title.slice(0, 40) + '…' : title,
            node.x,
            node.y + radius + 1,
          )
        }
      }}
      nodePointerAreaPaint={(
        node: PositionedVNode,
        color: string,
        ctx: CanvasRenderingContext2D,
      ) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.x, node.y, nodeRadius(node) + 2, 0, 2 * Math.PI)
        ctx.fill()
      }}
    />
  )
}
