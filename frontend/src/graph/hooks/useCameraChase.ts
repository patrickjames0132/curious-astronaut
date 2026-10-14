/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The camera's chase after a layout switch (v8.21.0). The explorer's one-shot
 * fit waits for the sim to settle, a full 300-tick cool-down: about three
 * seconds of papers flying to their new places before the camera moved at
 * all. The chase follows them from the first frame instead, a short fit every
 * `CHASE_STEP_MS` until the sim stops (the caller's `stop` on engine stop) or
 * `CHASE_MAX_MS` passes, and the settle's own fit makes the last correction.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useCallback, useEffect, useRef } from 'react'

/** How often the camera re-fits while a layout settles, in ms; also each
 *  fit's animation, so the moves join into one glide. */
export const CHASE_STEP_MS = 250
/** The longest a chase runs before leaving the rest to the settle's fit. */
export const CHASE_MAX_MS = 2500

/** What {@link useCameraChase} hands the explorer. */
export interface CameraChase {
  /** Start (or restart) following the layout. */
  start: () => void
  /** Stop following; a no-op when no chase runs. */
  stop: () => void
}

/**
 * Chase the camera after the layout while a switch settles.
 *
 * @param fgRef The force-graph handle, whose `zoomToFit` frames the papers.
 * @returns `start` and `stop`; an unmount stops any chase still running.
 */
export function useCameraChase(fgRef: {
  current: { zoomToFit?: (ms: number, padding: number) => void } | null
}): CameraChase {
  const timer = useRef<number | null>(null)
  const stop = useCallback(() => {
    if (timer.current === null) return
    clearInterval(timer.current)
    timer.current = null
  }, [])
  const start = useCallback(() => {
    stop()
    const started = performance.now()
    timer.current = window.setInterval(() => {
      fgRef.current?.zoomToFit?.(CHASE_STEP_MS, 60)
      if (performance.now() - started >= CHASE_MAX_MS) stop()
    }, CHASE_STEP_MS)
  }, [fgRef, stop])
  useEffect(() => stop, [stop])
  return { start, stop }
}
