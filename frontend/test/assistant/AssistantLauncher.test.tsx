// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The floating 🎓 (v9.0.0): it opens the assistant, from where it stays.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import AssistantLauncher from '../../src/assistant/AssistantLauncher'

afterEach(cleanup)

it('opens the assistant on a click', () => {
  const onOpen = vi.fn()
  render(<AssistantLauncher onOpen={onOpen} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open the assistant' }))
  expect(onOpen).toHaveBeenCalledOnce()
})
