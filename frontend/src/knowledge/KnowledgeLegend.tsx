/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's legend, bottom-left like the citation graph's (and on
 * its `.legend` styles): the paper and a concept, the one kind of edge, and a
 * concept's states (v8.17.0): known (green) and new (grey, never opened or
 * broken down; it turns violet once you do). Outlines follow the citation
 * graph and need no entry. A synthesis (v8.23.0) gets its entry once the course
 * has one.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { KNOWLEDGE_COLOR } from './look'

/**
 * Render the legend.
 *
 * @param props Component props.
 * @param props.hasSyntheses The course has a synthesis, so its entry shows.
 * @returns The legend row.
 */
export default function KnowledgeLegend({ hasSyntheses = false }: { hasSyntheses?: boolean }) {
  return (
    <div className="legend knowledge-legend" data-tour="knowledge-legend">
      <span>
        <i style={{ background: KNOWLEDGE_COLOR.root }} />
        <span className="knowledge-legend-label">Paper</span>
      </span>
      <span>
        <i style={{ background: KNOWLEDGE_COLOR.concept }} />
        <span className="knowledge-legend-label">Concept</span>
      </span>
      <span title="An arrow from A to B: understanding A depends on B">
        <b className="legend-arrow" aria-hidden="true">
          →
        </b>
        <span className="knowledge-legend-label">Depends on</span>
      </span>
      <span>
        <i style={{ background: KNOWLEDGE_COLOR.known }} />
        <span className="knowledge-legend-label">Known</span>
      </span>
      <span title="Not opened or broken down yet: it turns violet once you do">
        <i style={{ background: KNOWLEDGE_COLOR.fresh }} />
        <span className="knowledge-legend-label">New</span>
      </span>
      {hasSyntheses && (
        <span title="How several concepts or syntheses come together, taught just before what they build toward. Select two or more, then ◆ Synthesize">
          <i className="diamond" style={{ background: KNOWLEDGE_COLOR.synthesis }} />
          <span className="knowledge-legend-label">Synthesis</span>
        </span>
      )}
    </div>
  )
}
