// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The floating astronaut (v9.0.0): it opens the assistant, and floats only
 * while the pointer is over it.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AssistantLauncher from '../../src/assistant/AssistantLauncher'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  // jsdom has no pointer capture; the drag only needs the call to land.
  HTMLElement.prototype.setPointerCapture = () => {}
})

it('opens the assistant on a click', () => {
  const onOpen = vi.fn()
  render(<AssistantLauncher onOpen={onOpen} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open the assistant' }))
  expect(onOpen).toHaveBeenCalledOnce()
})

it('floats while the pointer is over it, and stills on leaving or a click', () => {
  const { container } = render(<AssistantLauncher onOpen={() => {}} />)
  const button = screen.getByRole('button', { name: 'Open the assistant' })
  const image = () => container.querySelector('img')?.getAttribute('src')
  expect(image()).toBe('/astronaut-still.png')
  fireEvent.pointerEnter(button)
  expect(image()).toBe('/astronaut.webp')
  fireEvent.pointerLeave(button)
  expect(image()).toBe('/astronaut-still.png')
  fireEvent.pointerEnter(button)
  fireEvent.click(button)
  expect(image()).toBe('/astronaut-still.png')
})

/**
 * Render the launcher on a 600×400 canvas, as the view's overlay layer holds it.
 *
 * @param onOpen Told when it opens.
 * @returns The astronaut's button and its wrapper.
 */
function onCanvas(onOpen: () => void = () => {}) {
  const { container } = render(
    <div className="canvas">
      <AssistantLauncher onOpen={onOpen} />
    </div>,
  )
  const canvas = container.querySelector('.canvas') as HTMLElement
  const wrap = container.querySelector('.assistant-launcher-wrap') as HTMLElement
  Object.defineProperty(wrap, 'offsetParent', { get: () => canvas })
  Object.defineProperty(wrap, 'offsetWidth', { get: () => 72 })
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400)
  wrap.getBoundingClientRect = () => new DOMRect(516, 10, 72, 72)
  return { button: screen.getByRole('button', { name: 'Open the assistant' }), wrap }
}

it('moves where it is dragged, remembers it, and doesn’t open', () => {
  const onOpen = vi.fn()
  const { button, wrap } = onCanvas(onOpen)
  fireEvent.pointerDown(button, { button: 0, clientX: 550, clientY: 40, pointerId: 1 })
  fireEvent.pointerMove(button, { clientX: 450, clientY: 140, pointerId: 1 })
  fireEvent.pointerUp(button, { pointerId: 1 })
  fireEvent.click(button)
  expect(onOpen).not.toHaveBeenCalled()
  expect(wrap.style.top).toContain('110px')
  expect(wrap.style.right).toContain('112px')
  expect(JSON.parse(localStorage.getItem('ca.launcherSpot') ?? 'null')).toEqual({
    top: 110,
    right: 112,
  })
  // The next click is a click again.
  fireEvent.click(button)
  expect(onOpen).toHaveBeenCalledOnce()
})

it('treats a press that barely moves as a click, and goes home on ↺', () => {
  localStorage.setItem('ca.launcherSpot', JSON.stringify({ top: 200, right: 300 }))
  const onOpen = vi.fn()
  const { button, wrap } = onCanvas(onOpen)
  expect(wrap.style.top).toContain('200px')
  fireEvent.pointerDown(button, { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(button, { clientX: 102, clientY: 101, pointerId: 1 })
  fireEvent.pointerUp(button, { pointerId: 1 })
  fireEvent.click(button)
  expect(onOpen).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Put the assistant back in the corner' }))
  expect(wrap.style.top).toBe('')
  expect(localStorage.getItem('ca.launcherSpot')).toBeNull()
})
