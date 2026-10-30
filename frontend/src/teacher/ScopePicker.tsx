/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A generic scope picker: a checkbox-per-item popover where ALL checked reads
 * as "no scope" (everything) and NONE checked as "nothing" — the same
 * None/[] semantics the callers carry. The copy (icon, noun, hints) comes in
 * via `labels`; the item shape is just `{id, title}`.
 *
 * **One caller as of v7.21.0**: which uploaded **sources** the assistant may
 * search. It served a second scope — the 🎓 picker deciding whether a played
 * lecture was fed to the researcher — until lectures became chat turns and
 * there was nothing left to opt out of. It stays parameterised rather than
 * being folded back into the composer: the generic shape costs nothing, and
 * the next scope (an agent's reach, a filter set) arrives configured.
 *
 * That history explains the CONTROLLED open state (`open`/`onOpenChange`),
 * which would otherwise look like ceremony: with two pickers side by side and
 * the state component-local, both popovers could be open at once and
 * overlapped illegibly, so the parent arbitrates. Closes via the ✕ in the
 * popover header or by re-clicking the trigger.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { usePresence } from '../ui/usePresence'

/** One selectable item, reduced to what the picker shows. */
export interface ScopeItem {
  id: string
  title: string
}

/** The picker's display copy, so the component is not tied to one scope. */
export interface ScopeLabels {
  /** Leading emoji on the trigger button (`📚` for sources). */
  icon: string
  /** The control's name, the trigger's whole label ("Library filters"), and
   *  the head of its tooltip ("Library filters · 2 of 5 — …"). Named for what
   *  it limits, so it can't be mistaken for a sibling control that limits
   *  something else (v8.28.0: "All sources" sat beside "Filters" and readers
   *  couldn't tell which narrowed what). */
  name: string
  /** Singular noun for the count/empty label ("source" → "All sources"). */
  unit: string
  /** The popover's heading ("Search in", "Feed to answers"). */
  heading: string
  /** Footer hint when everything is checked. */
  allHint: string
  /** Footer hint when a subset is checked. */
  someHint: string
  /** Footer hint when nothing is checked. */
  noneHint: string
  /** The trigger button's tooltip. */
  buttonTitle: string
}

/**
 * Render a scope picker: a trigger button showing the current selection, and a
 * checkbox popover to change it.
 *
 * @param items The selectable items (`{id, title}`).
 * @param checkedIds The ids currently checked.
 * @param open Whether the popover is shown (state lives in the parent, which
 *             keeps sibling pickers mutually exclusive).
 * @param onOpenChange Report the popover's next open state (trigger click, ✕).
 * @param onToggle Flip one item's checked state.
 * @param onSelectAll Check every item.
 * @param onDeselectAll Uncheck every item.
 * @param labels The display copy (icon, noun, heading, hints) — what keeps
 *               the component independent of the scope it is showing.
 * @param dataTour Optional `data-tour` anchor for the guided tour.
 * @returns The collapsible checkbox list.
 */
export default function ScopePicker({
  items,
  checkedIds,
  open,
  onOpenChange,
  onToggle,
  onSelectAll,
  onDeselectAll,
  labels,
  dataTour,
}: {
  items: ScopeItem[]
  checkedIds: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onToggle: (id: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  labels: ScopeLabels
  dataTour?: string
}) {
  // Stays mounted through its exit fade after `open` drops (ui/usePresence).
  const popover = usePresence(open)
  const all = checkedIds.length === items.length
  // `all` still drives the trigger's styling (an off-default scope lights it
  // up), but it can't drive the tooltip's *wording* on its own: "all" claims a
  // breadth a one-item scope hasn't got. With a single item the honest state
  // is just on or off: "Library filters · on" / "Library filters · off".
  const state =
    checkedIds.length === 0
      ? 'off'
      : items.length === 1
        ? 'on'
        : all
          ? 'all'
          : `${checkedIds.length} of ${items.length}`
  // The trigger wears the name alone (v8.28.0, "Library filters" beside
  // "Paper filters"); the state lives in the tooltip and in the note over the
  // bar ("Answers also draw on 2 sources (📚)").
  const buttonTitle = `${labels.name} · ${state} — ${labels.buttonTitle}`
  return (
    <div className="scope-wrap" data-tour={dataTour}>
      <button
        type="button"
        className={`scope-btn ${all ? '' : 'on'}`}
        onClick={() => onOpenChange(!open)}
        // The state is never on the trigger, and docked the label is hidden
        // too (teacher.css), so name and state both live in the tooltip.
        title={buttonTitle}
      >
        <span className="scope-btn-icon">{labels.icon}</span>
        <span className="scope-btn-label">{labels.name}</span>
        {/* Narrowed: how many are in, as a corner badge like the paper
            filters' count beside it (v8.28.0). "0" is a real state — the
            library is off — so it shows too. Docked it sits on the bar's icon. */}
        {!all && (
          <span className="chip-badge" aria-label={`${checkedIds.length} of ${items.length} in`}>
            {checkedIds.length > 9 ? '9+' : checkedIds.length}
          </span>
        )}
      </button>
      {popover.present && (
        <div
          className={`scope-pop${popover.closing ? ' closing' : ''}`}
          onAnimationEnd={popover.onAnimationEnd}
        >
          <div className="scope-pop-head">
            <span>{labels.heading}</span>
            {/* Compact "All / None" (not "Select all / Deselect all"): with a
                subset checked BOTH show at once, and the long labels overflowed
                the 240px popover — heading wrapped, ✕ pushed out of view, a
                horizontal scrollbar underneath. */}
            <span className="scope-pop-actions">
              {/* Bulk actions need something to act on in bulk: with one item
                  "All"/"None" duplicate the checkbox sitting directly beneath
                  them, so they're just two more things to read. */}
              {items.length > 1 && checkedIds.length < items.length && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={onSelectAll}
                  title={`Check every ${labels.unit}`}
                >
                  All
                </button>
              )}
              {items.length > 1 && checkedIds.length > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={onDeselectAll}
                  title={`Uncheck every ${labels.unit}`}
                >
                  None
                </button>
              )}
              <button
                type="button"
                className="link-btn"
                onClick={() => onOpenChange(false)}
                aria-label={`Close the ${labels.unit} picker`}
              >
                ✕
              </button>
            </span>
          </div>
          {items.map((item) => (
            <label key={item.id} className="scope-item">
              <input
                type="checkbox"
                checked={checkedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span className="scope-item-title" title={item.title}>
                {item.title}
              </span>
            </label>
          ))}
          <div className="scope-hint">
            {all ? labels.allHint : checkedIds.length === 0 ? labels.noneHint : labels.someHint}
          </div>
        </div>
      )}
    </div>
  )
}
