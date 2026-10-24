/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The pyramid view's rules — rows by height above the foundations, rows ordered under
 * what needs them, and what the reader's check-offs let the course skip.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgeChild } from '../../src/api'
import {
  createMap,
  nameKey,
  withChildren,
  withSynthesis,
  type KnowledgeMap,
} from '../../src/knowledge/model'
import {
  COLUMN_GAP,
  ROW_GAP,
  pyramidLayout,
  pyramidRows,
  skippedItems,
} from '../../src/knowledge/pyramid'

/** A concept child.
 * @param name Its name.
 * @returns The child.
 */
function concept(name: string): KnowledgeChild {
  return { name, why: `needed: ${name}` }
}

/** Playing Atari → Q-learning → (Bellman, MDPs); → Experience replay; → CNNs.
 * @returns The course.
 */
function dqnCourse(): KnowledgeMap {
  let map = createMap({ id: 'dqn', title: 'Playing Atari' })
  map = withChildren(map, map.rootId, [
    concept('Q-learning'),
    concept('Experience replay'),
    concept('Convolutional networks'),
  ])
  return withChildren(map, nameKey('Q-learning'), [concept('Bellman equations'), concept('MDPs')])
}

/** Check items off.
 * @param map The course.
 * @param names The items' names.
 * @returns The course with them known.
 */
function knowing(map: KnowledgeMap, ...names: string[]): KnowledgeMap {
  return { ...map, known: names.map(nameKey) }
}

describe('rows', () => {
  it('puts each item just under what needs it, and the paper on top', () => {
    const map = dqnCourse()
    const rows = pyramidRows(map)
    for (const name of ['Bellman equations', 'MDPs']) expect(rows.get(nameKey(name))).toBe(0)
    // Needing nothing, but needed only by the paper: raised to just under it.
    for (const name of ['Q-learning', 'Experience replay', 'Convolutional networks'])
      expect(rows.get(nameKey(name))).toBe(1)
    expect(rows.get(map.rootId)).toBe(2)
  })

  it('raises a leaf needed only high up, so its line doesn’t run through the row between', () => {
    // The browser case: MaxEnt RL needs MDPs (which needs a return) and
    // Shannon entropy, which needs nothing: entropy sat on the bottom row,
    // straight below MDPs' row, its line through whatever stood there.
    let map = createMap({ id: 'sac', title: 'Soft Actor-Critic' })
    map = withChildren(map, map.rootId, [concept('Maximum entropy RL')])
    map = withChildren(map, nameKey('Maximum entropy RL'), [concept('MDPs'), concept('Entropy')])
    map = withChildren(map, nameKey('MDPs'), [concept('Discounted return')])
    const rows = pyramidRows(map)
    expect(rows.get(nameKey('Discounted return'))).toBe(0)
    expect(rows.get(nameKey('MDPs'))).toBe(1)
    expect(rows.get(nameKey('Entropy'))).toBe(1)
    expect(rows.get(nameKey('Maximum entropy RL'))).toBe(2)
  })

  it('keeps a prerequisite needed both low and high under the lowest', () => {
    let map = createMap({ id: 'paper', title: 'Paper' })
    map = withChildren(map, map.rootId, [concept('Deep learning'), concept('Calculus')])
    map = withChildren(map, nameKey('Deep learning'), [concept('Backpropagation')])
    map = withChildren(map, nameKey('Backpropagation'), [concept('Calculus')])
    const rows = pyramidRows(map)
    expect(rows.get(nameKey('Calculus'))).toBe(0)
    expect(rows.get(nameKey('Backpropagation'))).toBe(1)
  })

  it('draws a shared prerequisite once, at the height of its own chain', () => {
    let map = createMap({ id: 'paper', title: 'Paper' })
    map = withChildren(map, map.rootId, [concept('Deep learning'), concept('Supervised learning')])
    map = withChildren(map, nameKey('Deep learning'), [concept('Calculus')])
    map = withChildren(map, nameKey('Supervised learning'), [concept('Calculus')])
    map = withChildren(map, nameKey('Calculus'), [concept('Limits')])
    const rows = pyramidRows(map)
    expect(rows.get(nameKey('Limits'))).toBe(0)
    expect(rows.get(nameKey('Calculus'))).toBe(1)
    expect(rows.get(nameKey('Deep learning'))).toBe(2)
    expect(rows.get(nameKey('Supervised learning'))).toBe(2)
    expect(rows.get(map.rootId)).toBe(3)
    expect(pyramidLayout(map).size).toBe(Object.keys(map.nodes).length)
  })

  it('sets a synthesis between what it combines and what it builds toward', () => {
    const map = withSynthesis(dqnCourse(), {
      name: 'Value backups',
      why: 'how they meet',
      members: [nameKey('Bellman equations'), nameKey('MDPs')],
      toward: nameKey('Q-learning'),
    })
    const rows = pyramidRows(map)
    const synthesis = Object.values(map.nodes).find((node) => node.kind === 'synthesis')!
    expect(rows.get(synthesis.id)).toBe(1)
    expect(rows.get(nameKey('Q-learning'))).toBe(2)
    expect(rows.get(map.rootId)).toBe(3)
  })
})

