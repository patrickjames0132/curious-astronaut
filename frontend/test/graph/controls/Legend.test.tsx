// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The color legend never explains marks that aren't on screen: the four
 * relation entries are static, the two agent entries appear on first use.
 * (Similar was retired from the seed-graph build in v5.0.0 — no legend entry.)
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Legend from '../../../src/graph/controls/Legend'

describe('Legend', () => {
  it('always shows the three relation entries', () => {
    render(<Legend hasDiscovered={false} hasGhosts={false} />)
    for (const label of ['Seed', 'References', 'Citations']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('no longer splits citations into landmarks and latest (v7.17.0)', () => {
    render(<Legend hasDiscovered={false} hasGhosts={false} />)
    expect(screen.queryByText('Field Landmarks')).toBeNull()
    expect(screen.queryByText('Latest Publications')).toBeNull()
  })

  it('no longer shows a Similar entry (relation retired from the build)', () => {
    render(<Legend hasDiscovered={false} hasGhosts={false} />)
    expect(screen.queryByText('Similar')).toBeNull()
  })

  it('hides the discovered entry until an expansion has added papers', () => {
    render(<Legend hasDiscovered={false} hasGhosts={false} />)
    expect(screen.queryByText('Added by expanding')).toBeNull()
  })

  it('shows the discovered entry once its flag flips', () => {
    render(<Legend hasDiscovered={true} hasGhosts={false} />)
    expect(screen.getByText('Added by expanding')).toBeTruthy()
  })

  it('names the pink fill only once a paper has been expanded', () => {
    const { unmount } = render(<Legend hasDiscovered={true} hasGhosts={false} />)
    expect(screen.queryByText('Expanded')).toBeNull()
    unmount()
    render(<Legend hasDiscovered={true} hasExpanded={true} hasGhosts={false} />)
    expect(screen.getByText('Expanded')).toBeTruthy()
  })

  it('names the dotted ring only while a scoped paper is drawn past the filters', () => {
    const { unmount } = render(<Legend hasDiscovered={false} hasGhosts={false} />)
    expect(screen.queryByText(/hidden by your filters/)).toBeNull()
    unmount()
    render(<Legend hasDiscovered={false} hasGhosts={true} />)
    expect(screen.getByText('In scope, hidden by your filters')).toBeTruthy()
  })

  it('needs no entry for the links between papers, which wear the relation colours', () => {
    render(<Legend hasDiscovered={false} hasGhosts={false} />)
    expect(screen.queryByText('Cites (between papers)')).toBeNull()
  })

  // The legend lists what the graph can contain. A "Found by search" entry sat
  // here until v7.5.0, when the `search` and `similar` relations were removed
  // outright — an entry for a colour nothing can be is worse than no entry.
  it('no longer offers an entry for a retired relation', () => {
    render(<Legend hasDiscovered={true} hasGhosts={false} />)
    expect(screen.queryByText('Found by search')).toBeNull()
  })
})
