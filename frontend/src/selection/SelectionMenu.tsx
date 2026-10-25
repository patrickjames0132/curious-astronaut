/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The menu over a highlighted passage (v8.25.0): a small pill, after
 * SpatialRead's (Patrick's reference). Each tool brings its own actions: a
 * Knowledge Graph lesson offers Explain · Expand · Chat, the Reader
 * (v8.38.0) Explain · Simplify · Chat. Moved here from `knowledge/` when the
 * Reader became its second user.
 *
 * The pill sits where `useTextSelection` puts it, in fixed coordinates. Its
 * buttons act on mouse-down with the default prevented, so pressing one
 * doesn't first clear the selection it acts on.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { TextSelection } from './useTextSelection'
import './selection.css'

/** One button on the pill. */
export interface SelectionAction {
  label: string
  /** Its tooltip: what it does with the passage. */
  title: string
  /** Act on the highlighted text. */
  onPick: (text: string) => void
}

/**
 * Render the pill over a selection.
 *
 * @param props Component props.
 * @param props.selection The highlighted passage and its anchor.
 * @param props.actions The buttons, in order.
 * @param props.label What the toolbar is over, for screen readers: a box
 *   drawn over the PDF (v8.46.0) isn't highlighted text.
 * @returns The menu.
 */
export default function SelectionMenu({
  selection,
  actions,
  label = 'Highlighted text',
}: {
  selection: TextSelection
  actions: SelectionAction[]
  label?: string
}) {
  return (
    <div
      className="selection-menu"
      role="toolbar"
      aria-label={label}
      style={{ left: selection.left, top: selection.top }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onMouseDown={(event) => {
            event.preventDefault()
            action.onPick(selection.text)
          }}
          title={action.title}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