describe('layout', () => {
  it('centres the paper on top and each row under it, a column gap apart', () => {
    const map = dqnCourse()
    const spots = pyramidLayout(map)
    expect(spots.get(map.rootId)).toEqual({ x: 0, y: 0 })
    const middle = [...spots.values()].filter((spot) => spot.y === ROW_GAP)
    expect(middle).toHaveLength(3)
    const xs = middle.map((spot) => spot.x).sort((left, right) => left - right)
    expect(xs.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0)
    for (let index = 1; index < xs.length; index++)
      expect(xs[index] - xs[index - 1]).toBeCloseTo(COLUMN_GAP)
  })

  it('keeps each item’s prerequisites on its own side, so lines don’t cross', () => {
    let map = createMap({ id: 'paper', title: 'Paper' })
    map = withChildren(map, map.rootId, [concept('Left'), concept('Right')])
    // Named so that alphabetical order alone would interleave the two families.
    map = withChildren(map, nameKey('Left'), [concept('Alpha'), concept('Gamma')])
    map = withChildren(map, nameKey('Right'), [concept('Beta'), concept('Delta')])
    const spots = pyramidLayout(map)
    const xOf = (name: string) => spots.get(nameKey(name))!.x
    const left = [xOf('Alpha'), xOf('Gamma')]
    const right = [xOf('Beta'), xOf('Delta')]
    if (xOf('Left') < xOf('Right')) expect(Math.max(...left)).toBeLessThan(Math.min(...right))
    else expect(Math.max(...right)).toBeLessThan(Math.min(...left))
  })
})

describe('what the reader knows', () => {
  it('skips what sits under a known item, but not the known item itself', () => {
    const map = knowing(dqnCourse(), 'Q-learning')
    expect(skippedItems(map)).toEqual(new Set([nameKey('Bellman equations'), nameKey('MDPs')]))
  })

  it('still teaches a shared prerequisite that another route reaches', () => {
    let map = createMap({ id: 'paper', title: 'Paper' })
    map = withChildren(map, map.rootId, [concept('Deep learning'), concept('Supervised learning')])
    map = withChildren(map, nameKey('Deep learning'), [concept('Calculus')])
    map = withChildren(map, nameKey('Supervised learning'), [concept('Calculus')])
    expect(skippedItems(knowing(map, 'Deep learning')).size).toBe(0)
    expect(skippedItems(knowing(map, 'Deep learning', 'Supervised learning'))).toEqual(
      new Set([nameKey('Calculus')]),
    )
  })

  it('never moves an item when it is checked off', () => {
    const map = dqnCourse()
    expect(pyramidLayout(knowing(map, 'Q-learning'))).toEqual(pyramidLayout(map))
  })
})
