// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The detail panel's summary section: TL;DR first when one exists, the
 * abstract otherwise (never opening on a ✦ tab, which would bill), the ✦
 * variant generating on the FIRST toggle only (the one surface allowed to
 * bill), pending/error states, and no tabs when a paper has only one text.
 * Exercised through DetailPanel so the wiring from props is covered too.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import DetailPanel from '../../src/detail/DetailPanel'
import type { DetailPanelProps } from '../../src/detail/DetailPanel'
import type { VNode } from '../../src/graph/model'

function makeNode(overrides: Partial<VNode> = {}): VNode {
  return {
    id: 'W123',
    arxiv_id: null,
    title: 'Playing Atari with Deep RL',
    year: 2013,
    citation_count: 100,
    url: null,
    rels: ['citation'],
    is_seed: false,
    abstract: 'We present a deep reinforcement learning approach.',
    tldr: null,
    ...overrides,
  }
}

function makeProps(overrides: Partial<DetailPanelProps> = {}): DetailPanelProps {
  return {
    node: makeNode(),
    fieldsLabel: 'OpenAlex tags',
    onEnlarge: () => {},
    isPinned: false,
    onTogglePin: () => {},
    onClose: () => {},
    onExplore: () => {},
    ...overrides,
  }
}

afterEach(cleanup)

describe('the summary section', () => {
  it('opens on the TL;DR when one exists, with the abstract a click away', () => {
    render(<DetailPanel {...makeProps({ node: makeNode({ tldr: 'A native S2 TLDR.' }) })} />)
    expect(screen.getByText('A native S2 TLDR.')).toBeTruthy()
    expect(screen.queryByText('We present a deep reinforcement learning approach.')).toBeNull()
    fireEvent.click(screen.getByText('Abstract'))
    expect(screen.getByText('We present a deep reinforcement learning approach.')).toBeTruthy()
  })

  it('puts the TL;DR tab before the Abstract tab', () => {
    render(<DetailPanel {...makeProps({ node: makeNode({ tldr: 'A native S2 TLDR.' }) })} />)
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels.indexOf('TL;DR')).toBeLessThan(labels.indexOf('Abstract'))
  })

  it('opens on the abstract — without generating — when the TL;DR would cost a call', () => {
    const onGenerateTldr = vi.fn(() => Promise.resolve())
    render(<DetailPanel {...makeProps({ onGenerateTldr })} />)
    expect(screen.getByText('We present a deep reinforcement learning approach.')).toBeTruthy()
    expect(screen.getByText('TL;DR ✦')).toBeTruthy()
    expect(onGenerateTldr).not.toHaveBeenCalled()
  })

  it('a TL;DR arriving with hydration takes over the default view', () => {
    const { rerender } = render(<DetailPanel {...makeProps()} />)
    expect(screen.getByText('We present a deep reinforcement learning approach.')).toBeTruthy()
    rerender(<DetailPanel {...makeProps({ node: makeNode({ tldr: 'Hydrated TLDR.' }) })} />)
    expect(screen.getByText('Hydrated TLDR.')).toBeTruthy()
  })

  it("keeps the reader's pick when the node updates", () => {
    const node = makeNode({ tldr: 'A native S2 TLDR.' })
    const { rerender } = render(<DetailPanel {...makeProps({ node })} />)
    fireEvent.click(screen.getByText('Abstract'))
    rerender(<DetailPanel {...makeProps({ node: { ...node, citation_count: 101 } })} />)
    expect(screen.getByText('We present a deep reinforcement learning approach.')).toBeTruthy()
  })

  it('shows no tabs when only the abstract exists and generation is unavailable', () => {
    render(<DetailPanel {...makeProps()} />)
    expect(screen.getByText('Abstract')).toBeTruthy()
    expect(screen.queryByText(/TL;DR/)).toBeNull()
  })

  it('the ✦ tab generates on first toggle only, showing pending then the result', async () => {
    let resolveGeneration: () => void = () => {}
    const onGenerateTldr = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveGeneration = resolve
        }),
    )
    const { rerender } = render(<DetailPanel {...makeProps({ onGenerateTldr })} />)
    fireEvent.click(screen.getByText('TL;DR ✦'))
    expect(onGenerateTldr).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Summarizing…')).toBeTruthy()
    resolveGeneration()
    // The generated text arrives as a prop change (mergeDetail upstream).
    rerender(
      <DetailPanel
        {...makeProps({ node: makeNode({ tldr: 'Generated TLDR.' }), onGenerateTldr })}
      />,
    )
    await waitFor(() => expect(screen.getByText('Generated TLDR.')).toBeTruthy())
    // Toggling away and back must NOT re-generate — the TL;DR is there now.
    fireEvent.click(screen.getByText('Abstract'))
    fireEvent.click(screen.getByText('TL;DR'))
    expect(onGenerateTldr).toHaveBeenCalledTimes(1)
  })

  it('a failed generation shows the error and keeps the abstract a click away', async () => {
    const onGenerateTldr = vi.fn(() => Promise.reject(new Error('Anthropic key missing')))
    render(<DetailPanel {...makeProps({ onGenerateTldr })} />)
    fireEvent.click(screen.getByText('TL;DR ✦'))
    await waitFor(() => expect(screen.getByText('Anthropic key missing')).toBeTruthy())
    fireEvent.click(screen.getByText('Abstract'))
    expect(screen.getByText('We present a deep reinforcement learning approach.')).toBeTruthy()
  })
})
