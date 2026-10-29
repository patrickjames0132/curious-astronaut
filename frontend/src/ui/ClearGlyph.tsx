/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The bin glyph for deleting the docked chat (`assistant/DockChatPicker`). Drawn
 * in `currentColor`, so it takes the colour of whatever button wears it.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/**
 * Render the bin.
 *
 * @returns The inline glyph.
 */
export default function ClearGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.2 4.6h9.6M6.5 4.6V3.3a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8v1.3M4.8 4.6l.45 7.9a1.1 1.1 0 0 0 1.1 1h3.3a1.1 1.1 0 0 0 1.1-1l.45-7.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
