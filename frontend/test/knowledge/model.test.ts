/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The knowledge graph's course rules — identity, shared prerequisites, loops, routes, and teaching order.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgeChild } from '../../src/api'
import {
  courseNames,
  courseOrder,
  createMap,
  isCurrentMap,
  nameKey,
  neededBy,
  needs,
  nextLesson,
  progress,
  routeWhy,
  tutorPath,
  withChildren,
  type KnowledgeMap,
} from '../../src/knowledge/model'

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
  map = withChildren(map, 'playing atari', [
    concept('Q-learning'),
    concept('Experience replay'),
    concept('Convolutional networks'),
  ])
  return withChildren(map, 'q learning', [concept('Bellman equations'), concept('MDPs')])
}

describe('identity', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(nameKey('  Bellman-Equations ')).toBe(nameKey('bellman equations'))
  })
  it('recognises only the current shape as a saved course', () => {
    expect(isCurrentMap(dqnCourse())).toBe(true)
    expect(isCurrentMap({ rootId: 'root', nodes: {} })).toBe(false)
    expect(isCurrentMap(undefined)).toBe(false)
  })
})

describe('withChildren', () => {
  it('adds a node per new prerequisite and an edge from what needs it', () => {
    const map = dqnCourse()
    expect(needs(map, 'q learning').map((edge) => edge.to)).toEqual(['bellman equations', 'mdps'])
    expect(map.nodes['q learning'].expanded).toBe(true)
    expect(map.nodes['q learning'].kind).toBe('concept')
    expect(map.nodes['playing atari'].kind).toBe('paper')
    expect(map.nodes.mdps.expanded).toBeUndefined()
  })
  it('a prerequisite already on the map gets another edge, not another node', () => {
    const map = withChildren(dqnCourse(), 'experience replay', [
      concept('mdps'),
      concept('Replay buffers'),
    ])
    expect(Object.keys(map.nodes).filter((id) => id === 'mdps')).toHaveLength(1)
    expect(neededBy(map, 'mdps').map((edge) => edge.from)).toEqual([
      'q learning',
      'experience replay',
    ])
    expect(courseNames(map).filter((name) => name === 'MDPs')).toHaveLength(1)
  })
  it('drops an edge that would close a loop', () => {
    // Bellman equations "needing" the paper or Q-learning would make the course circular.
    const map = withChildren(dqnCourse(), 'bellman equations', [
      concept('Playing Atari'),
      concept('Q-learning'),
      concept('Dynamic programming'),
    ])
    expect(needs(map, 'bellman equations').map((edge) => edge.to)).toEqual(['dynamic programming'])
  })
  it('never re-expands an item', () => {
    const map = dqnCourse()
    expect(withChildren(map, 'playing atari', [concept('Something new')])).toBe(map)
  })
})

describe('routes', () => {
  it('teaches an item for its shortest route from the paper', () => {
    const map = withChildren(dqnCourse(), 'mdps', [concept('Markov chains')])
    expect(tutorPath(map, 'markov chains')).toEqual([
      { title: 'Playing Atari', kind: 'paper' },
      { title: 'Q-learning', kind: 'concept' },
      { title: 'MDPs', kind: 'concept' },
    ])
    expect(routeWhy(map, 'markov chains')).toBe('needed: Markov chains')
    expect(tutorPath(map, 'playing atari')).toEqual([])
    expect(routeWhy(map, 'playing atari')).toBe('')
  })
})

describe('the course', () => {
  it('teaches prerequisites first, a shared one once, and the paper last', () => {
    const map = withChildren(dqnCourse(), 'experience replay', [concept('MDPs')])
    expect(courseOrder(map)).toEqual([
      'bellman equations',
      'mdps',
      'q learning',
      'experience replay',
      'convolutional networks',
      'playing atari',
    ])
  })
  it('knowing an item prunes what it needs', () => {
    const map = { ...dqnCourse(), known: ['q learning'] }
    expect(courseOrder(map)).toEqual([
      'q learning',
      'experience replay',
      'convolutional networks',
      'playing atari',
    ])
    expect(progress(map)).toEqual({ total: 4, left: 3 })
  })
  it('next lesson walks forward over checked items and wraps', () => {
    const map = { ...dqnCourse(), known: ['mdps'] }
    expect(nextLesson(map, null)).toBe('bellman equations')
    expect(nextLesson(map, 'bellman equations')).toBe('q learning')
    expect(nextLesson(map, 'playing atari')).toBe('bellman equations')
    expect(nextLesson({ ...map, known: courseOrder(map) }, 'playing atari')).toBeNull()
  })
})
