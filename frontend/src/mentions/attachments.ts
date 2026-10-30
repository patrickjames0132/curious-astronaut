/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * `@` picks as attachments (v8.29.0): what a pick becomes now that it is a
 * chip over the bar rather than text spliced into the question. Patrick, on
 * the inline `@Title`: "it's hard to tell where the @ ends and the user's
 * prompt begins."
 *
 * The chips are the composer's state; on send they become one leading line,
 * `Attached: @Title · @thread[Chat]`, ahead of the question. That keeps every
 * reader of mentions working unchanged — `readMessage` and `mentionsIn` find
 * a paper by its `@Title` text, `borrowedChats` and the sibling context find a
 * chat by its `@thread[…]` text, and the model's history carries the names —
 * while the transcript reads the line back (`splitAttached`) and shows chips
 * again instead of the raw tokens.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { mentionText, type ActiveMention, type MentionChoice } from './parse'

/** The leading line's label. */
const ATTACHED = 'Attached: '
/** Between attachments on that line — never in a title in practice, and the
 *  same separator the composer notes use. */
const SEPARATOR = ' · '

/**
 * A chip's identity, so the same paper or chat is never attached twice.
 *
 * @param choice The attachment.
 * @returns Its key.
 */
export function attachmentKey(choice: MentionChoice): string {
  return choice.kind === 'paper' ? `paper:${choice.paper.id}` : `thread:${choice.thread.id}`
}

/**
 * Add a pick to the attachments, unless it is already there.
 *
 * @param attached The current attachments.
 * @param choice   The pick.
 * @returns The attachments with it, in pick order.
 */
export function withAttachment(attached: MentionChoice[], choice: MentionChoice): MentionChoice[] {
  const key = attachmentKey(choice)
  return attached.some((item) => attachmentKey(item) === key) ? attached : [...attached, choice]
}

/**
 * Cut the `@query` being typed out of the draft: the pick becomes a chip, so
 * the text keeps only the reader's own words.
 *
 * @param text   The draft.
 * @param active The mention being typed.
 * @returns The draft without it, and where the caret goes.
 */
export function withoutMention(
  text: string,
  active: ActiveMention,
): { text: string; caret: number } {
  const before = text.slice(0, active.start)
  // One space where the mention was, not two.
  const after = text.slice(active.end).replace(/^ +/, before.endsWith(' ') || !before ? '' : ' ')
  return { text: before + after, caret: before.length }
}

/**
 * The message as sent: the attachments' leading line, then the question.
 *
 * @param attached The attachments.
 * @param question The reader's own words (may be empty).
 * @returns The full message text.
 */
export function attachedMessage(attached: MentionChoice[], question: string): string {
  if (attached.length === 0) return question
  const line = ATTACHED + attached.map((choice) => mentionText(choice)).join(SEPARATOR)
  return question ? `${line}\n\n${question}` : line
}

/** One attachment read back off a sent message, for its chip. */
export interface ReadAttachment {
  kind: 'paper' | 'thread'
  title: string
}

/**
 * Read a sent message's attachments back off its leading line.
 *
 * @param text The message as sent.
 * @returns The attachments (empty when there is no such line) and the rest.
 */
export function splitAttached(text: string): { attached: ReadAttachment[]; body: string } {
  if (!text.startsWith(ATTACHED)) return { attached: [], body: text }
  const end = text.indexOf('\n')
  const line = text.slice(ATTACHED.length, end === -1 ? undefined : end)
  const attached = line
    .split(SEPARATOR)
    .filter((token) => token.startsWith('@'))
    .map((token): ReadAttachment => {
      const thread = /^@thread\[(.*)\]$/.exec(token)
      return thread
        ? { kind: 'thread', title: thread[1] }
        : { kind: 'paper', title: token.slice(1) }
    })
  if (attached.length === 0) return { attached: [], body: text }
  return { attached, body: end === -1 ? '' : text.slice(end).trim() }
}

/**
 * A sent message with its words replaced, its attachments kept: what an
 * edited question resends (the bubble edits only the reader's own words,
 * as it shows only those).
 *
 * @param text The message as sent.
 * @param body The edited words.
 * @returns The message to send again.
 */
export function withBody(text: string, body: string): string {
  const end = text.indexOf('\n')
  if (splitAttached(text).attached.length === 0) return body
  const line = end === -1 ? text : text.slice(0, end)
  return body ? `${line}\n\n${body}` : line
}
