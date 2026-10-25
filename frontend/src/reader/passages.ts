/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The passages a Reader Assistant answer is about (v8.45.0, the Reader's
 * stage 6): read out of the conversation, found in the text view, and lit
 * there. The PDF view lights places instead (`usePdfPassages`): its text
 * layer is in the order the PDF was written, not read, and matching words in
 * it lit the wrong spots.
 *
 * - **What an answer is about**: the paper's words it quotes, which the
 *   assistant wraps in ⟦ and ⟧ (the backend's `READING_QUOTES`), and the
 *   passage its question was asked about, when it came from a highlight
 *   ("Explain this passage from …: “…”").
 * - **Found in the rendered text** by comparing letters and digits only:
 *   case, punctuation, spacing and the like differ between the model's copy
 *   and the HTML. A quote not found whole is found by its first and last few
 *   words, so a small slip in the middle still lands.
 * - **Math by its LaTeX.** A highlighted formula is quoted as LaTeX
 *   (`selection/formulas.ts`), which the page's glyphs never match, so a
 *   passage's formulas are found by the source KaTeX keeps beside each one
 *   and lit whole; its prose, by its words.
 * - **Lit as boxes, a line at a time** (`boxesOf`, drawn by the Reader
 *   behind the text). The CSS Custom Highlight API painted each glyph's own
 *   box, so an equation lit as a patchwork of KaTeX's spans, tall and short
 *   (Patrick, 2026-10-25: "no different from before"). Boxes drawn behind
 *   the text touch no element of KaTeX's or React's, as the Highlight API
 *   didn't, and look the same as the PDF view's.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** A quote in an answer: ⟦the paper's exact words⟧. */
const QUOTE_MARK = /⟦([^⟦⟧]{2,600})⟧/g
/** A highlight's passage in its question: "… passage from X:\n\n“…”". */
const QUESTION_PASSAGE = /passage from [^\n]*:\n\n“([\s\S]+?)”(?:\n\n|$)/
/** Pixels apart two glyph boxes on one line may be and still share a box. */
const JOIN_GAP = 24
/** Words matched at each end of a quote not found whole. */
const END_WORDS = 5

/**
 * The paper's words an answer quotes.
 *
 * @param text The answer's Markdown.
 * @returns The quotes, in order, without their markers.
 */
export function answerQuotes(text: string): string[] {
  return Array.from(text.matchAll(QUOTE_MARK), (match) => match[1].trim()).filter(Boolean)
}

/**
 * The passage a question was asked about, when it came from a highlight.
 *
 * @param text The question as sent.
 * @returns The passage, or null.
 */
export function questionPassage(text: string): string | null {
  return QUESTION_PASSAGE.exec(text)?.[1].trim() || null
}

/** Ligatures a PDF's text can carry, spelled out. */
const LIGATURES: Record<string, string> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'st',
  ﬆ: 'st',
}

/**
 * Text reduced to what a comparison reads: lowercase letters and digits.
 *
 * @param text Any text.
 * @returns Its letters and digits, lowercased, ligatures spelled out.
 */
export function comparable(text: string): string {
  let out = ''
  for (const char of text.normalize('NFKD')) {
    const spelled = LIGATURES[char] ?? char.toLowerCase()
    for (const piece of spelled) if (/[\p{L}\p{N}]/u.test(piece)) out += piece
  }
  return out
}

/** Rendered text, reduced, with where each kept character came from. */
export interface TextIndex {
  text: string
  places: { node: Text; offset: number }[]
}

/**
 * Index the text under an element, reduced as `comparable` does.
 *
 * @param root The element: the text view's article.
 * @returns The index. KaTeX's hidden MathML copy is skipped, so a formula
 *          counts once.
 */
export function indexText(root: Element): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('.katex-mathml, .reader-cite-card, .reader-concepts')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  let text = ''
  const places: TextIndex['places'] = []
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.data
    for (let offset = 0; offset < value.length; offset++) {
      const kept = comparable(value[offset])
      for (const char of kept) {
        text += char
        places.push({ node, offset })
      }
    }
  }
  return { text, places }
}

/**
 * Where a quote is in indexed text.
 *
 * @param index The indexed text.
 * @param quote The quote.
 * @returns The ranges of rendered text it covers, one per text node it
 *          touches (empty when it isn't there). Never one range from its
 *          start to its end: a PDF's text layer is in the order the PDF was
 *          written, not read, and a single range swept in an equation's
 *          glyphs set between a sentence's words (Patrick saw the bars).
 */
export function findQuote(index: TextIndex, quote: string): Range[] {
  const wanted = comparable(quote)
  if (wanted.length < 4) return []
  let start = index.text.indexOf(wanted)
  let end = start + wanted.length
  if (start < 0) {
    // By its ends: the first and last few words, close enough together.
    const words = quote.split(/\s+/).filter((word) => comparable(word))
    if (words.length < END_WORDS * 2) return []
    const head = comparable(words.slice(0, END_WORDS).join(' '))
    const tail = comparable(words.slice(-END_WORDS).join(' '))
    start = index.text.indexOf(head)
    const tailAt = start < 0 ? -1 : index.text.indexOf(tail, start + head.length)
    if (tailAt < 0 || tailAt + tail.length - start > wanted.length * 1.5) return []
    end = tailAt + tail.length
  }
  // Each text node's matched stretch, in order.
  const stretches: { node: Text; from: number; to: number }[] = []
  for (const { node, offset } of index.places.slice(start, end)) {
    const last = stretches.at(-1)
    if (last?.node === node) last.to = offset + 1
    else stretches.push({ node, from: offset, to: offset + 1 })
  }
  return stretches.map(({ node, from, to }) => {
    const range = document.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    return range
  })
}

