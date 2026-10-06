/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The full-screen figure lightbox (click anywhere or Escape to close).
 *
 * Shared by two unrelated callers — the teacher's agent-cited answer figures
 * (`figure`/`index` always set) and the detail panel's own paper figures
 * (neither is), hence promoted out of `teacher/figures/` to this root-level
 * folder per the frontend's hybrid structure rule (multi-consumer components
 * live at the root, not nested in whichever feature built them first).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef } from 'react'
import type { AnswerFigure } from '../api'
import MathText from '../notation/MathText'
import { usePresence } from '../ui/usePresence'

/**
 * Render a figure enlarged full-screen (click/Escape to dismiss).
 *
 * @returns The overlay, or null when no figure is open.
 */
export default function Lightbox({
  figure,
  onClose,
}: {
  /** The figure to show, or null when closed. Always rendered by its parent,
   *  so the lightbox can fade out over the figure it was showing. */
  figure: AnswerFigure | null
  onClose: () => void
}) {
  // Fades out rather than vanishing (ui/usePresence). The parent has already
  // dropped the figure by then, so the exit shows the last one it had.
  const presence = usePresence(figure !== null)
  const lastFigure = useRef(figure)
  if (figure) lastFigure.current = figure
  const shown = figure ?? lastFigure.current

  // Close on Escape while open.
  useEffect(() => {
    if (!figure) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [figure, onClose])

  if (!presence.present || !shown) return null
  return (
    <div
      className={`fig-lightbox${presence.closing ? ' closing' : ''}`}
      onClick={onClose}
      role="dialog"
      aria-label="Enlarged figure"
      onAnimationEnd={presence.onAnimationEnd}
    >
      <button className="fig-lightbox-close" aria-label="Close">
        ✕
      </button>
      <img
        src={shown.image}
        alt={shown.caption || 'Figure'}
        onClick={(event) => event.stopPropagation()}
      />
      {(shown.title || shown.caption || typeof shown.figure === 'number') && (
        <div className="fig-lightbox-cap" onClick={(event) => event.stopPropagation()}>
          {shown.label ? (
            <b>{shown.label}</b>
          ) : (
            typeof shown.figure === 'number' && <b>Figure {shown.slot ?? shown.figure}</b>
          )}
          {shown.title && (
            <span>
              {typeof shown.figure === 'number' ? ' · ' : ''}
              <b>
                <MathText>{shown.title}</MathText>
              </b>
            </span>
          )}
          {shown.caption && (
            <span>
              {typeof shown.figure === 'number' || shown.title ? ' — ' : ''}
              <MathText>{shown.caption}</MathText>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
