/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Mid-conversation graph growth: the papers the researcher pulls in via its
 * expand_node tool, merged into the live graph without disturbing the
 * simulation. Only the researcher grows the graph — lectures narrate what is
 * already there — and since v7.3.0 only growth that ATTACHES arrives at all:
 * `find_papers` numbers its hits without drawing them, so the edgeless
 * "ungrounded discovery" case below is now reachable only through a saved
 * session from before that change.
 *
 * The core constraint: `base`'s node/link objects are mutated by
 * react-force-graph (x/y) and by user pins (fx/fy), so discoveries must be
 * merged IN PLACE — appending to base.nodes/links, never rebuilding — and a
 * version counter signals dependents to recompute despite `base` keeping the
 * same object identity.
 *
 * The merge also decides a discovery's layout identity (v5.24.0): one whose
 * anchor edge lands on a NON-seed node joins that node's expansion group —
 * its `_origin` records the node, and the group leaves the seed's formation
 * together (see `../clusterForce.ts`'s `expansionGroups`): an anchor of its
 * own in Force, a parallel stream above the seed's in Timeline
 * (`../streamForce.ts`). Ungrounded/seed-anchored discoveries keep the old
 * behavior.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useState } from 'react'
import type { GraphEdge, GraphNode } from '../../api'
import type { Base, VNode } from '../model'

/** Arguments for {@link useDiscovery}. */
export interface UseDiscoveryArgs {
  /** The stable per-graph dataset discoveries are merged into (in place). */
  base: Base | null
  /** The current layout mode (Timeline pins a discovery's x to its year). */
  layout: 'force' | 'timeline'
  /** The user's pins: an expanded paper that is pinned stays where it is. */
  pinned: Set<string>
  /** A node's date-column x (from useTimeline), for Timeline placement. */
  nodeTimelineX: (node: { year: number | null; month?: number | null }) => number
  /** The ForceGraph2D ref, to reheat the sim so new nodes settle in. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: { current: any }
  /** Widen the year filter when a discovery falls outside the current range. */
  onYearLo: (year: number) => void
  onYearHi: (year: number) => void
}

/** What {@link useDiscovery} returns for GraphExplorer to wire up. */
export interface DiscoveryApi {
  /**
   * Bumped whenever base.nodes/links are mutated in place, so the filtered
   * view (and anything else keyed on it) recomputes despite `base` itself
   * keeping the same object identity.
   */
  graphVersion: number
  /**
   * Merge discovery nodes + edges into the live graph. Dedupes internally,
   * so re-feeding the store's full discovery arrays is safe — only papers
   * not yet on the canvas are added. (The discovery LISTS live in the
   * workspace slice — grounding, save, and the legend read from there;
   * this hook owns only the sim-side merge.)
   */
  onDiscover: (newNodes: GraphNode[], newEdges: GraphEdge[]) => void
  /**
   * Take out of the live graph every paper and edge the store no longer
   * holds: what undoing an Expand hop removed (v8.18.0). Same in-place rule
   * as the merge, the other way round.
   */
  onPrune: (keepNodeIds: Set<string>, keepLinkKeys: Set<string>) => void
}

/**
 * Release Timeline's settle-freeze (`useTimeline`'s `freezeSettledY`, which
 * fixes every height once the sim stops) on every paper the reader hasn't
 * pinned, so a growing or shrinking graph can re-settle: what the Release
 * button does, minus the reader's own pins. Until v8.18.0's polish only the
 * expanded paper was thawed, so a new group wedged into the frozen seed's
 * stream on the way to its own, and an undone paper stayed up where its
 * group had been. Harmless in Force, which never freezes.
 *
 * @param base The live dataset (mutated in place).
 * @param pinned The reader's pins, which stay put.
 */
function thawTimeline(base: Base, pinned: Set<string>): void {
  for (const node of base.nodes) {
    if (!pinned.has(node.id)) node.fy = undefined
  }
}

/**
 * The key a live link is matched on between the store and the sim.
 *
 * @param source The citing paper's id.
 * @param target The cited paper's id.
 * @param type The edge type.
 * @returns The key.
 */
export function linkKey(source: string, target: string, type: string | undefined): string {
  return `${source}|${target}|${type}`
}

/**
 * Own the in-place `base` merge for agent discoveries.
 *
 * @returns The merge entry point + the `graphVersion` change counter.
 */
