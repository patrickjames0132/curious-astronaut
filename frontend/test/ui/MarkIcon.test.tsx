// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The button marks are drawn icons, one per kind, hidden from screen readers
 * (the button's own label names what it does).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import MarkIcon from '../../src/ui/MarkIcon'

afterEach(cleanup)

describe('MarkIcon', () => {
  it('draws each mark as a hidden icon with its own strokes', () => {
    const paths = new Set<string>()
    for (const kind of ['plus', 'minus', 'check', 'cross'] as const) {
      const { container } = render(<MarkIcon kind={kind} />)
      const svg = container.querySelector('svg.mark-icon')!
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      paths.add(svg.querySelector('path')!.getAttribute('d')!)
      cleanup()
    }
    expect(paths.size).toBe(4)
  })
})
