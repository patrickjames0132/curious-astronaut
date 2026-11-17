/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The tools' busy registry: counted holds under prefixed keys.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, expect, it } from 'vitest'
import { forgetBusy, isBusy, markBusy, trackBusy } from '../../src/tools/busy'

afterEach(forgetBusy)

it('holds a key until every request under it has ended', () => {
  const first = markBusy('reviews:W1:')
  const second = markBusy('reviews:W1:')
  first()
  expect(isBusy('reviews:W1:')).toBe(true)
  // A release called twice counts once.
  first()
  expect(isBusy('reviews:W1:')).toBe(true)
  second()
  expect(isBusy('reviews:W1:')).toBe(false)
})

it('answers by prefix', () => {
  markBusy('knowledge:thread:node')
  expect(isBusy('knowledge:thread:')).toBe(true)
  expect(isBusy('knowledge:other:')).toBe(false)
})

it('lets go when a tracked request settles, either way', async () => {
  const done = trackBusy('a:', Promise.resolve(1))
  const failed = trackBusy('b:', Promise.reject(new Error('no')))
  expect(isBusy('a:') && isBusy('b:')).toBe(true)
  await done
  await failed.catch(() => {})
  expect(isBusy('a:') || isBusy('b:')).toBe(false)
})
