/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader's assistant (v8.38.0): a docked chat beside the paper being
 * read, answering from the paper (the section in view whole, the rest as it
 * fits) through the researcher, which also reaches the library and the web,
 * not the literature. The panel is the shared `assistant/DockedAssistant`
 * (the Knowledge Graph's is the same one); this file gives it the Reader's
 * words and `askReader`. It writes to the thread's Reader chat
 * (`store/chats`, saved as `ThreadRecord.readerChat`).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import DockedAssistant from '../assistant/DockedAssistant'
import type { PassageQuote } from '../assistant/askAssistant'
import type { ThreadRecord } from '../store/explorations'
import { askReader, documentRef } from './askReader'

/**
 * Render the Reader's assistant.
 *
 * @param props Component props.
 * @param props.thread The paper thread being read.
 * @param props.collapsed Hidden, but kept mounted.
 * @param props.onClose Collapse the panel (its ✕).
 * @param props.quote A passage the Reader's Chat attached to the bar, with a
 *   `seq` that changes each time one is attached.
 * @param props.onQuoteClear Let go of the attached passage (its ✕, or sent).
 * @returns The docked panel.
 */
export default function ReaderAssistant({
  thread,
  collapsed,
  onClose,
  quote = null,
  onQuoteClear,
}: {
  thread: ThreadRecord
  collapsed: boolean
  onClose: () => void
  quote?: (PassageQuote & { seq: number }) | null
  onQuoteClear?: () => void
}) {
  return (
    <DockedAssistant
      thread={thread}
      tool="reader"
      available={!!documentRef(thread)}
      ask={askReader}
      collapsed={collapsed}
      onClose={onClose}
      quote={quote}
      onQuoteClear={onQuoteClear}
      copy={{
        title: 'Reader Assistant',
        hint:
          'Ask about the paper: what a passage means, where a symbol comes from, why a step ' +
          'follows. Highlight text and choose Explain or Simplify to ask about it here, or ' +
          'Chat to attach it and ask anything.',
        context: `Asking about ${thread.paper?.title ?? thread.title}, from the section you’re reading`,
        tip:
          'It reads the paper, starting with the section you’re in, and searches your library ' +
          'and the web only when a question reaches past the paper. Type @ to bring in another ' +
          'chat, such as this paper’s Knowledge Graph conversation.',
        placeholder: 'Ask about this paper, or @ another chat…',
        className: 'reader-assistant',
        widthKey: 'ca.readerAssistantWidth',
      }}
    />
  )
}
