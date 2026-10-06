// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * usePresence: an element outlives its `open` flag exactly as long as its exit
 * animation — held mounted with `closing` set, unmounted by its own
 * `animationend` (not a child's), by the fallback timeout if that never comes,
 * and at once wherever no exit can play (reduced motion, or no animation
 * engine, which is jsdom's default and is stubbed in here to test the rest).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import type { AnimationEvent } from 'react'
import { usePresence } from '../../src/ui/usePresence'

/** An animationend as the hook sees it: whose animation ended, and whose
 *  handler is running. (Called directly — React's own animationend wiring
 *  depends on vendor-prefix detection that jsdom doesn't satisfy.) */
function animationEnd(target: object, currentTarget: object): AnimationEvent {
  return { target, currentTarget } as unknown as AnimationEvent
}

/** A popover driven by the hook, with a child that animates too. */
function Popover({ open }: { open: boolean }) {
  const presence = usePresence(open)
  if (!presence.present) return null
  return (
    <div
      data-testid="pop"
      className={presence.closing ? 'closing' : ''}
      onAnimationEnd={presence.onAnimationEnd}
    >
      <span data-testid="child">row</span>
    </div>
  )
}

/** Pretend the browser can animate (jsdom can't) and has no reduced-motion ask. */
function enableAnimations() {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    value: () => [],
    configurable: true,
  })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations
})

describe('usePresence', () => {
  it('unmounts at once where no animation engine exists (jsdom)', () => {
    const { rerender } = render(<Popover open />)
    rerender(<Popover open={false} />)
    expect(screen.queryByTestId('pop')).toBeNull()
  })

  it('holds a closing element until its own animationend', () => {
    enableAnimations()
    const { rerender } = render(<Popover open />)
    rerender(<Popover open={false} />)
    expect(screen.getByTestId('pop').className).toBe('closing')

    const { result, rerender: rerenderHook } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    })
    rerenderHook({ open: false })
    expect(result.current).toMatchObject({ present: true, closing: true })
    const element = {}
    // A child's animation finishing first must not cut the exit short.
    act(() => result.current.onAnimationEnd(animationEnd({}, element)))
    expect(result.current.present).toBe(true)
    act(() => result.current.onAnimationEnd(animationEnd(element, element)))
    expect(result.current).toMatchObject({ present: false, closing: false })
  })

  it('unmounts on the fallback timeout if animationend never comes', () => {
    enableAnimations()
    const { rerender } = render(<Popover open />)
    rerender(<Popover open={false} />)
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByTestId('pop')).toBeNull()
  })

  it('reopening mid-exit cancels the exit', () => {
    enableAnimations()
    const { rerender } = render(<Popover open />)
    rerender(<Popover open={false} />)
    rerender(<Popover open />)
    expect(screen.getByTestId('pop').className).toBe('')
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(screen.queryByTestId('pop')).not.toBeNull()
  })

  it('skips the exit under reduced motion', () => {
    enableAnimations()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { rerender } = render(<Popover open />)
    rerender(<Popover open={false} />)
    expect(screen.queryByTestId('pop')).toBeNull()
  })
})
