/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: A bold upward chevron shared by every chat composer's send button.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */

/** Render the send chevron; the containing button provides its accessible name.
 * @returns The decorative icon.
 */
export default function SendGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 15 7-7 7 7" />
    </svg>
  )
}
