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
 * A 🗑 beside it deletes the docked chat (Patrick), and the dock falls back
 * to the first chat left. The last chat's 🗑 starts it over as a `New chat`,
 * so it shows only once that chat has been talked in (v9.3.0). Two clicks, as the rail's
 * ⋮ → Delete is: the first expands the bin right into "Delete this chat?", the second
 * deletes, and it backs off after a few seconds or a click elsewhere. A
 * conversation has no undo, and a lone bin is one stray click away.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store'
import { chatDeletable, explorationChats } from '../store/chats'
import { dockChatSet } from '../store/explorations'
import { deleteThread, newDockChat } from '../store/workspace'
import ClearGlyph from '../ui/ClearGlyph'
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
  // The 🗑 shows while another chat remains, or once the last one has been
  // talked in (`chatDeletable`): an empty last chat is already new.
  const deletable = useAppSelector(
    (state) => !!record && !!current && chatDeletable(state.transcript, record, current.thread),
  )
  const [open, setOpen] = useState(false)
  const popover = usePresence(open)
  const wrapRef = useRef<HTMLDivElement>(null)
  // Asked once to delete the docked chat, waiting for the second click.
  const [confirming, setConfirming] = useState(false)
  const deleteRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!confirming) return
    const backOff = window.setTimeout(() => setConfirming(false), 4000)
    const away = (event: PointerEvent) => {
      if (!deleteRef.current?.contains(event.target as Node)) setConfirming(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setConfirming(false)
      }
    }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', escape, true)
    return () => {
      window.clearTimeout(backOff)
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', escape, true)
    }
  }, [confirming])
  // A different chat docked is a different question.
  useEffect(() => setConfirming(false), [chatId])

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
      <div className="teacher-chat-row">
        <button
          type="button"
          className="teacher-chat-btn"
          onClick={() => setOpen(!open)}
          aria-haspopup="true"
          aria-expanded={open}
          title="The chat Nova talks in, beside every view: switch to another, or start one"
        >
          In <strong>{current.label}</strong>
          <span className="teacher-chat-caret" aria-hidden="true">
            ▾
          </span>
        </button>
        {deletable && (
          <button
            ref={deleteRef}
            type="button"
            className={`teacher-chat-delete expandable-delete${confirming ? ' confirming' : ''}`}
            onClick={() => {
              if (!confirming) {
                setConfirming(true)
                return
              }
              setConfirming(false)
              void dispatch(deleteThread(current.key))
            }}
            title={
              confirming
                ? chats.length > 1
                  ? 'Delete this chat and all its messages. This cannot be undone.'
                  : 'Delete this chat and all its messages, leaving a new empty chat. This cannot be undone.'
                : 'Delete this chat — asks for confirmation'
            }
            aria-label={confirming ? 'Delete this chat?' : 'Delete this chat'}
          >
            <span className="delete-icon" aria-hidden="true">
              <ClearGlyph />
            </span>
            <span className="delete-label" aria-hidden="true">
              Delete this chat?
            </span>
          </button>
        )}
      </div>
      {popover.present && (
        <div
          className={`scope-pop teacher-chat-pop${popover.closing ? ' closing' : ''}`}
          onAnimationEnd={popover.onAnimationEnd}
          role="group"
          aria-label="Chats"
        >
          <div className="scope-pop-head">
            <span>Talk in</span>
            <span className="scope-pop-actions">
              <button
                type="button"
                className="link-btn"
                onClick={() => setOpen(false)}
                aria-label="Close the chat picker"
              >
                ✕
              </button>
            </span>
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