export function useDiscovery({
  base,
  layout,
  pinned,
  nodeTimelineX,
  fgRef,
  onYearLo,
  onYearHi,
}: UseDiscoveryArgs): DiscoveryApi {
  const [graphVersion, setGraphVersion] = useState(0)

  // Reset the version counter per graph.
  useEffect(() => {
    if (!base) return
    setGraphVersion(0)
  }, [base])

  const onDiscover = useCallback(
    (newNodes: GraphNode[], newEdges: GraphEdge[]) => {
      if (!base || (newNodes.length === 0 && newEdges.length === 0)) return
      const knownIds = new Set(base.nodes.map((node) => node.id))
      // A discovery whose edges all point off the canvas is stranded: the
      // paper it was found from is gone (a rebuild named it differently,
      // which is how the hex/corpus id split stranded a whole thread's
      // expansions before v8.18.0). Drawn, it would float loose with nothing
      // to attach to, so it isn't. Grounded means an edge reaches the canvas,
      // directly or through another grounded discovery. A discovery with no
      // edges at all is the legacy ungrounded case below, and still drawn.
      const grounded = new Set(knownIds)
      let grew = true
      while (grew) {
        grew = false
        for (const edge of newEdges) {
          for (const [paper, other] of [
            [edge.source, edge.target],
            [edge.target, edge.source],
          ]) {
            if (!grounded.has(paper) && grounded.has(other)) {
              grounded.add(paper)
              grew = true
            }
          }
        }
      }
      const hasEdges = new Set(newEdges.flatMap((edge) => [edge.source, edge.target]))
      const addedNodes: GraphNode[] = []
      let grouped = false
      for (const node of newNodes) {
        if (knownIds.has(node.id)) continue
        if (hasEdges.has(node.id) && !grounded.has(node.id)) continue
        knownIds.add(node.id)
        // Start near whichever already-placed node it was discovered from, so
        // it doesn't fly in from the origin when the sim reheats. Topic-search
        // hits have no edge (ungrounded) — anchor them on the seed and scatter
        // wider so they settle into a loose cluster instead of stacking on it.
        const anchorEdge = newEdges.find(
          (edge) => edge.source === node.id || edge.target === node.id,
        )
        const anchorId = anchorEdge
          ? anchorEdge.source === node.id
            ? anchorEdge.target
            : anchorEdge.source
          : null
        const anchor = anchorId
          ? base.nodes.find((candidate) => candidate.id === anchorId)
          : base.nodes.find((candidate) => candidate.is_seed)
        const spread = anchorEdge ? 40 : 120
        const viewNode: VNode = { ...node }
        // An expansion anchored on a NON-seed node is a satellite: mark its
        // origin so the cluster force gathers it beyond that node instead of
        // absorbing it into the seed's relation sectors (see clusterForce.ts).
        // Seed-anchored discoveries genuinely belong to the seed's sectors.
        if (anchor && anchorEdge && !anchor.is_seed) viewNode._origin = anchor.id
        if (anchor && typeof anchor.x === 'number' && typeof anchor.y === 'number') {
          viewNode.x = anchor.x + (Math.random() - 0.5) * spread
          viewNode.y = anchor.y + (Math.random() - 0.5) * spread
        }
        if (viewNode._origin) grouped = true
        if (layout === 'timeline') {
          viewNode.fx = nodeTimelineX(viewNode)
          // Timeline can't separate a group in x (it's date-pinned), so the
          // group gets a stream of its own above the seed's timeline
          // (streamForce.ts). It starts at its paper's height and glides up
          // into it: until v8.18.0 it appeared above everything at once.
        }
        base.nodes.push(viewNode)
        addedNodes.push(node)
        node.rels.forEach((rel) => {
          if (rel in base.counts) base.counts[rel]++
        })
        // A discovery older/newer than anything on the graph widens both the
        // base's year range and the active filter, so it stays visible.
        if (typeof node.year === 'number') {
          if (node.year < base.minYear) {
            base.minYear = node.year
            onYearLo(node.year)
          }
          if (node.year > base.maxYear) {
            base.maxYear = node.year
            onYearHi(node.year)
          }
        }
      }

      const knownLinkKeys = new Set(base.links.map((link) => linkKey(link._s, link._t, link.type)))
      let addedLinks = 0
      for (const edge of newEdges) {
        // Both endpoints must be on the canvas. The server upholds this (see
        // the researcher's `_canvas_growth`), but a dangling link is not a
        // cosmetic defect that shows up as a stray line — d3-force raises
        // `missing: <id>` while resolving link endpoints and takes the whole
        // graph down with it. That's too severe a failure to leave resting on
        // a server-side invariant, and dropping the edge costs nothing: the
        // paper it pointed at isn't drawn, so neither is its line.
        if (!knownIds.has(edge.source) || !knownIds.has(edge.target)) continue
        const key = linkKey(edge.source, edge.target, edge.type)
        if (knownLinkKeys.has(key)) continue
        knownLinkKeys.add(key)
        base.links.push({ ...edge, _s: edge.source, _t: edge.target })
        addedLinks++
      }

      if (addedNodes.length || addedLinks) {
        // A group forming moves its paper out of the seed's stream, and its
        // papers have to get past the seed's: none of it can happen through
        // a timeline frozen in place.
        if (grouped) thawTimeline(base, pinned)
        setGraphVersion((version) => version + 1)
        // Reheat so new nodes settle into place, but don't yank the camera —
        // the user may be mid-conversation, not looking at the graph.
        fgRef.current?.d3ReheatSimulation?.()
      }
    },
    [base, layout, pinned, nodeTimelineX, fgRef, onYearLo, onYearHi],
  )

  const onPrune = useCallback(
    (keepNodeIds: Set<string>, keepLinkKeys: Set<string>) => {
      if (!base) return
      const nodesBefore = base.nodes.length
      const linksBefore = base.links.length
      for (let index = base.nodes.length - 1; index >= 0; index--) {
        const node = base.nodes[index]
        if (keepNodeIds.has(node.id)) continue
        base.nodes.splice(index, 1)
        node.rels.forEach((rel) => {
          if (rel in base.counts) base.counts[rel]--
        })
      }
      for (let index = base.links.length - 1; index >= 0; index--) {
        const link = base.links[index]
        if (keepLinkKeys.has(linkKey(link._s, link._t, link.type))) continue
        base.links.splice(index, 1)
      }
      if (base.nodes.length === nodesBefore && base.links.length === linksBefore) return
      // The paper whose hop was undone (and anything its group pulled about)
      // comes back down to the seed's stream: thaw so it can.
      thawTimeline(base, pinned)
      // A paper whose group's paper went (another expansion still holds it
      // to the graph) is no satellite any more: back to the seed's formation.
      for (const node of base.nodes) {
        if (node._origin && !keepNodeIds.has(node._origin)) node._origin = undefined
      }
      setGraphVersion((version) => version + 1)
      fgRef.current?.d3ReheatSimulation?.()
    },
    [base, pinned, fgRef],
  )

  return { graphVersion, onDiscover, onPrune }
}
