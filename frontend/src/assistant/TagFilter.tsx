/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The menu that filters a chat by where its questions were asked (v9.0.0,
 * the OnePager's "One assistant", stage 4a). A chat crosses views on purpose,
 * so it can hold a course's conversation, a Reader's and a graph's in one
 * transcript; picking a place here shows only the exchanges asked there,
 * which is each tool's own conversation back when it is wanted. Shown once a
 * chat has questions from two places or more.
 *
 * **One line, however many places** (Patrick): it was a row of chips, which
 * wrapped into rows over the transcript as an exploration's papers and tools
 * added up. It's a menu like the chat picker now, General first, then each
 * paper's title with its tools under it, so a long title is said once.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState } from 'react'
import type { TurnTag } from '../api'
import { shownPlace } from '../store/chats'
import { TagText } from '../teacher/transcript/ChatMessage'
import { usePresence } from '../ui/usePresence'

/** A place a chat's questions were asked. */
export interface TagChoice {
  /** Its filter key (`tagKey`). */
  key: string
  /** Its label, `General` or `<paper> › <tool>`. */
  label: string
  /** The paper's title, null for General. */
  paper: string | null
  /** The tool's name, null for General. */
  tool: string | null
}

/**
 * A tag as a filter key: `general`, or the paper and its tool. A bridge
 * question is General here too (`shownPlace`): it had a key of its own,
 * "Across papers", until it read as General everywhere (Patrick).
 *
 * @param tag The tag; absent means General.
 * @returns The key.
 */
export function tagKey(tag: TurnTag | undefined): string {
  const place = shownPlace(tag)
  return place ? `${place.threadId}:${place.tool}` : 'general'
}

/**
 * Render the filter.
 *
 * @param props Component props.
 * @param props.tags Each place the chat's questions were asked, in order.
 * @param props.value The place shown, or null for all of them.
 * @param props.onChange Show one place, or null for all.
 * @returns The line and its menu.
 */
export default function TagFilter({
  tags,
  value,
  onChange,
}: {
  tags: TagChoice[]
  value: string | null
  onChange: (key: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const popover = usePresence(open)
  const wrapRef = useRef<HTMLDivElement>(null)
  const shown = tags.find((tag) => tag.key === value)

  // A menu, so a click anywhere else or Esc puts it away.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  /**
   * Show a place (or all) and put the menu away.
   *
   * @param key The place, or null for all.
   */
  const choose = (key: string | null) => {
    onChange(key)
    setOpen(false)
  }
  // General first, then each paper with its tools under it, in the order the
  // chat first asked from them.
  const general = tags.find((tag) => tag.key === 'general')
  const papers = new Map<string, TagChoice[]>()
  for (const tag of tags)
    if (tag.paper !== null) papers.set(tag.paper, [...(papers.get(tag.paper) ?? []), tag])

  /**
   * One place in the menu.
   *
   * @param key The place's key, or null for all.
   * @param words What the row says.

   * @returns The row.
   */
  const item = (key: string | null, words: string) => (
    <label key={key ?? 'all'} className="scope-item">
      <input type="radio" name="tag-filter" checked={value === key} onChange={() => choose(key)} />
      <span className="scope-item-title" title={words}>
        {words}
      </span>
    </label>
  )

  return (
    <div className="tag-filter scope-wrap" ref={wrapRef}>
      <button
        type="button"
        className="tag-filter-btn"
        onClick={() => setOpen(!open)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Show only the questions asked from one place"
      >
        <span className="tag-filter-showing">Showing:</span>
        {shown ? <TagText label={shown.label} /> : <span className="chat-tag-paper">All</span>}
        <span className="teacher-chat-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {popover.present && (
        <div
          className={`scope-pop tag-filter-pop${popover.closing ? ' closing' : ''}`}
          onAnimationEnd={popover.onAnimationEnd}
          role="group"
          aria-label="Show the questions asked from"
        >
          <div className="scope-pop-head">
            <span>Show questions asked from</span>
            <span className="scope-pop-actions">
              <button
                type="button"
                className="link-btn"
                onClick={() => setOpen(false)}
                aria-label="Close the filter"
              >
                ✕
              </button>
            </span>
          </div>
          {item(null, 'All')}
          {general && item(general.key, 'General')}
          {[...papers].map(([paper, tools]) => (
            <div key={paper} role="group" aria-label={paper}>
              <div className="tag-filter-paper" title={paper}>
                {paper}
              </div>
              {tools.map((tool) => item(tool.key, tool.tool ?? tool.label))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
