/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The folded controls' icon: three slider tracks, each knob at a different
 * point — "settings you can tune", in the shape every app uses for it. Shared
 * by the paper graph's controls and the knowledge graph's (v8.14.0), so the
 * two corner buttons that unfold a canvas's controls are the same button.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/**
 * Render the sliders glyph.
 *
 * @returns The inline SVG, drawn in currentColor.
 */
export default function SlidersGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 4h12M2 8h12M2 12h12" />
      </g>
      <g stroke="currentColor" strokeWidth="1.5" fill="var(--panel)">
        <circle cx="6" cy="4" r="1.9" />
        <circle cx="10.5" cy="8" r="1.9" />
        <circle cx="4.5" cy="12" r="1.9" />
      </g>
    </svg>
  )
}
