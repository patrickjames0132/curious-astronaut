/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Compact author metadata with an accessible disclosure for the complete list.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useId, useState } from 'react'
import './authorList.css'

/**
 * Show a bounded author preview, preserving the full list behind a disclosure.
 * @param props Component props.
 * @param props.authors The provider's unmodified author string.
 * @returns Author text and, for long lists, an expand/collapse button.
 */
export default function AuthorList({ authors }: { authors: string }) {
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  const textId = useId()
  const expanded = expandedFor === authors
  const long = authors.length > 160
  const prefix = authors.slice(0, 160)
  const boundary = Math.max(prefix.lastIndexOf(','), 0) || prefix.lastIndexOf(' ')
  const preview = prefix.slice(0, boundary > 0 ? boundary : 160).trimEnd()

  return (
    <span className="author-list">
      <span id={textId}>{long && !expanded ? `${preview}…` : authors}</span>
      {long && ' '}
      {long && (
        <button
          type="button"
          className="author-list-toggle"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpandedFor(expanded ? null : authors)}
        >
          {expanded ? 'Show fewer' : 'Show all authors'}{' '}
          <span aria-hidden="true">{expanded ? '▴' : '▾'}</span>
        </button>
      )}
    </span>
  )
}
