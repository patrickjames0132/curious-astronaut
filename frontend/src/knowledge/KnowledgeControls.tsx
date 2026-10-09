/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge graph's controls, folded into a sliders button in the
 * top-left corner exactly as the citation graph's are (and styled by the same
 * `.ctrl-icon` / `.controls` rules, so the two canvases share one corner
 * button): the course's progress and next lesson, 2D / 3D, label density,
 * fit to view, and the gesture hints. Folded by default, so the canvas is
 * the reader's.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useState } from 'react'
import SlidersGlyph from '../ui/SlidersGlyph'
import { usePresence } from '../ui/usePresence'
import type { LabelMode } from './look'

/**
 * Render the folding controls.
 *
 * @param props Component props.
 * @param props.total Lessons in the course.
 * @param props.left Lessons still unchecked.
 * @param props.nextTitle The next lesson's title, when there is one to go to.
 * @param props.started True once any lesson has been opened.
 * @param props.onNext Go to the next lesson.
 * @param props.threeD Whether the 3D view is on.
 * @param props.onThreeD Switch between 2D and 3D.
 * @param props.labels Which nodes are named.
 * @param props.onLabels Change label density.
 * @param props.onFit Fit the whole course in view.
 * @returns The button, or the open panel.
 */
export default function KnowledgeControls({
  total,
  left,
  nextTitle,
  started,
  onNext,
  threeD,
  onThreeD,
  labels,
  onLabels,
  onFit,
}: {
  total: number
  left: number
  nextTitle: string | null
  started: boolean
  onNext: () => void
  threeD: boolean
  onThreeD: (on: boolean) => void
  labels: LabelMode
  onLabels: (mode: LabelMode) => void
  onFit: () => void
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
          title="Open the course controls — progress, next lesson, 2D / 3D, labels"
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
          <div className="course-progress-row">
            <span>
              {left === 0
                ? 'All done — every lesson checked off'
                : `${left} of ${total} lesson${total === 1 ? '' : 's'} left`}
            </span>
            {nextTitle && (
              <button
                type="button"
                className="course-next"
                onClick={onNext}
                title={`Next: ${nextTitle}`}
              >
                {started ? 'Next lesson ›' : 'Start ›'}
              </button>
            )}
          </div>

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

          <div className="ctrl-label">Labels</div>
          <div className="layout-toggle">
            <button
              className={labels === 'nearby' ? 'on' : ''}
              onClick={() => onLabels('nearby')}
              title="Name the paper, the open lesson and what joins it, and whatever you point at"
            >
              Nearby
            </button>
            <button className={labels === 'all' ? 'on' : ''} onClick={() => onLabels('all')}>
              All
            </button>
          </div>

          <button type="button" className="course-fit" onClick={onFit}>
            Fit the course in view
          </button>

          <p className="ctrl-hint">
            Click a node for its lesson · double-click to break it down
            {threeD ? ' · drag to orbit, scroll to zoom' : ' · drag to pan, scroll to zoom'}
          </p>
        </div>
      </div>
    </>
  )
}
