/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The color legend under the graph. The later entries only appear when they
 * apply: the orange survey ring while a survey is drawn, pink once a paper
 * has been expanded, and the dotted ring while a scoped paper is on screen
 * that the view filters would otherwise hide. The edges need no entry of
 * their own: they draw in the same two colours, seen from the paper in focus
 * (v8.22.0), which the References and Citations tooltips say.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { EXPANDED_COLOR, REL_COLOR } from '../theme'
import '../graph.css'

/** Props for {@link Legend}. */
export interface LegendProps {
  /** At least one paper on the graph has been expanded (pink fill). */
  hasExpanded?: boolean
  /** A survey or review is drawn (orange ring). */
  hasSurveys?: boolean
  /** At least one scoped paper is drawn past the view filters (dotted ring). */
  hasGhosts: boolean
}

/**
 * Render the graph's color legend.
 *
 * @returns The legend row.
 */
export default function Legend({
  hasExpanded = false,
  hasSurveys = false,
  hasGhosts,
}: LegendProps) {
  return (
    <div className="legend">
      <span>
        <i style={{ background: REL_COLOR.seed }} />
        Seed
      </span>
      <span title="Papers the seed cites. A blue edge runs to a paper the one in focus cites (the seed, or the paper you've opened or are pointing at).">
        <i style={{ background: REL_COLOR.reference }} />
        References
      </span>
      <span title="Papers that cite the seed. A green edge runs from a paper that cites the one in focus (the seed, or the paper you've opened or are pointing at).">
        <i style={{ background: REL_COLOR.citation }} />
        Citations
      </span>
      {hasSurveys && (
        <span title="Surveys and reviews: the field's own overviews of a period. The ring is orange; the fill still says whether it's a reference or a citation.">
          <i className="ring survey" />
          Surveys
        </span>
      )}
      {hasExpanded && (
        <span>
          <i style={{ background: EXPANDED_COLOR }} />
          Expanded
        </span>
      )}
      {hasGhosts && (
        <span>
          <i className="ring ghost" />
          In scope, hidden by your filters
        </span>
      )}
    </div>
  )
}
