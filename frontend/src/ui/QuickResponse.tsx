/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * ⚡ Quick response: the quiet link that stops work still searching and asks
 * for the model's own take, now. Born on the lesson's step line (v8.24.0),
 * where it skips the image search; shared since v8.30.0 with every chat bar's
 * working answer, where it skips the researcher's tools. One link, so the
 * offer reads the same wherever it appears: an outline bolt that lights up
 * on hover (`--bolt`: the title's blue in dark, the gold accent in light).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import './quickResponse.css'

/**
 * Render the Quick response link.
 *
 * @param props Component props.
 * @param props.onClick Stop the work and ask for the quick response.
 * @param props.title What skipping costs here, for the tooltip.
 * @returns The link button.
 */
export default function QuickResponse({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="link-btn quick-response"
      onClick={(event) => {
        // In a chat bubble a click also re-lights the answer's papers; this
        // isn't that.
        event.stopPropagation()
        onClick()
      }}
      title={title}
    >
      <svg className="quick-bolt" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.5 2 5 13.5h6L9.5 22 19 9.5h-6.2L13.5 2Z" />
      </svg>
      Quick response
    </button>
  )
}
