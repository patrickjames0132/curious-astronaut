/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What a highlighted range of the Reader says, and where it is from, for the
 * highlight menu (v8.38.0). Formulas read back as their LaTeX through the
 * shared `selection/formulas` (the browser's own reading doubles each one),
 * which is also what the assistant reads best.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { selectionText } from '../selection/formulas'

/**
 * The text a highlighted range of the Reader says: the shared formula-aware
 * reading, with the Reader's own blocks as breaks and its footnote marks
 * (buttons, not part of the sentence) left out.
 *
 * @param range The selection's range.
 * @returns The text, whitespace collapsed.
 */
export function readerSelectionText(range: Range): string {
  return selectionText(range, {
    breaks: '.reader-equation, .reader-equation-body, .reader-listing-line',
    drop: '.reader-note-mark',
  })
}

/** Where a passage is from, and the section the assistant should open on. */
export interface PassageSource {
  /** As a phrase: "section 3.2, Attention", "the abstract". */
  from: string
  /** The section's id, when the passage is in one. */
  sectionId: string | null
}

/**
 * Where the current selection starts: the section (or the abstract, or the
 * references) holding its first character. Read before the menu clears the
 * selection.
 *
 * @returns Its source, or a generic one when nothing is selected.
 */
export function selectionSource(): PassageSource {
  const selection = window.getSelection()
  const start = selection?.rangeCount ? selection.getRangeAt(0).startContainer : null
  const element = start instanceof Element ? start : start?.parentElement
  const holder = element?.closest<HTMLElement>('[data-passage-from]')
  return {
    from: holder?.dataset.passageFrom ?? 'the paper',
    sectionId: holder?.dataset.sectionId ?? null,
  }
}
