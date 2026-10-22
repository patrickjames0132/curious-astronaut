/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * An answer's response timer (v8.33.0), at the top right of its block in the
 * transcript: a running clock while the answer is on its way, then
 * a dimmed clock and duration once it completes. Gives the reader a number for the
 * wait the "researcher is slow" ticket is about. Every chat's answers wear
 * one (`transcript/ChatMessage`), the Knowledge Graph Assistant's included.
 *
 * The times live on the turn (`ChatMsg.startedAt` / `respondedIn`, stamped by
 * `turnStarted` / `turnCompleted`), so a background answer keeps its clock
 * while the reader is in another thread, and a finished answer keeps its
 * time across a reload. An answer that failed or was stopped never
 * completes, so it shows no time; neither do turns from before the timer.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useState } from 'react'

/** Repaint once a second, matching the whole-second readout. */
const TICK_MS = 1000

/**
 * A duration as the timer shows it: whole elapsed seconds ("4s"), then
 * minutes and padded seconds ("1m 05s").
 *
 * @param ms The duration in milliseconds.
 * @returns The readout.
 */
export function formatDuration(ms: number): string {
  const whole = Math.floor(Math.max(0, ms) / 1000)
  if (whole < 60) return `${whole}s`
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
}

/**
 * A monochrome clock that inherits the timer's text color.
 * @returns A decorative clock; the readout supplies the accessible meaning.
 */
function ClockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

/**
 * Render one answer's timer.
 *
 * @param props Component props.
 * @param props.startedAt When the answer's turn started, while it runs.
 * @param props.respondedIn How long it took, once it completed.
 * @param props.running Whether this answer's agent is still running. A
 *   `startedAt` without it is a run that ended without completing (or one
 *   saved mid-answer), which has no time to show.
 * @returns The readout, or nothing.
 */
export default function ResponseTimer({
  startedAt,
  respondedIn,
  running,
}: {
  startedAt?: number
  respondedIn?: number
  running: boolean
}) {
  const ticking = running && startedAt !== undefined
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [ticking])

  if (ticking)
    return (
      <span
        className="response-timer running"
        title="How long this answer has been running"
        aria-label={`Time elapsed: ${formatDuration(now - startedAt)}`}
      >
        <ClockIcon />
        {formatDuration(now - startedAt)}
      </span>
    )
  if (respondedIn !== undefined)
    return (
      <span
        className="response-timer"
        title="How long this answer took"
        aria-label={`Responded in ${formatDuration(respondedIn)}`}
      >
        <ClockIcon />
        {formatDuration(respondedIn)}
      </span>
    )
  return null
}
