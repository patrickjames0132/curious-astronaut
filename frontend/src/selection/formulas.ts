/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * What a highlighted passage says when it meets typeset math (v8.38.0).
 * KaTeX renders every formula twice: a hidden MathML copy for screen readers
 * (with the LaTeX source in an `<annotation>`) and the visible glyphs, so
 * `Selection.toString()` reads a formula twice and garbled.
 *
 * - **A formula selected whole** reads as its LaTeX, fenced `$…$` (`$$…$$`
 *   when displayed), which is also what the assistant reads best.
 * - **Part of a formula** reads as the glyphs selected, then the whole
 *   formula for context: `∇ϕ log πϕ (part of $…$)`. The reader can point at
 *   one term (Patrick, 2026-10-24) and the assistant still sees where it
 *   sits.
 *
 * A first version widened any selection touching a formula to the whole
 * formula, blamed for a highlight that vanished under the menu. It wasn't the
 * cause (the formula's DOM was being rewritten on re-render, fixed in
 * `notation/MathText`'s memoized span), and it stopped a part of an equation
 * being highlighted, so it's gone.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/**
 * The typeset formula a node sits in, if any.
 *
 * @param node A selection boundary's container.
 * @returns Its enclosing `.katex` element, or null.
 */
function formulaOf(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest('.katex') ?? null
}

/**
 * A formula's LaTeX, fenced as its own kind: `$$…$$` displayed, `$…$` inline.
 *
 * Display mode is read from KaTeX's MathML (`<math display="block">`), which
 * sits inside the formula, not from a `.katex-display` ancestor: a copied
 * range that starts at the formula itself has no such ancestor, and a
 * displayed equation was quoted as inline math, wrapping at its `=` and
 * spilling out of the question's bubble (Patrick, 2026-10-24).
 *
 * @param formula A `.katex` element (live, or a clone holding its MathML).
 * @returns The fenced LaTeX, or '' when it has no annotation.
 */
function fenced(formula: Element): string {
  const latex = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent
  if (!latex) return ''
  const display = formula.querySelector('math')?.getAttribute('display') === 'block'
  return display ? `$$${latex}$$` : `$${latex}$`
}

/**
 * Visible glyph text, tidied: KaTeX's zero-width spaces dropped and runs of
 * whitespace joined.
 *
 * @param text Raw text from `.katex-html`.
 * @returns The glyphs as they read.
 */
function glyphText(text: string): string {
  return text.replace(/​/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * How a formula reads when only part of it is selected.
 *
 * @param part The selected glyphs.
 * @param formula The live formula, for its whole LaTeX.
 * @returns E.g. `∇ϕ log πϕ (part of $$…$$)`; the part alone when the
 *          formula has no annotation, the whole LaTeX when the part is all
 *          of it.
 */
function partOf(part: string, formula: Element): string {
  const whole = fenced(formula)
  const glyphs = glyphText(part)
  if (!whole) return glyphs
  const all = glyphText(formula.querySelector('.katex-html')?.textContent ?? '')
  if (!glyphs || glyphs === all) return whole
  return `${glyphs} (part of ${whole})`
}

/** Block elements whose end is a break between words, not a run-on. */
const BREAKS = 'p, li, figcaption, h1, h2, h3, h4, h5, h6, td, th, .katex-display'

/**
 * The text a highlighted range says, formulas read as LaTeX (see the module
 * note for a formula selected only in part).
 *
 * @param range The selection's range.
 * @param options What a container adds: more `breaks` (selectors whose end
 *   separates words) and `drop` (a selector for elements that aren't part of
 *   the sentence, such as a footnote's mark).
 * @param options.breaks Extra break selectors.
 * @param options.drop Elements to leave out.
 * @returns The text, whitespace collapsed.
 */
export function selectionText(
  range: Range,
  { breaks, drop }: { breaks?: string; drop?: string } = {},
): string {
  const first = formulaOf(range.startContainer)
  const last = formulaOf(range.endContainer)
  const fragment = range.cloneContents()
  // Inside one formula: the fragment is bare glyphs, no `.katex` of its own.
  if (first && first === last) {
    for (const hidden of Array.from(fragment.querySelectorAll('.katex-mathml'))) hidden.remove()
    return partOf(fragment.textContent ?? '', first)
  }
  const breakers = breaks ? `${BREAKS}, ${breaks}` : BREAKS
  for (const element of Array.from(fragment.querySelectorAll(breakers))) element.append(' ')
  const formulas = Array.from(fragment.querySelectorAll('.katex'))
  formulas.forEach((math, index) => {
    // The first and last formulas may be cut by the range's ends; any between
    // are whole, their annotation in the clone.
    const cut = index === 0 && first ? first : index === formulas.length - 1 && last ? last : null
    const visible = math.querySelector('.katex-html')?.textContent ?? ''
    if (cut) math.replaceWith(partOf(visible, cut))
    else math.replaceWith(fenced(math) || glyphText(visible))
  })
  if (drop) for (const element of Array.from(fragment.querySelectorAll(drop))) element.remove()
  return (fragment.textContent ?? '').replace(/​/g, '').replace(/\s+/g, ' ').trim()
}
