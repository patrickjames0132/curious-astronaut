// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Fold: plays its open animation only when `open` changes (never on a mount
 * that starts open), unmounts its content once closed — or keeps it behind
 * `hidden` with `keepMounted` — and holds `.closing` through the exit where an
 * animation engine exists (stubbed into jsdom here, as in usePresence's test).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Fold from '../../src/ui/Fold'

/** The fold's wrapper, found through the content inside it. */
function wrapper(): HTMLElement {
  return screen.getByText('content').closest('.fold') as HTMLElement
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations
})

describe('Fold', () => {
  it('appears without animating when it mounts open', () => {
    render(<Fold open>content</Fold>)
    expect(wrapper().className).toBe('fold')
  })

  it('plays the open animation when it is opened', () => {
    const { rerender } = render(<Fold open={false}>content</Fold>)
    expect(screen.queryByText('content')).toBeNull()
    rerender(<Fold open>content</Fold>)
    expect(wrapper().classList.contains('opening')).toBe(true)
  })

  it('unmounts its content once closed', () => {
    const { rerender } = render(<Fold open>content</Fold>)
    rerender(<Fold open={false}>content</Fold>)
    expect(screen.queryByText('content')).toBeNull()
  })

  it('keeps its content mounted behind hidden with keepMounted', () => {
    const { rerender } = render(
      <Fold open keepMounted>
        content
      </Fold>,
    )
    rerender(
      <Fold open={false} keepMounted>
        content
      </Fold>,
    )
    expect(wrapper().hidden).toBe(true)
  })

  it('holds .closing through the exit where animations can play', () => {
    Object.defineProperty(Element.prototype, 'getAnimations', {
      value: () => [],
      configurable: true,
    })
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const { rerender } = render(<Fold open>content</Fold>)
    rerender(<Fold open={false}>content</Fold>)
    expect(wrapper().classList.contains('closing')).toBe(true)
  })

  it('passes its className through to the wrapper', () => {
    render(
      <Fold open className="ctrl-body">
        content
      </Fold>,
    )
    expect(wrapper().classList.contains('ctrl-body')).toBe(true)
  })
})
