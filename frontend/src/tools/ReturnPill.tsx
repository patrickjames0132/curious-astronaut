/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The way back (v8.44.0): where a tool was opened from another for one thing
 * (a concept's lesson from the Reader, a citing paper from Criticisms, a
 * criticism from a Reader note), this pill takes the ↑'s place (Patrick: the
 * two side by side looked like a pair), one click back to the same place,
 * which that tool keeps. Drawn by the app over most tools, and by
 * `ScrollNav` over the tools whose page scrolls (v8.54.0).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useAppDispatch } from '../store'
import type { ThreadTool } from '../store/explorations'
import { openTool } from '../store/workspace'

/** The pill's words, by the tool it returns to: the Reader or Criticisms.
 *  Both reopen where the reader left off. */
export const RETURN_PILLS: Partial<Record<ThreadTool, { label: string; title: string }>> = {
  reader: { label: 'Back to reading', title: 'Back to where you were in the paper' },
  reviews: { label: 'Back to Criticisms', title: 'Back to where you were in the criticisms' },
}

/**
 * The pill.
 *
 * @param props Component props.
 * @param props.to The tool it goes back to.
 * @returns The button.
 */
export default function ReturnPill({ to }: { to: ThreadTool }) {
  const dispatch = useAppDispatch()
  const words = RETURN_PILLS[to]
  return (
    <button
      type="button"
      className="tool-return"
      data-tour="tool-return"
      data-return={to}
      onClick={() => void dispatch(openTool(to))}
      title={words?.title ?? 'Back to where you were'}
      aria-label={words?.label ?? 'Back'}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M6 4 2.5 7.5 6 11M3 7.5h6.5a4 4 0 0 1 0 8H8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="tool-return-label">{words?.label ?? 'Back'}</span>
    </button>
  )
}
