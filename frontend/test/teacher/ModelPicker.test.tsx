// @vitest-environment jsdom
/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The chat bar's model picker (v8.33.0) — lists the configured vendors' models under the Settings default, and a pick belongs to its conversation.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'
import ModelPicker from '../../src/teacher/ModelPicker'
import transcript from '../../src/store/transcript'

// What the modal's own dropdowns list: one vendor with models, one that
// couldn't be listed (and so offers nothing to pick).
vi.mock('../../src/api/settings', () => ({
  getSettings: vi.fn(() =>
    Promise.resolve({
      path: '/config.json',
      config: { llm: { agents: [{ id: 'researcher', model: 'anthropic:claude-opus-test' }] } },
    }),
  ),
  getAgentModels: vi.fn(() =>
    Promise.resolve({
      models: { anthropic: ['claude-opus-test', 'claude-haiku-test'], ollama: [] },
      vendors: ['anthropic', 'ollama'],
      known: ['anthropic', 'ollama'],
      tiers: {},
    }),
  ),
}))

afterEach(cleanup)

/** The picker over a fresh store, with its open state held like a bar's. */
function mount() {
  const store = configureStore({ reducer: { transcript } })
  const key = store.getState().transcript.activeKey
  function Bar() {
    const [open, setOpen] = useState(false)
    return <ModelPicker conversationKey={key} open={open} onOpenChange={setOpen} />
  }
  render(
    <Provider store={store}>
      <Bar />
    </Provider>,
  )
  return { store, key }
}

it('lists the Settings default first, then each listed vendor’s models', async () => {
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'Choose the model for this chat' }))
  expect(await screen.findByText('claude-haiku-test')).toBeTruthy()
  expect(screen.getByText(/· claude-opus-test/)).toBeTruthy()
  expect(
    (screen.getByRole('radio', { name: /Settings default/ }) as HTMLInputElement).checked,
  ).toBe(true)
  // A vendor with nothing listed gets no empty heading.
  expect(screen.queryByRole('group', { name: 'ollama' })).toBeNull()
})

it('a pick belongs to this chat, and the Settings default undoes it', async () => {
  const { store, key } = mount()
  const trigger = screen.getByRole('button', { name: 'Choose the model for this chat' })
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('radio', { name: 'claude-haiku-test' }))
  expect(store.getState().transcript.byKey[key].model).toBe('anthropic:claude-haiku-test')
  expect(trigger.getAttribute('title')).toContain('claude-haiku-test for this chat')
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('radio', { name: /Settings default/ }))
  expect(store.getState().transcript.byKey[key].model).toBeUndefined()
})

/**
 * Stub the boxes jsdom never lays out: the chip row the popover hangs from
 * (its top and bottom in a 768px window), the popover 28px under it with
 * 140px of head around a list whose models would run 600px.
 *
 * @param bar The chip row's top and bottom.
 * @returns Undo for every stub.
 */
function stubLayout(bar: { top: number; bottom: number }) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
  const isList = (element: HTMLElement) => element.classList.contains('model-pop-list')
  const isPop = (element: HTMLElement) => element.classList.contains('model-pop')
  const stubs = [
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(bar as DOMRect),
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.parentElement
    }),
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(28),
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return isPop(this) ? 400 : isList(this) ? 260 : 0
    }),
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return isList(this) ? 600 : 0
    }),
  ]
  return () => {
    for (const stub of stubs) stub.mockRestore()
  }
}

/** Open the picker and wait for its list. */
async function openList() {
  fireEvent.click(screen.getByRole('button', { name: 'Choose the model for this chat' }))
  await screen.findByText('claude-haiku-test')
  return {
    pop: document.querySelector<HTMLElement>('.model-pop'),
    list: document.querySelector<HTMLElement>('.model-pop-list'),
  }
}

it('drops down with its list cut to keep clear of the window edge', async () => {
  // Room below: 768 - 8 gap - (400 + 28) - 140 = 192.
  const undo = stubLayout({ top: 400, bottom: 420 })
  mount()
  const { list } = await openList()
  expect(list?.style.maxHeight).toBe('192px')
  undo()
})

it('keeps dropping down in a tight window, just with a smaller list', async () => {
  // Patrick's window left little under the landing bar: it never flips over
  // the question box, the list takes what room there is and scrolls in it.
  // Room below: 768 - 8 - (520 + 28) - 140 = 72.
  const undo = stubLayout({ top: 520, bottom: 540 })
  mount()
  const { pop, list } = await openList()
  expect(list?.style.maxHeight).toBe('72px')
  expect(pop?.style.bottom).toBe('')
  undo()
})
