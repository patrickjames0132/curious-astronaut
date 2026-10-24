// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: A typeset formula keeps its DOM across re-renders (v8.38.0), so a text selection
 * in it survives; only a change of its LaTeX rewrites it.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import MathText, { TeX } from '../../src/notation/MathText'

afterEach(cleanup)

it('keeps a formula’s nodes when its parent re-renders with the same LaTeX', () => {
  const { container, rerender } = render(
    <p data-render="1">
      <TeX latex="QK^{T}" display />
      <MathText>{'and $\\sqrt{d_k}$ too'}</MathText>
    </p>,
  )
  const [display, inline] = Array.from(container.querySelectorAll('.katex'))
  rerender(
    <p data-render="2">
      <TeX latex="QK^{T}" display />
      <MathText>{'and $\\sqrt{d_k}$ too'}</MathText>
    </p>,
  )
  const [displayAfter, inlineAfter] = Array.from(container.querySelectorAll('.katex'))
  expect(displayAfter).toBe(display)
  expect(inlineAfter).toBe(inline)
})

it('rewrites a formula whose LaTeX changed', () => {
  const { container, rerender } = render(<TeX latex="a+b" />)
  const before = container.querySelector('.katex')
  rerender(<TeX latex="a-b" />)
  expect(container.querySelector('.katex')).not.toBe(before)
  expect(container.querySelector('annotation')?.textContent).toBe('a-b')
})
