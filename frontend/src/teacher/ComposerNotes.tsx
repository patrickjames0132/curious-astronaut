/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The quiet lines above an assistant's ask bar (v8.25.0): what the next
 * message is about ("Asking about PPO · 18 papers"), and what answers also
 * draw on (sources, a hand-picked selection). Shared by both assistants.
 *
 * **Each line keeps to one line.** In a narrow docked panel they used to
 * wrap into a block of grey text crowding the bar (Patrick, 2026-10-17). Now
 * a line too long for the panel ends in an ellipsis, and an ⓘ (`ui/InfoTip`,
 * as the 3D course's narrow-panel help) appears beside them holding every
 * line in full; hovering a cut line shows it whole as well. Whether any line
 * is cut is measured, not guessed from the panel's width.
 *
 * **The ⓘ also holds a tip**: how `@` brings a paper or another chat into a
 * question, in full. The placeholders name `@` too, but a narrow panel cuts
 * them short, so with a tip the ⓘ is always there (Patrick, 2026-10-17:
 * keep the `@` help available).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useLayoutEffect, useRef, useState } from 'react'
import InfoTip from '../ui/InfoTip'

/**
 * Render the lines, and an ⓘ when any is cut short.
 *
 * @param props Component props.
 * @param props.notes The lines, top to bottom.
 * @param props.tip Help shown only inside the ⓘ, which then always shows.
 * @returns The block.
 */
export default function ComposerNotes({ notes, tip }: { notes: string[]; tip?: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [cut, setCut] = useState(false)
  const shown = notes.join('\n')
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () =>
      setCut(
        [...box.querySelectorAll<HTMLElement>('.ask-context-note')].some(
          (line) => line.scrollWidth > line.clientWidth + 1,
        ),
      )
    measure()
    // jsdom has no ResizeObserver; there nothing is ever laid out to be cut.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [shown])
  if (!notes.length) return null
  return (
    <div className="composer-notes" ref={boxRef}>
      <div className="composer-notes-lines">
        {notes.map((note) => (
          <p key={note} className="ask-context-note" title={note}>
            {note}
          </p>
        ))}
      </div>
      {(cut || tip) && (
        <InfoTip label="More about this chat" className="composer-notes-tip">
          {cut && notes.map((note) => <p key={note}>{note}</p>)}
          {tip && <p className="composer-notes-hint">{tip}</p>}
        </InfoTip>
      )}
    </div>
  )
}
