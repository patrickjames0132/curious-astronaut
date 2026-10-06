/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * A section that opens and closes by animating its height to and from the
 * content's real size.
 *
 * `height: auto` can't be animated, so this uses the one-cell-grid technique:
 * the wrapper is `display: grid` and its single row is animated between `0fr`
 * and `1fr` — a fraction of the content's own height — while the inner cell
 * clips (`.fold-inner`, `min-height: 0`). The keyframes live in `index.css`
 * (`fold-open` / `fold-close`).
 *
 * **It only animates on a change.** A fold that mounts already open — a
 * restored transcript's traces, the controls panel on a fresh graph — just
 * appears; only the reader (or the app) flipping `open` plays the motion.
 * Otherwise every bubble in a restored conversation would unfold at once.
 *
 * **Two ways to be closed.** By default the content unmounts once the close
 * has played (through `ui/usePresence`). `keepMounted` keeps it in the tree
 * behind `hidden` instead, for content that is expensive to rebuild — a
 * lecture's beats hold their figures, so unfolding is instant rather than a
 * flash of re-fetched images.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useState } from 'react'
import type { AnimationEvent, ReactNode } from 'react'
import { usePresence } from './usePresence'

/**
 * A height-animated, collapsible section.
 *
 * @param open Whether the section is expanded.
 * @param keepMounted Keep the content mounted (behind `hidden`) while closed.
 * @param className Extra classes for the wrapper.
 * @param children The section's content.
 * @returns The section, or null when closed and not kept mounted.
 */
export default function Fold({
  open,
  keepMounted = false,
  className,
  children,
}: {
  open: boolean
  keepMounted?: boolean
  className?: string
  children: ReactNode
}) {
  const presence = usePresence(open)
  // Opening plays only on a change of `open`, never on first mount.
  const [wasOpen, setWasOpen] = useState(open)
  const [opening, setOpening] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    setOpening(open)
  }

  const onAnimationEnd = (event: AnimationEvent) => {
    presence.onAnimationEnd(event)
    if (opening && event.target === event.currentTarget) setOpening(false)
  }

  if (!presence.present && !keepMounted) return null
  const classes = [
    'fold',
    opening ? 'opening' : '',
    presence.closing ? 'closing' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classes} hidden={!presence.present} onAnimationEnd={onAnimationEnd}>
      <div className="fold-inner">{children}</div>
    </div>
  )
}
