/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's legend, bottom-left like the citation graph's (and on
 * its `.legend` styles): the paper and a concept, the one kind of edge, and a
 * concept's states (v8.17.0): known (green) and new (grey, never opened or
 * broken down; it turns violet once you do). Outlines follow the citation
 * graph and need no entry.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { KNOWLEDGE_COLOR } from './look'

/**
 * Render the legend.
 *
 * @returns The legend row.
 */
export default function KnowledgeLegend() {
  return (
    <div className="legend knowledge-legend" data-tour="knowledge-legend">
      <span>
        <i style={{ background: KNOWLEDGE_COLOR.root }} />
        Paper
      </span>
      <span>
        <i style={{ background: KNOWLEDGE_COLOR.concept }} />
        Concept
      </span>
      <span title="An arrow from A to B: understanding A depends on B">
        <b className="legend-arrow" aria-hidden="true">
          →
        </b>
        Depends on
      </span>
      <span>
        <i style={{ background: KNOWLEDGE_COLOR.known }} />
        Known
      </span>
      <span title="Not opened or broken down yet: it turns violet once you do">
        <i style={{ background: KNOWLEDGE_COLOR.fresh }} />
        New
      </span>
    </div>
  )
}
