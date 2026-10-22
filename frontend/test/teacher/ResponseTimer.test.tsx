// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: An answer's response timer (v8.33.0) — a running clock while the answer is on its way, a dimmed clock once it completes, nothing for a run that ended without completing.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ResponseTimer, { formatDuration } from '../../src/teacher/ResponseTimer'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('reads whole elapsed seconds under a minute, then minutes and padded seconds', () => {
  expect(formatDuration(4230)).toBe('4s')
  expect(formatDuration(59_940)).toBe('59s')
  expect(formatDuration(59_999)).toBe('59s')
  expect(formatDuration(60_000)).toBe('1m 00s')
  expect(formatDuration(65_000)).toBe('1m 05s')
  expect(formatDuration(-5)).toBe('0s')
})

it('runs while the answer is on its way', () => {
  render(<ResponseTimer startedAt={0} running />)
  act(() => {
    vi.advanceTimersByTime(2300)
  })
  expect(screen.getByTitle('How long this answer has been running').textContent).toBe('2s')
})

it('says how long a completed answer took', () => {
  render(<ResponseTimer respondedIn={12_500} running={false} />)
  const timer = screen.getByTitle('How long this answer took')
  expect(timer.textContent).toBe('12s')
  expect(timer.getAttribute('aria-label')).toBe('Responded in 12s')
  expect(timer.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor')
  expect(timer.classList.contains('running')).toBe(false)
})

it('shows nothing for a run that ended without completing, or a turn from before it', () => {
  // A start with nothing running: stopped, failed, or saved mid-answer.
  const { container, rerender } = render(<ResponseTimer startedAt={0} running={false} />)
  expect(container.textContent).toBe('')
  rerender(<ResponseTimer running={false} />)
  expect(container.textContent).toBe('')
})
