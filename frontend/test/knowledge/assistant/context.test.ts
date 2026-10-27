/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The course as its assistant reads it (v8.25.0) — order, links, check-offs, lessons.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { describe, expect, it } from 'vitest'
import { courseContext } from '../../../src/knowledge/assistant/context'
import {
  createMap,
  withChildren,
  withSynthesis,
  type KnowledgeMap,
} from '../../../src/knowledge/model'

/** Playing Atari → (Q-learning → MDPs, Experience replay), MDPs known, two lessons.
 * @returns The course.
 */
function course(): KnowledgeMap {
  let map = createMap({ id: 'dqn', title: 'Playing Atari' })
  map = withChildren(map, 'playing atari', [
    { name: 'Q-learning', why: 'DQN learns Q.' },
    { name: 'Experience replay', why: 'Stability.' },
  ])
  map = withChildren(map, 'q learning', [{ name: 'MDPs', why: 'The setting.' }])
  map = withSynthesis(map, {
    name: 'Value learning',
    why: 'Together.',
    members: ['q learning', 'experience replay'],
    toward: 'playing atari',
  })
  map = {
    ...map,
    known: ['mdps'],
    openId: 'q learning',
    nodes: {
      ...map.nodes,
      'q learning': { ...map.nodes['q learning'], lesson: 'Q learns.\n\n<<FIG 1>>\n\nMore.' },
      mdps: { ...map.nodes.mdps, lesson: 'An MDP is a model.' },
    },
  }
  return map
}

describe('courseContext', () => {
  it('lists the paper first, then the course in teaching order, with links and check-offs', () => {
    const context = courseContext(course())
    expect(context.paper).toBe('Playing Atari')
    expect(context.open).toBe('Q-learning')
    expect(context.items[0]).toMatchObject({
      title: 'Playing Atari',
      kind: 'paper',
      needs: [
        { title: 'Q-learning', why: 'DQN learns Q.' },
        { title: 'Experience replay', why: 'Stability.' },
      ],
    })
    expect(context.items.map((item) => item.title)).toEqual([
      'Playing Atari',
      'MDPs',
      'Q-learning',
      'Experience replay',
      'Value learning',
    ])
    expect(context.items.find((item) => item.title === 'MDPs')?.known).toBe(true)
    expect(context.items.find((item) => item.title === 'Value learning')).toMatchObject({
      kind: 'synthesis',
      members: ['Q-learning', 'Experience replay'],
      toward: 'Playing Atari',
    })
  })
  it('carries every lesson written, without its image markers', () => {
    const lessons = courseContext(course()).items.filter((item) => item.lesson)
    expect(lessons.map((item) => [item.title, item.lesson])).toEqual([
      ['MDPs', 'An MDP is a model.'],
      ['Q-learning', 'Q learns.\n\nMore.'],
    ])
  })
})
