/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The color legend under the graph. The later entries only appear when they
 * apply: pink once a paper has been expanded, the faint halo once an
 * expansion (the reader's or the teacher's) has added papers, and the dotted ring while a scoped paper is on screen
 * that the view filters would otherwise hide. The links between papers need
 * no entry: they draw in the relation colours already listed.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { EXPANDED_COLOR, REL_COLOR } from '../theme'
import '../graph.css'

/** Props for {@link Legend}. */
export interface LegendProps {
  /** At least one paper was added after the build, by an expansion: the
   *  reader's own (the detail panel's Expand buttons) or the teacher's
   *  (faint halo). */
  hasDiscovered: boolean
  /** At least one paper on the graph has been expanded (pink fill). */
  hasExpanded?: boolean
  /** At least one scoped paper is drawn past the view filters (dotted ring). */
  hasGhosts: boolean
}

/**
 * Render the graph's color legend.
 *
 * @returns The legend row.
 */
export default function Legend({ hasDiscovered, hasExpanded = false, hasGhosts }: LegendProps) {
  return (
    <div className="legend">
      <span>
        <i style={{ background: REL_COLOR.seed }} />
        Seed
      </span>
      <span>
        <i style={{ background: REL_COLOR.reference }} />
        References
      </span>
      <span>
        <i style={{ background: REL_COLOR.citation }} />
        Citations
      </span>
      {hasExpanded && (
        <span>
          <i style={{ background: EXPANDED_COLOR }} />
          Expanded
        </span>
      )}
      {hasDiscovered && (
        <span>
          <i className="ring" />
          Added by expanding
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
