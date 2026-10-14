// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The camera chase after a layout switch: a fit every step from the start,
 * a restart that doesn't double up, `stop`, the time cap, and unmount.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  CHASE_MAX_MS,
  CHASE_STEP_MS,
  useCameraChase,
} from '../../../src/graph/hooks/useCameraChase'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/**
 * Mount the hook over a fake force-graph handle.
 *
 * @returns The hook's result, its unmount, and the handle's `zoomToFit` spy.
 */
function mount() {
  const zoomToFit = vi.fn()
  const fgRef = { current: { zoomToFit } }
  const view = renderHook(() => useCameraChase(fgRef))
  return { chase: view.result.current, unmount: view.unmount, zoomToFit }
}

describe('useCameraChase', () => {
  it('fits every step, each fit animated over one step', () => {
    const { chase, zoomToFit } = mount()
    chase.start()
    vi.advanceTimersByTime(CHASE_STEP_MS * 3)
    expect(zoomToFit).toHaveBeenCalledTimes(3)
    expect(zoomToFit).toHaveBeenCalledWith(CHASE_STEP_MS, 60)
  })

  it('a restart replaces the running chase rather than doubling it', () => {
    const { chase, zoomToFit } = mount()
    chase.start()
    chase.start()
    vi.advanceTimersByTime(CHASE_STEP_MS * 2)
    expect(zoomToFit).toHaveBeenCalledTimes(2)
  })

  it('stops on stop, at the time cap, and on unmount', () => {
    const first = mount()
    first.chase.start()
    vi.advanceTimersByTime(CHASE_STEP_MS)
    first.chase.stop()
    vi.advanceTimersByTime(CHASE_STEP_MS * 4)
    expect(first.zoomToFit).toHaveBeenCalledTimes(1)

    const capped = mount()
    capped.chase.start()
    vi.advanceTimersByTime(CHASE_MAX_MS * 3)
    expect(capped.zoomToFit).toHaveBeenCalledTimes(CHASE_MAX_MS / CHASE_STEP_MS)

    const unmounted = mount()
    unmounted.chase.start()
    unmounted.unmount()
    vi.advanceTimersByTime(CHASE_STEP_MS * 4)
    expect(unmounted.zoomToFit).not.toHaveBeenCalled()
  })
})
