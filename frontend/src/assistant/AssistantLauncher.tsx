/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The floating 🎓 that opens the assistant while it is closed (v9.0.0, the
 * OnePager's "One assistant", stage 3): one button over every view, where
 * each tool used to keep a 🎓 of its own. It sits in the top-right corner,
 * where those were, clear of the find bars the views keep at the bottom
 * right. It was draggable, with its spot remembered and a ↺ to put it back,
 * for one round of testing; Patrick preferred it staying put.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

/**
 * Render the floating launcher.
 *
 * @param props Component props.
 * @param props.onOpen Open the assistant.
 * @returns The button.
 */
export default function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="assistant-launcher"
      data-tour="assistant-btn"
      onClick={onOpen}
      title="The assistant — ask about what's on screen"
      aria-label="Open the assistant"
    >
      🎓
    </button>
  )
}
