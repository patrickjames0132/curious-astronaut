/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The lecture beats: click one to light its papers on the graph, click the
 * active one again to clear. A beat may carry a real paper figure — rendered
 * inline, click to enlarge.
 *
 * **A beat is only a control while its papers are loaded.** A lecture lives in
 * the transcript, the transcript outlives the graph it was told over, and so a
 * beat is routinely read with none of its papers on screen. Clicking one then
 * lights nothing, which is the same dead pointer the inline `[n]` chips grey
 * out for and the same rule the answer bubble follows (`Teacher.tsx`, the
 * `clickable` gate): at least one of the beat's papers has to be there.
 * Partial overlap still counts — lighting the ones that *are* present is
 * useful.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef } from 'react'
import type { AnswerFigure, Beat, SourceRef } from '../../api'
import MathText from '../../notation/MathText'
import FigCard from '../../figures/FigCard'
import AnswerMarkdown from './AnswerMarkdown'

/**
 * Adapt a beat's figure to the shape FigCard/Lightbox render.
 *
 * @param figure The beat's attached figure.
 * @returns The same figure as an `AnswerFigure`.
 */
const asAnswerFigure = (figure: NonNullable<Beat['figure']>): AnswerFigure => ({
  image: figure.image,
  caption: figure.caption,
  title: figure.title ?? null,
  figure: figure.number,
})

/**
 * Render the lecture's beats.
 *
 * @returns The beat cards, papers lighting up on click.
 */
export default function BeatList({
  beats,
  activeBeat,
  sourceRefs,
  onBeatClick,
  onStep,
  onRefClick,
  onEnlarge,
}: {
  beats: Beat[]
  activeBeat: number | null
  /** The lecture's `[Sn]` index → source map, shared by every beat (they all
   *  cite the same retrieved library). */
  sourceRefs?: Record<string, SourceRef>
  onBeatClick: (index: number, beat: Beat) => void
  /** Step from the lit beat (v8.50.0, the Reader's guided read): Back / Next
   *  show on it; without it, beats are only clicked. */
  onStep?: (index: number, step: -1 | 1) => void
  /** Spotlight one paper from a clicked inline `[n]` marker in a beat. */
  onRefClick?: (nodeId: string) => void
  onEnlarge: (figure: AnswerFigure) => void
}) {
  // Stepping through a guided read (v8.50.0) keeps the lit beat, and its
  // Back / Next, in view in the chat: Next could leave it below the fold.
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (!onStep || activeBeat === null) return
    const item = list.current?.children[activeBeat]
    if (item instanceof HTMLElement && typeof item.scrollIntoView === 'function')
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeBeat, onStep])
  if (beats.length === 0) return null
  return (
    <ol className="beats" ref={list}>
      {beats.map((beat, index) => {
        // A beat with no papers — the synthesis that closes most lectures —
        // has nothing to light, so it is not a control: no pointer, no hover,
        // no click. It keeps the card's full colour, though; it used to be
        // dimmed like a beat whose papers had left the graph, and read as
        // disabled or broken when it is the paragraph that ties the lecture
        // together.
        // A guided read's beat lights a passage of the paper (v8.50.0).
        const lightable = beat.node_ids.length > 0 || !!beat.quote || !!beat.labels?.length
        return (
          <li
            key={index}
            className={`beat ${activeBeat === index ? 'active' : ''}${lightable ? '' : ' paperless'}`}
            onClick={lightable ? () => onBeatClick(index, beat) : undefined}
          >
            {beat.heading && (
              <div className="beat-heading">
                <MathText>{beat.heading}</MathText>
              </div>
            )}
            <AnswerMarkdown
              text={beat.text}
              graphRefs={beat.graph_refs}
              sourceRefs={sourceRefs}
              onRefClick={onRefClick}
            />
            {beat.figure && (
              // Enlarging the figure must not toggle the beat's highlight.
              <div onClick={(event) => event.stopPropagation()}>
                <FigCard figure={asAnswerFigure(beat.figure)} onEnlarge={onEnlarge} />
              </div>
            )}
            {onStep && activeBeat === index && (
              <div className="beat-steps" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="link-btn"
                  disabled={index === 0}
                  onClick={() => onStep(index, -1)}
                >
                  ‹ Back
                </button>
                <span className="beat-steps-count">
                  {index + 1} of {beats.length}
                </span>
                <button
                  type="button"
                  className="link-btn"
                  disabled={index === beats.length - 1}
                  onClick={() => onStep(index, 1)}
                >
                  Next ›
                </button>
              </div>
            )}
            {beat.node_ids.length > 0 && (
              // The ✦ is the affordance, not the count — it marks "click to
              // light these". A stale beat keeps the count (it really is about
              // two papers) and drops the mark, the same way a stale `[n]` keeps
              // its number and loses its chip.
              <div className="beat-nodes">
                {beat.node_ids.length} paper{beat.node_ids.length > 1 ? 's' : ''}
                {lightable ? ' ✦' : ''}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
