/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Render a string with its LaTeX math ($…$, $$…$$, \(…\), \[…\]) typeset by
 * KaTeX and everything else as plain text. Use this anywhere paper text reaches
 * an HTML surface — detail panel, lecture beats, chat answers, search hits — so
 * `$\beta_2$` shows as β₂ instead of raw source.
 *
 * KaTeX renders to HTML, so this only works in the DOM. Graph node labels are
 * painted on a canvas; they use {@link latexToUnicode} instead.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { memo, useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

import { splitMath } from './splitMath'

/**
 * One math run, typeset by KaTeX into trusted (self-sanitised) markup.
 *
 * **Memoized so a re-render never rewrites it** (v8.38.0). React re-applies
 * `dangerouslySetInnerHTML` when the element re-renders, replacing every node
 * inside even when the HTML is the same, and a text selection in the removed
 * nodes collapses. A highlighted equation in the Reader lost its highlight
 * the moment the highlight menu's re-render landed (Patrick, 2026-10-24;
 * reproduced live: 168 formula subtrees swapped per render). With `memo`,
 * a formula re-renders only when its LaTeX does.
 *
 * @returns The rendered KaTeX span.
 */
const MathSpan = memo(function MathSpan({ value, display }: { value: string; display: boolean }) {
  // `throwOnError: false` degrades invalid LaTeX to a red-rendered source string
  // rather than throwing — a malformed formula never takes down the surface.
  const html = useMemo(
    () => katex.renderToString(value, { throwOnError: false, displayMode: display }),
    [value, display],
  )
  return <span dangerouslySetInnerHTML={{ __html: html }} />
})

/**
 * Typeset one formula that is already known to be LaTeX — no delimiters, no
 * `splitMath` pass. For callers that hold a formula as a value (the Reader's
 * parsed ar5iv math), where the dollar heuristics have nothing to decide.
 *
 * @param props Component props.
 * @param props.latex The formula's LaTeX source.
 * @param props.display Typeset as a displayed equation rather than inline.
 * @returns The rendered KaTeX span.
 */
export function TeX({ latex, display = false }: { latex: string; display?: boolean }) {
  return <MathSpan value={latex} display={display} />
}

/**
 * Typeset the LaTeX math in `children`. Falls back to rendering the raw string
 * (or nothing, for null/empty) when there's no math, so it's safe to wrap every
 * text surface unconditionally.
 *
 * @returns The interleaved plain/typeset spans, or null for empty input.
 */
export default function MathText({ children }: { children: string | null | undefined }) {
  const segments = useMemo(() => (children ? splitMath(children) : []), [children])
  if (!children) return null
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <MathSpan key={index} value={segment.value} display={segment.display} />
        ),
      )}
    </>
  )
}
