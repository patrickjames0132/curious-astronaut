// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * useSlide: when the list's order changes, each row that landed somewhere new
 * is animated from its old place to rest; an unchanged order, reduced motion,
 * or no animation engine (jsdom's default — stubbed in here to test the
 * rest) leaves the rows still. jsdom lays nothing out, so a row's
 * `offsetTop` is stubbed as its place in the list.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { useSlide } from '../../src/shell/useSlide'

/** Each row is this tall, so a row's offset is its index times it. */
const ROW = 30

/** A list of rows in the given order, sliding with the hook. */
function List({ order }: { order: string[] }) {
  const list = useRef<HTMLDivElement>(null)
  useSlide(list, order)
  return (
    <div ref={list}>
      {order.map((id) => (
        <div key={id} data-slide={id}>
          {id}
        </div>
      ))}
    </div>
  )
}

/** Where each animated row was drawn from, by its key. */
function slidesFrom(animate: ReturnType<typeof vi.fn>): Record<string, string> {
  return Object.fromEntries(
    animate.mock.contexts.map((row, index) => [
      (row as HTMLElement).dataset.slide,
      animate.mock.calls[index][0][0].transform,
    ]),
  )
}

describe('useSlide', () => {
  let animate: ReturnType<typeof vi.fn>
  let reduced = false
  beforeEach(() => {
    animate = vi.fn()
    reduced = false
    Element.prototype.animate = animate as unknown as Element['animate']
    window.matchMedia = ((query: string) => ({
      matches: reduced && query.includes('reduce'),
    })) as unknown as typeof window.matchMedia
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        return Array.from(this.parentElement?.children ?? []).indexOf(this) * ROW
      },
    })
  })
  afterEach(() => {
    cleanup()
    delete (Element.prototype as Partial<Element>).animate
    delete (HTMLElement.prototype as { offsetTop?: number }).offsetTop
  })

  it('slides a row lifted to the top, and the rows it passed down', () => {
    const { rerender } = render(<List order={['first', 'second', 'third']} />)
    expect(animate).not.toHaveBeenCalled()

    rerender(<List order={['third', 'first', 'second']} />)

    expect(slidesFrom(animate)).toEqual({
      third: `translateY(${2 * ROW}px)`,
      first: `translateY(${-ROW}px)`,
      second: `translateY(${-ROW}px)`,
    })
    expect(animate.mock.calls[0][0][1]).toEqual({ transform: 'translateY(0)' })
  })

  it('leaves the rows still when the order is unchanged', () => {
    const { rerender } = render(<List order={['first', 'second']} />)
    rerender(<List order={['first', 'second']} />)
    expect(animate).not.toHaveBeenCalled()
  })

  it('does not slide a row that is new to the list', () => {
    const { rerender } = render(<List order={['first']} />)
    rerender(<List order={['added', 'first']} />)
    expect(slidesFrom(animate)).toEqual({ first: `translateY(${-ROW}px)` })
  })

  it('skips the slide under reduced motion', () => {
    reduced = true
    const { rerender } = render(<List order={['first', 'second']} />)
    rerender(<List order={['second', 'first']} />)
    expect(animate).not.toHaveBeenCalled()
  })
})
