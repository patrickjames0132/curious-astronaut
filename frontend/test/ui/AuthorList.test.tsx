// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: Compact author metadata with an accessible disclosure for the complete list.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AuthorList from '../../src/ui/AuthorList'

afterEach(cleanup)

it('shows short author lists without a disclosure', () => {
  render(<AuthorList authors="Alice, Bob" />)
  expect(screen.getByText('Alice, Bob')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

it('expands the full original list and collapses back to an ellipsis', () => {
  const authors = Array.from({ length: 40 }, (_, index) => `Author ${index}`).join(', ')
  render(<AuthorList authors={authors} />)
  const toggle = screen.getByRole('button', { name: 'Show all authors' })
  const text = document.getElementById(toggle.getAttribute('aria-controls')!)!
  expect(text.textContent!.length).toBeLessThanOrEqual(161)
  expect(text.textContent).toMatch(/…$/)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  expect(text.textContent).toBe(authors)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
  expect(text.textContent).toMatch(/…$/)
})

it('collapses when different authors arrive and handles text without separators', () => {
  const { rerender } = render(<AuthorList authors={'LongName'.repeat(40)} />)
  fireEvent.click(screen.getByRole('button'))
  rerender(<AuthorList authors={'OtherName'.repeat(40)} />)
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText(`${'OtherName'.repeat(40).slice(0, 160)}…`)).toBeTruthy()
})
