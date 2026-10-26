/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A box drawn over the text view (v8.48.0, the Reader's stage 8): the same
 * ⌥-drag as the PDF's (`useBoxDraw`), but it takes the whole elements it
 * touches rather than a picture of the page. The text has nothing to
 * recover: an equation is already LaTeX, prose already text, and a
 * screenshot of the HTML would be heavy and unreliable under KaTeX. What a
 * box adds is the figures, whose images can't be selected: they go to the
 * model as images (the server fetches them, `routes/agents.py`).
 *
 * Each element reads as a selection over it would (`readerSelectionText`):
 * an equation as its LaTeX, a figure as its tag and caption, a table as its
 * cells, prose as its words. Patrick's call (2026-10-25): consistent with
 * the PDF in the hand, each view sending the best form of what was boxed.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { comparable } from './passages'
import { readerSelectionText } from './selectionText'

/** The blocks a box can take, whole. */
const BLOCKS = [
  'p',
  '.reader-equation',
  '.reader-figure',
  '.reader-table-scroll',
  '.reader-listing',
  '.reader-list > li',
  '.reader-section-title',
  '.reader-inline-heading',
].join(', ')
/** What a box never takes: the notes and cards laid over the text. */
const NOT_TEXT = '.reader-concepts, .reader-cite-card, .reader-concept-card, .reader-text-lit'

/** A box's rectangle in the article, in pixels from its top-left. */
export type ArticleRect = number[]

/** What a box over the text took. */
export interface TextBoxed {
  /** The elements, in reading order. */
  elements: HTMLElement[]
  /** What they say, as the question quotes it. */
  text: string
  /** Their figures' image sources (our figure proxy's URLs). */
  figures: string[]
  /** The rectangle around them, in the article: the box, snapped to them. */
  rect: ArticleRect
}

/**
 * The blocks a box touches, whole: the outermost ones, in reading order.
 *
 * @param article The text view's article.
 * @param rect The box, in the article's pixels.
 * @returns The elements.
 */
export function boxedElements(article: HTMLElement, rect: ArticleRect): HTMLElement[] {
  const origin = article.getBoundingClientRect()
  const [left, top, right, bottom] = rect
  const touched = Array.from(article.querySelectorAll<HTMLElement>(BLOCKS)).filter((element) => {
    if (element.closest(NOT_TEXT)) return false
    const box = element.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return false
    return (
      box.left - origin.left < right &&
      box.right - origin.left > left &&
      box.top - origin.top < bottom &&
      box.bottom - origin.top > top
    )
  })
  // A caption's paragraph inside a figure, a list item's: the outer one says it.
  return touched.filter(
    (element) => !touched.some((other) => other !== element && other.contains(element)),
  )
}

/**
 * What a box over the text takes, and says.
 *
 * @param article The text view's article.
 * @param rect The box, in the article's pixels.
 * @returns What it took, or null when it touched no block.
 */
export function readBox(article: HTMLElement, rect: ArticleRect): TextBoxed | null {
  const elements = boxedElements(article, rect)
  if (!elements.length) return null
  const origin = article.getBoundingClientRect()
  const parts: string[] = []
  const figures: string[] = []
  const edges = [Infinity, Infinity, -Infinity, -Infinity]
  for (const element of elements) {
    const range = document.createRange()
    range.selectNodeContents(element)
    const said = readerSelectionText(range).trim()
    if (said) parts.push(said)
    if (element.matches('.reader-figure'))
      for (const image of Array.from(element.querySelectorAll('img')))
        if (image.getAttribute('src')) figures.push(image.getAttribute('src') ?? '')
    const box = element.getBoundingClientRect()
    edges[0] = Math.min(edges[0], box.left - origin.left)
    edges[1] = Math.min(edges[1], box.top - origin.top)
    edges[2] = Math.max(edges[2], box.right - origin.left)
    edges[3] = Math.max(edges[3], box.bottom - origin.top)
  }
  return { elements, text: parts.join('\n\n'), figures, rect: edges }
}

/** The elements that carry a label both views know, and where it's written. */
const LABELLED = '.reader-equation, .reader-figure'

/**
 * The label an element carries, as both views write it (v8.48.0): a
 * figure's, table's or algorithm's tag ("Figure 1"), an equation's number
 * ("(6)").
 *
 * @param element A `.reader-equation` or `.reader-figure`.
 * @returns Its label, or null for one without.
 */
export function labelOf(element: Element): string | null {
  const tag = element.matches('.reader-equation')
    ? element.querySelector(':scope > .reader-equation-tag')
    : element.querySelector(':scope > figcaption > .reader-figure-tag')
  const label = tag?.textContent?.trim().replace(/\.$/, '')
  return label || null
}

/**
 * The labels of what a box took, in reading order, each once.
 *
 * @param elements The elements.
 * @returns Their labels, and those of the equations and figures inside them.
 */
export function labelsOf(elements: Element[]): string[] {
  const labels: string[] = []
  for (const element of elements) {
    const labelled = [
      ...(element.matches(LABELLED) ? [element] : []),
      ...Array.from(element.querySelectorAll(LABELLED)),
    ]
    for (const item of labelled) {
      const label = labelOf(item)
      if (label && !labels.includes(label)) labels.push(label)
    }
  }
  return labels
}

/**
 * The labels a selection in the text reaches: the equations and figures it
 * touches, even in part (a term of an equation lights the whole equation in
 * the PDF, by its number).
 *
 * @param range The selection's range.
 * @param root The text view's article.
 * @returns Their labels, in reading order.
 */
export function labelsInRange(range: Range, root: Element): string[] {
  const touched = Array.from(root.querySelectorAll(LABELLED)).filter((element) =>
    range.intersectsNode(element),
  )
  return labelsOf(touched)
}

/** What opens a whole section's label ("§6 Conclusion", v8.48.0's labels
 *  grown for a lecture beat about a section, v8.50.0). */
export const SECTION_MARK = '§'

/**
 * A heading's number: its first token, "6", "3.2", "B.1"; or "".
 *
 * @param text The heading, or its number alone.
 * @returns The number, lowercased and without a trailing dot.
 */
function sectionNumber(text: string): string {
  const first = text.trim().split(/\s+/)[0]?.replace(/\.$/, '').toLowerCase() ?? ''
  return /^(?:\d+|[a-h])(?:\.\d+)*$/.test(first) ? first : ''
}

/**
 * A whole section's elements: its own, then its subsections', up to the
 * next section at its level or above (the text view's sections are a flat
 * list, each with its level).
 *
 * @param root The text view's article.
 * @param label The section's label, its mark taken off ("6 Conclusion").
 * @returns The elements, or none when no section is it.
 */
function sectionElements(root: Element, label: string): Element[] {
  const sections = Array.from(root.querySelectorAll<HTMLElement>('section.reader-section'))
  const number = sectionNumber(label)
  const wanted = comparable(label)
  const level = (element: HTMLElement) =>
    Number(/reader-level-(\d)/.exec(element.className)?.[1] ?? 1)
  const index = sections.findIndex((element) => {
    const own = element.querySelector('.reader-section-number')?.textContent ?? ''
    const title = element.querySelector('.reader-section-title')?.textContent ?? ''
    return number ? sectionNumber(own) === number : !!wanted && comparable(title).includes(wanted)
  })
  if (index < 0) return []
  const taken: Element[] = [sections[index]]
  for (const element of sections.slice(index + 1)) {
    if (level(element) <= level(sections[index])) break
    taken.push(element)
  }
  return taken
}

/**
 * The text's elements for some labels, to light whole: an equation's, a
 * figure's, or a whole section's ("§6 Conclusion").
 *
 * @param root The text view's article.
 * @param labels The labels.
 * @returns The elements found, and how many labels weren't.
 */
export function labelElements(
  root: Element,
  labels: string[],
): { elements: Element[]; missing: number } {
  const byLabel = new Map(
    Array.from(root.querySelectorAll(LABELLED)).map((element) => [labelOf(element), element]),
  )
  let missing = 0
  const elements = labels.flatMap((label) => {
    const found = label.startsWith(SECTION_MARK)
      ? sectionElements(root, label.slice(SECTION_MARK.length).trim())
      : (byLabel.get(label) ?? [])
    const list = Array.isArray(found) ? found : [found]
    if (!list.length) missing++
    return list
  })
  return { elements, missing }
}

/** An equation's number right after its LaTeX, as a passage writes a
 *  whole one: `$$…$$ (6)`. */
const NUMBER_AFTER_FORMULA = /\$\$\s*\((\d+[a-z]?)\)/g
/** A float's caption opening a part of a passage: "Figure 1. …". */
const CAPTION_LABEL = /(?:^|\n\n)((?:Figure|Table|Algorithm) \d+)\./g

/**
 * The labels a passage's own words carry, for a question asked before
 * labels were kept on the turn (v8.48.0): an equation's number after its
 * LaTeX, a float's tag opening its caption.
 *
 * @param passage The passage, as its question quotes it.
 * @returns Its labels, in order, each once.
 */
export function labelsInPassage(passage: string): string[] {
  const labels = [
    ...Array.from(passage.matchAll(NUMBER_AFTER_FORMULA), (match) => `(${match[1]})`),
    ...Array.from(passage.matchAll(CAPTION_LABEL), (match) => match[1]),
  ]
  return labels.filter((label, index) => labels.indexOf(label) === index)
}
