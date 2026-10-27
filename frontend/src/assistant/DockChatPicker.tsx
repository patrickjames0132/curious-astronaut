/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The line under a docked panel's title: which chat it talks in, and a menu
 * to switch (v9.0.0). Every view's dock shares the chat you were last in
 * (`store/chats`); this picks another, or starts one, without leaving the
 * view (Patrick, at 2a's browser test: switching here rather than a button
 * between full screen and docked). The rail still opens a chat full screen.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { explorationChats } from '../store/chats'
import { dockChatSet } from '../store/explorations'
import { newDockChat } from '../store/workspace'
import { usePresence } from '../ui/usePresence'

/**
 * Render the dock's chat and its picker.
 *
 * @param props Component props.
 * @param props.chatId The dock's chat, its key.
 * @returns The line, or nothing when the chat isn't found.
 */
export default function DockChatPicker({ chatId }: { chatId: string }) {
  const dispatch = useAppDispatch()
  const record = useAppSelector((state) => state.explorations.byId[state.explorations.activeId])
  const chats = record ? explorationChats(record) : []
  const current = chats.find((chat) => chat.key === chatId)
  const [open, setOpen] = useState(false)
  const popover = usePresence(open)
  const wrapRef = useRef<HTMLDivElement>(null)

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

  if (!current) return null
  /**
   * Dock a chat and put the menu away.
   *
   * @param key The chat's key.
   */
  const choose = (key: string) => {
    dispatch(dockChatSet(key))
    setOpen(false)
  }
  return (
    <div className="teacher-chat scope-wrap" ref={wrapRef}>
      <button
        type="button"
        className="teacher-chat-btn"
        onClick={() => setOpen(!open)}
        aria-haspopup="true"
        aria-expanded={open}
        title="The chat every view's assistant talks in: switch to another, or start one"
      >
        In <strong>{current.label}</strong>
        <span className="teacher-chat-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {popover.present && (
        <div
          className={`scope-pop teacher-chat-pop${popover.closing ? ' closing' : ''}`}
          onAnimationEnd={popover.onAnimationEnd}
          role="group"
          aria-label="Chats"
        >
          <div className="scope-pop-head">
            <span>Talk in</span>
          </div>
          {chats.map((chat) => (
            <label key={chat.key} className="scope-item">
              <input
                type="radio"
                name="dock-chat"
                checked={chat.key === chatId}
                onChange={() => choose(chat.key)}
              />
              <span className="scope-item-title" title={chat.label}>
                {chat.label}
              </span>
            </label>
          ))}
          <button
            type="button"
            className="teacher-chat-new"
            onClick={() => {
              void dispatch(newDockChat())
              setOpen(false)
            }}
          >
            ＋ New chat
          </button>
        </div>
      )}
    </div>
  )
}
