/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * One attached figure: proxied image + caption, click to enlarge. A lesson
 * image (v8.24.0) also links its credit to where it came from and carries
 * the tutor's description of what it shows.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { AnswerFigure } from '../api'
import MathText from '../notation/MathText'
import './figures.css'

/**
 * Render one inline figure card.
 *
 * @param props The card's props.
 * @param props.figure The figure: its image, label, credit, caption, and for
 *   a lesson image its credit's link and description.
 * @param props.onEnlarge Open it in the lightbox.
 * @returns The figure with its numbered caption.
 */
export default function FigCard({
  figure,
  onEnlarge,
}: {
  figure: AnswerFigure
  onEnlarge: (figure: AnswerFigure) => void
}) {
  const credit = figure.title ? <MathText>{figure.title}</MathText> : null
  return (
    <figure className="chat-fig">
      <button
        type="button"
        className="chat-fig-btn"
        onClick={() => onEnlarge(figure)}
        title="Click to enlarge"
        aria-label="Enlarge figure"
      >
        <img
          src={figure.image}
          alt={figure.description || figure.caption || 'Figure'}
          loading="lazy"
        />
      </button>
      <figcaption className="chat-fig-cap">
        {figure.description && (
          <span className="chat-fig-desc">
            <MathText>{figure.description}</MathText>
          </span>
        )}
        {/* The float's own designation when its caption carried one
            ("Figure 12.4"); else number attachments in answer order. */}
        <b>{figure.label ?? `Figure ${figure.slot ?? figure.figure ?? 1}`}</b>
        {credit ? (
          <>
            {' · '}
            {/* The source stands out like the label; only the caption stays
                muted. A lesson image's credit leads to its source. */}
            {figure.link ? (
              <a
                className="chat-fig-credit"
                href={figure.link}
                target="_blank"
                rel="noreferrer"
                title="Open the source"
              >
                {credit}
              </a>
            ) : (
              <b>{credit}</b>
            )}
          </>
        ) : null}
        {figure.caption ? (
          <>
            {' — '}
            <MathText>{figure.caption}</MathText>
          </>
        ) : null}
      </figcaption>
    </figure>
  )
}