/** Math in a passage, as `selection/formulas.ts` writes it: part of a
 *  formula (`glyphs (part of $…$)`) or one whole (`$…$`, `$$…$$`). */
const FORMULA = /\(part of (\$\$?)([\s\S]+?)\1\)|(\$\$?)([\s\S]+?)\3/g

/**
 * A passage's prose and formulas, apart: prose is found by its words, a
 * formula by its LaTeX (a highlighted equation reads as LaTeX, never as the
 * page's glyphs).
 *
 * @param passage The passage, as quoted or highlighted.
 * @returns Its stretches of prose (a part-formula's glyphs stay with the
 *          prose before them) and its formulas' LaTeX.
 */
export function passageParts(passage: string): { prose: string[]; formulas: string[] } {
  const prose: string[] = []
  const formulas: string[] = []
  let cursor = 0
  for (const match of passage.matchAll(FORMULA)) {
    prose.push(passage.slice(cursor, match.index))
    formulas.push((match[2] ?? match[4]).trim())
    cursor = match.index + match[0].length
  }
  prose.push(passage.slice(cursor))
  return { prose: prose.map((text) => text.trim()).filter(Boolean), formulas }
}

/**
 * A typeset formula, found by its LaTeX source (KaTeX keeps it in an
 * `<annotation>` of its hidden MathML copy).
 *
 * @param root Where to look.
 * @param latex The formula's LaTeX.
 * @returns The range of its visible glyphs, or null.
 */
export function findFormula(root: Element, latex: string): Range | null {
  const wanted = latex.replace(/\s+/g, '')
  for (const formula of Array.from(root.querySelectorAll('.katex'))) {
    const source = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    if (source?.replace(/\s+/g, '') !== wanted) continue
    const range = document.createRange()
    range.selectNodeContents(formula.querySelector('.katex-html') ?? formula)
    return range
  }
  return null
}

/**
 * Everything a passage covers in rendered text: its prose by its words, its
 * formulas by their LaTeX.
 *
 * @param root Where to look: the text view's article.
 * @param index Its text, indexed (`indexText`).
 * @param passage The passage.
 * @returns The ranges found; empty when none of it is there.
 */
export function findPassage(root: Element, index: TextIndex, passage: string): Range[] {
  const { prose, formulas } = passageParts(passage)
  return [
    ...prose.flatMap((text) => findQuote(index, text)),
    ...formulas.flatMap((latex) => findFormula(root, latex) ?? []),
  ]
}

/** A box to light, in pixels from the top left of the element it's drawn in. */
export interface LitBox {
  left: number
  top: number
  width: number
  height: number
}

/** A box on screen, as its edges. */
interface Edges {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Glyph boxes joined a line at a time: boxes that share most of their
 * height and sit close together become one, so a sentence's line lights as
 * one bar and a typeset equation (its fractions taller than its symbols) as
 * one box.
 *
 * @param boxes The boxes on screen.
 * @returns The joined boxes, top to bottom.
 */
export function joinLines(boxes: Edges[]): Edges[] {
  const joined: Edges[] = []
  const sorted = boxes
    .filter((box) => box.right - box.left > 0.5 && box.bottom - box.top > 0.5)
    .sort((first, second) => first.top - second.top || first.left - second.left)
  for (const box of sorted) {
    const line = joined.find((other) => {
      const shared = Math.min(other.bottom, box.bottom) - Math.max(other.top, box.top)
      const shorter = Math.min(other.bottom - other.top, box.bottom - box.top)
      const apart = Math.max(other.left, box.left) - Math.min(other.right, box.right)
      return shared > shorter * 0.5 && apart < JOIN_GAP
    })
    if (line) {
      line.left = Math.min(line.left, box.left)
      line.top = Math.min(line.top, box.top)
      line.right = Math.max(line.right, box.right)
      line.bottom = Math.max(line.bottom, box.bottom)
    } else joined.push({ ...box })
  }
  return joined
}

/**
 * Where ranges are, as boxes to light in an element: a line at a time.
 *
 * @param ranges The ranges (`findPassage`).
 * @param frame The element the boxes are drawn in (positioned).
 * @returns The boxes, relative to its top left; none where the DOM can't
 *          measure ranges (jsdom).
 */
export function boxesOf(ranges: Range[], frame: Element): LitBox[] {
  const origin = frame.getBoundingClientRect()
  const edges: Edges[] = []
  for (const range of ranges) {
    if (typeof range.getClientRects !== 'function') continue
    // A whole formula is lit as the box it sits in; text, glyph by glyph.
    const rects =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? Array.from(range.getClientRects())
        : [range.getBoundingClientRect()]
    for (const rect of rects)
      edges.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
  }
  return joinLines(edges).map((box) => ({
    left: box.left - origin.left,
    top: box.top - origin.top,
    width: box.right - box.left,
    height: box.bottom - box.top,
  }))
}

/**
 * Scroll a pane so a range sits a third of the way down it.
 *
 * @param pane The scrolling pane.
 * @param range The range.
 */
export function scrollToRange(pane: HTMLElement, range: Range) {
  // A DOM that can't measure ranges (jsdom) measures the element they start in.
  const box =
    typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : range.startContainer.parentElement?.getBoundingClientRect()
  if (!box) return
  const frame = pane.getBoundingClientRect()
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  pane.scrollTo({
    top: pane.scrollTop + box.top - frame.top - pane.clientHeight / 3,
    behavior: still ? 'auto' : 'smooth',
  })
}
