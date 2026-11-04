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

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AssistantLauncher from '../../src/assistant/AssistantLauncher'
import { BOB_REST_MS, framePosition } from '../../src/assistant/launcherFrames'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  // jsdom has no pointer capture; the drag only needs the call to land.
  HTMLElement.prototype.setPointerCapture = () => {}
})

it('opens the assistant on a click', () => {
  const onOpen = vi.fn()
  render(<AssistantLauncher onOpen={onOpen} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open Nova' }))
  expect(onOpen).toHaveBeenCalledOnce()
})

it('moves while the pointer is over it, comes back to rest after leaving, and stills on a click', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  try {
    const { container } = render(<AssistantLauncher onOpen={() => {}} />)
    const button = screen.getByRole('button', { name: 'Open Nova' })
    const still = () => container.querySelector('img')?.getAttribute('src')
    const sprite = () => container.querySelector<HTMLElement>('.assistant-launcher-sprite')
    expect(still()).toBe('/astronaut-still.png')
    fireEvent.pointerEnter(button)
    act(() => vi.advanceTimersByTime(300))
    expect(sprite()?.style.backgroundImage).toContain('/astronaut-frames.webp')
    // Long past the turn in, he is still going.
    act(() => vi.advanceTimersByTime(5000))
    expect(sprite()).not.toBeNull()
    // Hovered, he holds the rest between bobs, then rises again — caught on
    // the rest's first frame, not part way through one.
    const resting = framePosition(62)
    const until = (done: () => boolean) => {
      for (let elapsed = 0; elapsed < 6000 && !done(); elapsed += 16)
        act(() => vi.advanceTimersByTime(16))
    }
    until(() => sprite()?.style.backgroundPosition !== resting)
    until(() => sprite()?.style.backgroundPosition === resting)
    expect(sprite()?.style.backgroundPosition).toBe(resting)
    act(() => vi.advanceTimersByTime(BOB_REST_MS / 2))
    expect(sprite()?.style.backgroundPosition).toBe(resting)
    act(() => vi.advanceTimersByTime(BOB_REST_MS))
    expect(sprite()?.style.backgroundPosition).not.toBe(resting)
    // Let go, he finishes the bob and turns back to rest.
    fireEvent.pointerLeave(button)
    act(() => vi.advanceTimersByTime(3000))
    expect(sprite()).toBeNull()
    expect(still()).toBe('/astronaut-still.png')
    // A click stills him at once.
    fireEvent.pointerEnter(button)
    act(() => vi.advanceTimersByTime(300))
    fireEvent.click(button)
    expect(sprite()).toBeNull()
  } finally {
    vi.useRealTimers()
  }
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
  return { button: screen.getByRole('button', { name: 'Open Nova' }), wrap }
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
  fireEvent.click(screen.getByRole('button', { name: 'Put Nova back in the corner' }))
  expect(wrap.style.top).toBe('')
  expect(localStorage.getItem('ca.launcherSpot')).toBeNull()
})
