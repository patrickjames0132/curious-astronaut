/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's legend, bottom-left like the citation graph's (and on
 * its `.legend` styles): the two kinds of node, the one kind of edge, and
 * the three states a node can be in.
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
        The paper
      </span>
      <span>
        <i style={{ background: KNOWLEDGE_COLOR.concept }} />
        Concept
      </span>
      <span title="An arrow from A to B: understanding A needs B">
        <b className="legend-arrow" aria-hidden="true">
          →
        </b>
        needs
      </span>
      <span>
        <i style={{ background: KNOWLEDGE_COLOR.done, opacity: 0.55 }} />
        Visited
      </span>
      <span>
        <i
          className="legend-known"
          style={{ background: KNOWLEDGE_COLOR.done, color: KNOWLEDGE_COLOR.known }}
        >
          ✓
        </i>
        Known
      </span>
      <span>
        <i className="ring" />
        More to break down
      </span>
    </div>
  )
}
