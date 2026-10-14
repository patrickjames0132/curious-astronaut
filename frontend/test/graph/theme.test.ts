/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The dimmed fill: a paper's own colour, faded, rather than a flat grey.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import { DIM_ALPHA, REL_COLOR, dimColor } from '../../src/graph/theme'

describe('dimColor', () => {
  it('keeps the colour and fades it to DIM_ALPHA', () => {
    expect(dimColor('#6ea8fe')).toBe(`rgba(110,168,254,${DIM_ALPHA})`)
    expect(dimColor('#000000')).toBe(`rgba(0,0,0,${DIM_ALPHA})`)
  })

  it('keeps references and citers apart when dimmed', () => {
    expect(dimColor(REL_COLOR.reference)).not.toBe(dimColor(REL_COLOR.citation))
  })
})
