/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The active exploration's threads in two groups (v8.31.0): its
 * Chats and its Papers, each with a ＋, over the shared rail rows.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { useState } from 'react'
import { titleForConversation } from '../api'
import { splitAttached } from '../mentions/attachments'
import { useAppDispatch, useAppSelector, useAppStore } from '../store'
import { deleteThread, newGeneralChat, openThread } from '../store/workspace'
import { threadRenamed, type ThreadRecord } from '../store/explorations'
import { chatDeletable, chatTurns, isChat } from '../store/chats'
import SessionRow from './SessionRow'

/**
 * One group's header: its name, a caret that folds it, and its ＋.
 *
 * @param props Component props.
 * @param props.name The group's name.
 * @param props.open Whether its rows show.
 * @param props.onToggle Fold or unfold it.
 * @param props.onAdd The ＋.
 * @param props.addLabel The ＋'s tooltip and accessible name.
 * @returns The header row.
 */
function GroupHead({
  name,
  open,
  onToggle,
  onAdd,
  addLabel,
}: {
  name: string
  open: boolean
  onToggle: () => void
  onAdd: () => void
  addLabel: string
}) {
  return (
    <div className="thread-group-head">
      <button
        type="button"
        className="thread-group-toggle"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
        onClick={onToggle}
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          style={{ transform: open ? 'rotate(90deg)' : undefined }}
        >
          <path d="m6 3 5 5-5 5" />
        </svg>
        {name}
      </button>
      <button
        type="button"
        className="rail-more rail-add"
        onClick={onAdd}
        aria-label={addLabel}
        title={addLabel}
      >
        ＋
      </button>
    </div>
  )
}

/** Show only the active exploration's children, grouped, using the shared rail controls.
 *
 * **Chats, then Papers** (Patrick, v8.31.0). Once an exploration could hold
 * several chats, a flat list mixing them with paper threads stopped saying
 * which row was which. A thread's group is what it *is* — no paper, a chat;
 * a paper, a paper thread — never what was typed in it, so a chat opened by
 * the Papers ＋ whose `@` is deleted was in Chats all along. Papers shows only
 * once there is one. Each group folds on its caret.
 *
 * @param explorationId Parent owning these threads.
 * @param onNavigate Close a containing quick-navigation panel after selection.
 * @returns Thread navigation, or nothing for an inactive parent.
 */
export default function ThreadList({
  explorationId,
  onNavigate,
}: {
  explorationId: string
  onNavigate?: () => void
}) {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const activeId = useAppSelector((state) => state.explorations.activeId)
  const record = useAppSelector((state) => state.explorations.byId[explorationId])
  const conversations = useAppSelector((state) => state.transcript.byKey)
  const [chatsOpen, setChatsOpen] = useState(true)
  const [papersOpen, setPapersOpen] = useState(true)
  if (activeId !== explorationId || !record) return null
  const chats = record.threads.filter((thread) => !thread.identity)
  /**
   * Name a chat again from every question it holds (v8.31.0), as an
   * exploration's ↻ Re-summarize does: its first-exchange title goes stale as
   * the conversation wanders. The questions go without their `@` attachment
   * lines; a null title leaves the name alone. Chats only — a paper thread's
   * natural name is its paper's.
   *
   * @param thread The chat.
   */
  const resummarize = async (thread: ThreadRecord) => {
    const questions = chatTurns(store.getState().transcript, thread)
      .filter((turn) => turn.role === 'user')
      .map((turn) => splitAttached(turn.text).body)
      .filter(Boolean)
    if (!questions.length) return
    const title = await titleForConversation(questions)
    if (title) dispatch(threadRenamed({ id: thread.id, title }))
  }
  const papers = record.threads.filter((thread) => thread.identity)
  /**
   * One thread's row.
   *
   * A paper's row always offers Delete; a chat's does while another chat
   * remains, or once the last one holds a conversation, whose Delete starts
   * it over as a `New chat` (v9.3.0, `chatDeletable`).
   *
   * @param thread The thread.
   * @returns The row.
   */
  const row = (thread: ThreadRecord) => (
    <SessionRow
      key={thread.id}
      session={{ name: thread.title }}
      active={thread.id === record.activeThreadId}
      working={!!conversations[thread.id]?.running.length}
      onOpen={() => {
        void dispatch(openThread(thread.id))
        onNavigate?.()
      }}
      onRename={(title) => dispatch(threadRenamed({ id: thread.id, title }))}
      onDelete={
        !isChat(thread) || chatDeletable({ byKey: conversations }, record, thread)
          ? () => void dispatch(deleteThread(thread.id))
          : undefined
      }
      onResummarize={thread.identity ? undefined : () => void resummarize(thread)}
    />
  )
  return (
    <nav className="thread-list" aria-label={`Threads in ${record.title}`}>
      <GroupHead
        name="Chats"
        open={chatsOpen}
        onToggle={() => setChatsOpen((open) => !open)}
        onAdd={() => void dispatch(newGeneralChat())}
        addLabel="Start a new chat"
      />
      {chatsOpen && <div className="thread-group">{chats.map((thread) => row(thread))}</div>}
      {papers.length > 0 && (
        <>
          <GroupHead
            name="Papers"
            open={papersOpen}
            onToggle={() => setPapersOpen((open) => !open)}
            onAdd={() => void dispatch(newGeneralChat({ forPaper: true }))}
            addLabel="Find a paper: a chat with @ typed, ready to search"
          />
          {papersOpen && <div className="thread-group">{papers.map((thread) => row(thread))}</div>}
        </>
      )}
    </nav>
  )
}
