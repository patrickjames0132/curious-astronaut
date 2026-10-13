/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The marks a `.btn-marked` button leads with (+, −, ✓, ✕), drawn as one
 * family of stroked icons on the same 12-unit grid. As text they came out
 * mismatched: the + and − are plain Arial glyphs, thin and 10px wide, beside
 * a heavier 13px ✓ from a symbol font, so the four never looked one size.
 * Drawn, they match at any font, and take the button's text colour.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** The marks there are. */
export type MarkKind = 'plus' | 'minus' | 'check' | 'cross'

/** Each mark's strokes, on a 12×12 grid. */
const PATHS: Record<MarkKind, string> = {
  plus: 'M6 1.5v9M1.5 6h9',
  minus: 'M1.5 6h9',
  check: 'M1.5 6.5l3 3 6-7',
  cross: 'M2 2l8 8M10 2l-8 8',
}

/**
 * One button mark, sized by `.mark-icon` in `app.css`.
 *
 * @param props The mark.
 * @param props.kind Which mark to draw.
 * @returns The icon, hidden from screen readers (the button's label names it).
 */
export default function MarkIcon({ kind }: { kind: MarkKind }) {
  return (
    <svg className="mark-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d={PATHS[kind]} />
    </svg>
  )
}
