/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * An answer's response timer (v8.33.0), at the top right of its block in the
 * transcript: a running clock while the answer is on its way, then
 * "responded in: …" once it completes. Gives the reader a number for the
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

/** How often the running clock repaints, in ms: a tenth of a second shows. */
const TICK_MS = 100

/**
 * A duration as the timer shows it: tenths under a minute ("4.2s"), then
 * minutes and padded seconds ("1m 05s").
 *
 * @param ms The duration in milliseconds.
 * @returns The readout.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
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
      <span className="response-timer running" title="How long this answer has been running">
        {formatDuration(now - startedAt)}
      </span>
    )
  if (respondedIn !== undefined)
    return (
      <span className="response-timer" title="How long this answer took">
        responded in: {formatDuration(respondedIn)}
      </span>
    )
  return null
}
