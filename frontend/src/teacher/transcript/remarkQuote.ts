/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A remark plugin for the Reader Assistant's quotes (v8.45.0): the paper's
 * exact words it wraps in ⟦ and ⟧ (the backend's `READING_QUOTES`) become
 * `paperquote` elements, which `AnswerMarkdown` shows as quotes that light
 * their place in the paper when clicked. A marker left unmatched (a quote
 * still streaming in, or one the model ran across formatting) is dropped, so
 * a bracket never shows as text. Like `remarkCite`, it runs on text nodes
 * only: inline code and math are left alone.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { Root, Text } from 'mdast'
import type { Parent } from 'unist'
import { visit } from 'unist-util-visit'

/** A whole quote. */
const QUOTE = /⟦([^⟦⟧]+)⟧/g
/** A marker on its own. */
const STRAY = /[⟦⟧]/g

/** The synthetic node: `<paperquote quote="…">…</paperquote>` once in hast. */
interface PaperQuoteNode {
  type: 'paperquote'
  data: { hName: 'paperquote'; hProperties: { quote: string } }
  children: Text[]
}

/**
 * The remark plugin: rewrite ⟦quotes⟧ in text nodes into `paperquote`
 * elements and drop stray markers.
 *
 * @returns The mdast transformer remark runs over each tree.
 */
export function remarkQuote() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent: Parent | undefined) => {
      if (!parent || index === undefined || !STRAY.test(node.value)) return
      STRAY.lastIndex = 0
      const value = node.value
      const replacements: (Text | PaperQuoteNode)[] = []
      let cursor = 0
      for (const match of value.matchAll(QUOTE)) {
        if (match.index > cursor)
          replacements.push({
            type: 'text',
            value: value.slice(cursor, match.index).replace(STRAY, ''),
          })
        const quote = match[1].trim()
        replacements.push({
          type: 'paperquote',
          data: { hName: 'paperquote', hProperties: { quote } },
          children: [{ type: 'text', value: quote }],
        })
        cursor = match.index + match[0].length
      }
      if (cursor < value.length)
        replacements.push({ type: 'text', value: value.slice(cursor).replace(STRAY, '') })
      parent.children.splice(index, 1, ...(replacements as Parent['children']))
      return index + replacements.length
    })
  }
}
