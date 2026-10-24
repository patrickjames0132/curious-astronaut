// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The lightbox goes to the shell's figure layer (the middle area) when there is
 * one, and over the whole window when there isn't (v8.38.0).
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import Lightbox from '../../src/figures/Lightbox'
import { FigureLayerContext } from '../../src/figures/figureLayer'

afterEach(cleanup)

const FIGURE = { image: '/fig.png', caption: 'A caption.', title: null, label: 'Figure 2' }

it('portals into the figure layer, sized to it, when the shell provides one', () => {
  const layer = document.createElement('div')
  document.body.append(layer)
  const { container } = render(
    <FigureLayerContext.Provider value={layer}>
      <div className="docked-tool">
        <Lightbox figure={FIGURE} onClose={() => {}} />
      </div>
    </FigureLayerContext.Provider>,
  )
  const dialog = screen.getByRole('dialog', { name: 'Enlarged figure' })
  expect(layer.contains(dialog)).toBe(true)
  expect(container.contains(dialog)).toBe(false)
  expect(dialog.classList.contains('in-layer')).toBe(true)
  layer.remove()
})

it('covers the window where there is no layer', () => {
  const { container } = render(<Lightbox figure={FIGURE} onClose={() => {}} />)
  const dialog = screen.getByRole('dialog', { name: 'Enlarged figure' })
  expect(container.contains(dialog)).toBe(true)
  expect(dialog.classList.contains('in-layer')).toBe(false)
})
