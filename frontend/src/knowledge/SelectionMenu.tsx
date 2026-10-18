/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The menu over a passage highlighted in a lesson (v8.25.0): a small pill,
 * after SpatialRead's (Patrick's reference), offering **Explain** (ask the
 * course's assistant about the passage; nothing is added to the graph) and
 * **Expand** (break the idea the passage names out into a concept the
 * lesson's item needs). It is the frontend's first reader of a text
 * selection.
 *
 * The pill sits where `useLessonSelection` puts it, in fixed coordinates.
 * Its buttons act on mouse-down with the default prevented, so pressing one
 * doesn't first clear the selection it acts on.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { LessonSelection } from './useLessonSelection'

/**
 * Render the pill over a selection.
 *
 * @param props Component props.
 * @param props.selection The highlighted passage and its anchor.
 * @param props.onExplain Ask the course's assistant about the passage.
 * @param props.onExpand Add the passage's concept to the graph, under this lesson's item.
 * @returns The menu.
 */
export default function SelectionMenu({
  selection,
  onExplain,
  onExpand,
}: {
  selection: LessonSelection
  onExplain: (text: string) => void
  onExpand: (text: string) => void
}) {
  return (
    <div
      className="selection-menu"
      role="toolbar"
      aria-label="Highlighted text"
      style={{ left: selection.left, top: selection.top }}
    >
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault()
          onExplain(selection.text)
        }}
        title="Ask the Knowledge Graph Assistant to explain this, without adding anything to the graph"
      >
        Explain
      </button>
      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault()
          onExpand(selection.text)
        }}
        title="Add the idea this names to the graph, as something this lesson's item needs"
      >
        Expand
      </button>
    </div>
  )
}
