/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's controls, folded into a sliders button in the
 * top-left corner exactly as the citation graph's are (and styled by the same
 * `.ctrl-icon` / `.controls` rules, so the two canvases share one corner
 * button): 2D / 3D, the citation graph's action row
 * (Release · Fit · Clear; no Refresh, since nothing here is refetched), and
 * the gesture hints. Folded by default, so the canvas is the reader's. Until
 * v8.17.0 it also showed the course's progress and a Next lesson button; the
 * lesson panel's footer keeps Next lesson.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useState } from 'react'
import SlidersGlyph from '../ui/SlidersGlyph'
import { usePresence } from '../ui/usePresence'

/**
 * Render the folding controls.
 *
 * @param props Component props.
 * @param props.threeD Whether the 3D view is on.
 * @param props.onThreeD Switch between 2D and 3D.
 * @param props.onFit Fit the whole course in view.
 * @param props.pinnedCount Nodes pinned by dragging.
 * @param props.onRelease Unpin them all.
 * @param props.selectedCount Nodes picked to check off.
 * @param props.onClear Drop the selection.
 * @returns The button, or the open panel.
 */
export default function KnowledgeControls({
  threeD,
  onThreeD,
  onFit,
  pinnedCount,
  onRelease,
  selectedCount,
  onClear,
}: {
  threeD: boolean
  onThreeD: (on: boolean) => void
  onFit: () => void
  pinnedCount: number
  onRelease: () => void
  selectedCount: number
  onClear: () => void
}) {
  const [collapsed, setCollapsed] = useState(true)
  const panel = usePresence(!collapsed)

  return (
    <>
      {collapsed && !panel.present && (
        <button
          type="button"
          className="ctrl-icon"
          data-tour="knowledge-controls"
          aria-expanded={false}
          onClick={() => setCollapsed(false)}
          title="Open the course controls — 2D / 3D, Release · Fit · Clear"
          aria-label="Open the course controls"
        >
          <SlidersGlyph />
        </button>
      )}
      <div
        className={`controls knowledge-controls${panel.closing ? ' closing' : ''}`}
        hidden={!panel.present}
        onAnimationEnd={panel.onAnimationEnd}
      >
        <button
          type="button"
          className="ctrl-head"
          data-tour={panel.present ? 'knowledge-controls' : undefined}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(true)}
          title="Fold the controls away into the sliders button"
        >
          <span>Course controls</span>
          <span className="ctrl-head-caret" aria-hidden="true">
            ▴
          </span>
        </button>

        <div className="ctrl-body">
          <div className="ctrl-label">View</div>
          <div className="layout-toggle">
            <button className={threeD ? '' : 'on'} onClick={() => onThreeD(false)}>
              2D
            </button>
            <button
              className={threeD ? 'on' : ''}
              onClick={() => onThreeD(true)}
              title="Fly through the course in 3D"
            >
              3D
            </button>
          </div>

          {/* The citation graph's action row, less Refresh: nothing here is
              fetched that a refetch would change. */}
          <div className="ctrl-btns knowledge-actions">
            <button
              type="button"
              className="mini-btn"
              onClick={onRelease}
              disabled={pinnedCount === 0}
              title="Unpin every node you dragged and let the layout settle"
            >
              Release {pinnedCount || ''}
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={onFit}
              title="Fit the course in view"
            >
              Fit
            </button>
            <button
              type="button"
              className="mini-btn"
              onClick={onClear}
              disabled={selectedCount === 0}
              title="Clear the selection (Esc does the same)"
            >
              Clear
            </button>
          </div>

          <p className="ctrl-hint">
            Click a node for its lesson · double-click to break it down · drag a node to pin it ·
            shift-click or alt-drag to select several and check them off together
            {threeD ? ' · drag to orbit, scroll to zoom' : ' · drag to pan, scroll to zoom'}
          </p>
        </div>
      </div>
    </>
  )
}
