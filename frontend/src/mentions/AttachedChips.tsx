/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The `@` attachments as chips (v8.29.0): over a composer's bar, each with a
 * ✕, and on a sent message, read back off its `Attached:` line. A paper wears
 * 📄 and a chat 💬, so the two read apart at a glance. See `attachments.ts`.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import './mentions.css'

/** One chip. */
export interface Chip {
  key: string
  kind: 'paper' | 'thread'
  title: string
  /** Click the chip itself (a sent message's chat chip opens that chat). */
  onOpen?: () => void
}

/**
 * Render the chips.
 *
 * @param props Component props.
 * @param props.chips The chips, in order.
 * @param props.onRemove Let one go (the composer's ✕); absent on a sent message.
 * @returns The chip row, or nothing with no chips.
 */
export default function AttachedChips({
  chips,
  onRemove,
}: {
  chips: Chip[]
  onRemove?: (key: string) => void
}) {
  if (chips.length === 0) return null
  return (
    <div className="attached-chips" role="group" aria-label="Attached">
      {chips.map((chip) => {
        const icon = chip.kind === 'paper' ? '📄' : '💬'
        const what = chip.kind === 'paper' ? 'paper' : 'chat'
        return (
          <span key={chip.key} className={`attached-chip ${chip.kind}`} title={chip.title}>
            {chip.onOpen ? (
              <button
                type="button"
                className="attached-chip-open"
                onClick={(event) => {
                  event.stopPropagation()
                  chip.onOpen?.()
                }}
              >
                <span aria-hidden="true">{icon}</span>
                <span className="attached-chip-title">{chip.title}</span>
              </button>
            ) : (
              <>
                <span aria-hidden="true">{icon}</span>
                <span className="attached-chip-title">{chip.title}</span>
              </>
            )}
            {onRemove && (
              <button
                type="button"
                className="attached-chip-remove"
                onClick={() => onRemove(chip.key)}
                aria-label={`Remove the attached ${what} ${chip.title}`}
              >
                ✕
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}
