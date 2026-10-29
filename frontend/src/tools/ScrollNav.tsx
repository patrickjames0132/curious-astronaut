/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The one button over a scrolling tool, with two jobs (Patrick, v8.50.0): at
 * the top of the page, the ↑ up to the paper's cards; scrolled down, a
 * **Back to top** pill back up the page. The other tools' ↑ alone, floating
 * over a scrolled page, read as "back to the top". Drawn by the tools whose
 * page scrolls, the Reader and Criticisms; the app leaves its own ↑ out
 * for them. Opened from another tool for one thing (Criticisms from a
 * Reader note's card, v8.54.0), the way back takes the ↑'s place, as the
 * app's does (`ReturnPill`).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useState, type RefObject } from 'react'
import { useAppDispatch } from '../store'
import type { ThreadRecord, ThreadTool } from '../store/explorations'
import { openTool } from '../store/workspace'
import ReturnPill from './ReturnPill'

/** How far down the pane still counts as the top of the page, in pixels. */
export const AT_TOP = 120

/**
 * Whether a scrolling pane is at its top, kept current as it scrolls.
 *
 * @param pane The pane.
 * @param key Anything that swaps the pane's element (the Reader's view), so
 *            the listener moves to the new one.
 * @returns True within {@link AT_TOP} of the top.
 */
export function useAtTop(pane: RefObject<HTMLElement | null>, key?: unknown): boolean {
  const [atTop, setAtTop] = useState(true)
  useEffect(() => {
    const element = pane.current
    if (!element) return
    const update = () => setAtTop(element.scrollTop < AT_TOP)
    update()
    element.addEventListener('scroll', update, { passive: true })
    return () => element.removeEventListener('scroll', update)
  }, [pane, key])
  return atTop
}

/**
 * The ↑ to the cards at the top, Back to top below it.
 *
 * @param props Component props.
 * @param props.atTop Whether the pane is at its top (see {@link useAtTop}).
 * @param props.thread The thread, for its way back (`returnTo`).
 * @param props.tool The tool drawing it.
 * @param props.paperTitle The thread's title, for the ↑'s tooltip.
 * @param props.topTitle Back to top's tooltip, naming what it goes to the top of.
 * @param props.onTop Go back to the top.
 * @returns The button, in its `.tool-nav`.
 */
export default function ScrollNav({
  atTop,
  thread,
  tool,
  paperTitle,
  topTitle,
  onTop,
}: {
  atTop: boolean
  thread: ThreadRecord
  tool: ThreadTool
  paperTitle: string
  topTitle: string
  onTop: () => void
}) {
  const dispatch = useAppDispatch()
  return (
    <div className="tool-nav">
      {atTop && thread.returnTo?.from === tool ? (
        <ReturnPill to={thread.returnTo.tool} />
      ) : atTop ? (
        <button
          type="button"
          className="tool-back"
          data-tour="tool-back"
          onClick={() => void dispatch(openTool('cards'))}
          title={`Back up to the cards for ${paperTitle}`}
          aria-label="Back to this paper’s cards"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <button type="button" className="tool-return tool-to-top" onClick={onTop} title={topTitle}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 2.5h10M8 14V6M4.5 9.5 8 6l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="tool-return-label">Back to top</span>
        </button>
      )}
    </div>
  )
}
