/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 * Description: The knowledge graph's course rules — identity, shared prerequisites, loops, routes, and teaching order.
 * Authors: Charles Patrick James <charles.patrick.james@gmail.com>
 */
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_COLOR, LABEL_ZOOM, labelled, nodeLook } from '../../src/knowledge/look'
import type { KnowledgeChild } from '../../src/api'
import {
  SYNTHESIS_PREFIX,
  courseNames,
  courseOrder,
  createMap,
  findItems,
  fitIsStale,
  joinLesson,
  splitLesson,
  conceptsOf,
  findSynthesis,
  redundancy,
  isCurrentMap,
  lessonText,
  nameKey,
  neededBy,
  needs,
  nextLesson,
  progress,
  routeWhy,
  synthesisLinks,
  synthesisTarget,
  tutorPath,
  type KnowledgeMap,
  withChildren,
  withSynthesis,
  missingChildren,
  withBreakdownAgain,
  withRestored,
  withoutItems,
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

describe('lessonText', () => {
  const ref = { node_id: 'ql', title: 'Q-learning', url: '', provider: 's2' as const }
  it('hides the resolved citation markers of a lesson saved before v8.17.0', () => {
    const node = {
      id: 'q',
      title: 'Q-learning',
      kind: 'concept' as const,
      lesson: 'Q-learning [1] learns values [1, 2] in [0, 1] and [9].',
      refs: { '1': ref, '2': ref },
    }
    // [0, 1] and [9] were never resolved citations, so they stay.
    expect(lessonText(node)).toBe('Q-learning learns values in [0, 1] and [9].')
  })
  it('leaves a lesson with no citations untouched', () => {
    const node = { id: 'q', title: 'Q', kind: 'concept' as const, lesson: 'In [0, 1].' }
    expect(lessonText(node)).toBe('In [0, 1].')
  })
})

describe('labelled', () => {
  const course = withChildren(createMap({ id: 'dqn', title: 'DQN' }), 'dqn', [
    { name: 'Q-learning', why: 'w' },
    { name: 'TD learning', why: 'w' },
  ])
  it('names every node past the citation graph’s zoom, and in 3D', () => {
    expect(labelled(course, 'td learning', null, false, LABEL_ZOOM + 0.1)).toBe(true)
    expect(labelled(course, 'td learning', null, false)).toBe(true)
  })
  it('zoomed out, keeps only the paper, the open, picked and hovered names', () => {
    const zoom = LABEL_ZOOM - 0.5
    expect(labelled(course, 'dqn', null, false, zoom)).toBe(true)
    expect(labelled(course, 'td learning', null, false, zoom)).toBe(false)
    expect(labelled(course, 'td learning', 'td learning', false, zoom)).toBe(true)
    expect(labelled(course, 'td learning', null, true, zoom)).toBe(true)
    expect(labelled({ ...course, openId: 'td learning' }, 'td learning', null, false, zoom)).toBe(
      true,
    )
  })
})

describe('findItems', () => {
  it('matches names case-insensitively, and runs no find on an empty box', () => {
    const map = dqnCourse()
    expect(findItems(map, '  ')).toBeNull()
    expect(findItems(map, 'LEARN')).toEqual(new Set(['q learning']))
    expect(findItems(map, 'tion')).toEqual(new Set(['bellman equations', 'convolutional networks']))
    expect(findItems(map, 'transformers')).toEqual(new Set())
  })
})

describe('syntheses', () => {
  const synthesize = (map: KnowledgeMap, members: string[]) =>
    withSynthesis(map, {
      name: 'Stable value learning',
      why: 'w',
      members,
      toward: synthesisTarget(map, members),
    })

  it('build toward the deepest item needing every member', () => {
    const map = dqnCourse()
    // Bellman and MDPs meet under Q-learning, not just the paper.
    expect(synthesisTarget(map, ['bellman equations', 'mdps'])).toBe('q learning')
    // Q-learning and experience replay only meet at the paper.
    expect(synthesisTarget(map, ['q learning', 'experience replay'])).toBe('playing atari')
  })

  it('are lessons in the plan: after what they combine, just before their target', () => {
    const map = dqnCourse()
    const synthesized = synthesize(map, ['q learning', 'experience replay'])
    const id = `${SYNTHESIS_PREFIX}stable value learning`
    expect(synthesized.nodes[id]).toMatchObject({ kind: 'synthesis', toward: 'playing atari' })
    const order = courseOrder(synthesized)
    expect(order.slice(-2)).toEqual([id, 'playing atari'])
    expect(order.indexOf(id)).toBeGreaterThan(order.indexOf('q learning'))
    expect(order.indexOf(id)).toBeGreaterThan(order.indexOf('experience replay'))
    expect(progress(synthesized)).toEqual({
      total: progress(map).total + 1,
      left: progress(map).left + 1,
    })
    expect(nextLesson(synthesized, 'convolutional networks')).toBe(id)
    // Never an edge, and never a name the tutor reuses for a concept.
    expect(courseNames(synthesized)).not.toContain('Stable value learning')
    expect(synthesized.edges).toEqual(map.edges)
    // One building toward a known item goes with what that item needs.
    const known = { ...synthesized, known: ['playing atari'] }
    expect(courseOrder(known)).toEqual(['playing atari'])
  })
  it('teach an inner synthesis before one holding it', () => {
    let map = synthesize(dqnCourse(), ['bellman equations', 'mdps'])
    const inner = `${SYNTHESIS_PREFIX}stable value learning`
    map = withSynthesis(map, {
      name: 'Whole picture',
      why: 'w',
      members: [inner, 'experience replay'],
      toward: 'playing atari',
    })
    const order = courseOrder(map)
    expect(order.indexOf(inner)).toBeLessThan(order.indexOf(`${SYNTHESIS_PREFIX}whole picture`))
    // The inner one builds toward Q-learning: it comes just before it.
    expect(order[order.indexOf('q learning') - 1]).toBe(inner)
  })

  it('draw a line to each member and one from their target', () => {
    const synthesized = synthesize(dqnCourse(), ['q learning', 'experience replay'])
    const id = `${SYNTHESIS_PREFIX}stable value learning`
    expect(synthesisLinks(synthesized)).toEqual([
      { from: id, to: 'q learning' },
      { from: id, to: 'experience replay' },
      { from: 'playing atari', to: id },
    ])
  })

  it('need two concepts or syntheses, and are found again by their members in any order', () => {
    const map = dqnCourse()
    // The paper is never a member.
    expect(synthesize(map, ['q learning', 'playing atari'])).toBe(map)
    const synthesized = synthesize(map, ['q learning', 'experience replay'])
    expect(findSynthesis(synthesized, ['experience replay', 'q learning'])).toBe(
      `${SYNTHESIS_PREFIX}stable value learning`,
    )
    expect(findSynthesis(synthesized, ['q learning', 'mdps'])).toBeNull()
  })

  it('build on each other: a synthesis can hold syntheses, and never itself', () => {
    const base = withSynthesis(dqnCourse(), {
      name: 'Value backups',
      why: 'w',
      members: ['bellman equations', 'mdps'],
      toward: 'q learning',
    })
    const inner = `${SYNTHESIS_PREFIX}value backups`
    // A synthesis plus a concept: its target comes from the concepts underneath.
    expect(conceptsOf(base, inner).sort()).toEqual(['bellman equations', 'mdps'])
    expect(synthesisTarget(base, [inner, 'experience replay'])).toBe('playing atari')
    const outer = withSynthesis(base, {
      name: 'Stable learning',
      why: 'w',
      members: [inner, 'experience replay'],
      toward: 'playing atari',
    })
    expect(outer.nodes[`${SYNTHESIS_PREFIX}stable learning`].members).toEqual([
      inner,
      'experience replay',
    ])
    // Re-using the inner synthesis's name for a group that holds the outer one
    // would put the inner inside itself: that member is dropped.
    const looped = withSynthesis(outer, {
      name: 'Value backups',
      why: 'w',
      members: [`${SYNTHESIS_PREFIX}stable learning`, 'mdps', 'convolutional networks'],
      toward: 'playing atari',
    })
    expect(looped.nodes[inner].members).toEqual(['mdps', 'convolutional networks'])
  })

  it('refuse a pick already inside another pick, however deep', () => {
    let map = withSynthesis(dqnCourse(), {
      name: 'Value backups',
      why: 'w',
      members: ['bellman equations', 'mdps'],
      toward: 'q learning',
    })
    map = withSynthesis(map, {
      name: 'Stable learning',
      why: 'w',
      members: [`${SYNTHESIS_PREFIX}value backups`, 'experience replay'],
      toward: 'playing atari',
    })
    const outer = `${SYNTHESIS_PREFIX}stable learning`
    expect(redundancy(map, [outer, 'mdps'])).toEqual({ outer, inner: 'mdps', how: 'includes' })
    expect(redundancy(map, [`${SYNTHESIS_PREFIX}value backups`, outer])).toEqual({
      outer,
      inner: `${SYNTHESIS_PREFIX}value backups`,
      how: 'includes',
    })
    expect(redundancy(map, [outer, 'convolutional networks'])).toBeNull()
  })

  it("refuse a pick another already builds on, through the course's own edges", () => {
    const map = dqnCourse()
    // Q-learning needs MDPs: a parent and its child.
    expect(redundancy(map, ['q learning', 'mdps'])).toEqual({
      outer: 'q learning',
      inner: 'mdps',
      how: 'needs',
    })
    // Through a synthesis too: one holding Q-learning builds on MDPs.
    const synthesized = withSynthesis(map, {
      name: 'Value learning',
      why: 'w',
      members: ['q learning', 'experience replay'],
      toward: 'playing atari',
    })
    expect(redundancy(synthesized, [`${SYNTHESIS_PREFIX}value learning`, 'mdps'])?.how).toBe(
      'needs',
    )
    // Siblings are fine, and so are syntheses that only share a concept.
    expect(redundancy(map, ['bellman equations', 'mdps'])).toBeNull()
    const second = withSynthesis(synthesized, {
      name: 'Replay and vision',
      why: 'w',
      members: ['experience replay', 'convolutional networks'],
      toward: 'playing atari',
    })
    expect(
      redundancy(second, [
        `${SYNTHESIS_PREFIX}value learning`,
        `${SYNTHESIS_PREFIX}replay and vision`,
      ]),
    ).toBeNull()
  })

  it('delete, taking any synthesis left with fewer than two parts along', () => {
    let map = withSynthesis(dqnCourse(), {
      name: 'Value backups',
      why: 'w',
      members: ['bellman equations', 'mdps'],
      toward: 'q learning',
    })
    map = withSynthesis(map, {
      name: 'Stable learning',
      why: 'w',
      members: [`${SYNTHESIS_PREFIX}value backups`, 'experience replay'],
      toward: 'playing atari',
    })
    map = withSynthesis(map, {
      name: 'Whole picture',
      why: 'w',
      members: [`${SYNTHESIS_PREFIX}value backups`, 'experience replay', 'convolutional networks'],
      toward: 'playing atari',
    })
    map = { ...map, openId: `${SYNTHESIS_PREFIX}stable learning` }
    const after = withoutItems(map, [`${SYNTHESIS_PREFIX}value backups`])
    // Left with one part: gone too, and its open panel with it.
    expect(after.nodes[`${SYNTHESIS_PREFIX}stable learning`]).toBeUndefined()
    expect(after.openId).toBeNull()
    // Left with two: kept, minus the deleted one.
    expect(after.nodes[`${SYNTHESIS_PREFIX}whole picture`].members).toEqual([
      'experience replay',
      'convolutional networks',
    ])
  })
})

describe('deleting and bringing back', () => {
  it('takes what only the deleted item needed, keeping a prerequisite shared elsewhere', () => {
    // MDPs is needed by both Q-learning and Experience replay.
    const map = withChildren(dqnCourse(), 'experience replay', [concept('MDPs')])
    const after = withoutItems({ ...map, known: ['bellman equations', 'mdps'] }, ['q learning'])
    expect(after.nodes['q learning']).toBeUndefined()
    expect(after.nodes['bellman equations']).toBeUndefined()
    expect(after.nodes.mdps).toBeDefined()
    expect(after.edges.some((edge) => edge.from === 'q learning' || edge.to === 'q learning')).toBe(
      false,
    )
    expect(after.known).toEqual(['mdps'])
  })
  it('never deletes the paper', () => {
    const map = dqnCourse()
    expect(withoutItems(map, [map.rootId])).toBe(map)
  })
  it('takes a synthesis left short, or one whose target went', () => {
    let map = withSynthesis(dqnCourse(), {
      name: 'Value backups',
      why: 'w',
      members: ['bellman equations', 'mdps'],
      toward: 'q learning',
    })
    map = withSynthesis(map, {
      name: 'Stable learning',
      why: 'w',
      members: ['experience replay', 'convolutional networks'],
      toward: 'playing atari',
    })
    const shorted = withoutItems(map, ['convolutional networks'])
    expect(shorted.nodes[`${SYNTHESIS_PREFIX}stable learning`]).toBeUndefined()
    expect(shorted.nodes[`${SYNTHESIS_PREFIX}value backups`]).toBeDefined()
    // Its target, Q-learning, goes (its members with it): so does it.
    const targetless = withoutItems(map, ['q learning'])
    expect(targetless.nodes[`${SYNTHESIS_PREFIX}value backups`]).toBeUndefined()
  })
  it('brings a deleted prerequisite back from the remembered breakdown', () => {
    const map = dqnCourse()
    const after = withoutItems(map, ['experience replay'])
    expect(missingChildren(after, 'playing atari')).toEqual([concept('Experience replay')])
    const restored = withRestored(after, 'playing atari')
    expect(restored.nodes['experience replay']).toMatchObject({ kind: 'concept' })
    expect(missingChildren(restored, 'playing atari')).toEqual([])
  })
  it('brings a concept back as it was: its lesson, check-off and own breakdown', () => {
    const map = dqnCourse()
    const read = {
      ...map,
      nodes: {
        ...map.nodes,
        'q learning': { ...map.nodes['q learning'], visited: true, lesson: 'Q.' },
      },
      known: ['q learning'],
    }
    const deleted = withoutItems(read, ['q learning'])
    expect(deleted.archive?.['q learning']).toMatchObject({ lesson: 'Q.', wasKnown: true })
    const back = withRestored(deleted, 'playing atari')
    expect(back.nodes['q learning']).toMatchObject({ visited: true, lesson: 'Q.', expanded: true })
    expect(back.known).toContain('q learning')
    expect(back.archive?.['q learning']).toBeUndefined()
    // Its own deleted breakdown can come back in turn, one level at a time.
    expect(back.nodes['bellman equations']).toBeUndefined()
    expect(missingChildren(back, 'q learning').map((child) => child.name)).toEqual([
      'Bellman equations',
      'MDPs',
    ])
    // Any breakdown naming a deleted concept revives it too.
    const named = withChildren(deleted, 'experience replay', [concept('Q-learning')])
    expect(named.nodes['q learning'].lesson).toBe('Q.')
  })
  it('remembers the breakdown of a course from before it was kept', () => {
    const map = dqnCourse()
    const legacy = {
      ...map,
      nodes: Object.fromEntries(
        Object.entries(map.nodes).map(([id, { breakdown: _dropped, ...node }]) => [id, node]),
      ),
    }
    const after = withoutItems(legacy, ['mdps'])
    expect(missingChildren(after, 'q learning').map((child) => child.name)).toEqual(['MDPs'])
  })
  it('a fresh breakdown replaces the old, check-offs surviving', () => {
    const map = { ...dqnCourse(), known: ['mdps'] }
    const again = withBreakdownAgain(map, 'q learning', [
      concept('mdps'),
      concept('Value iteration'),
    ])
    expect(needs(again, 'q learning').map((edge) => edge.to)).toEqual(['mdps', 'value iteration'])
    // Bellman equations was only the old breakdown's: gone. MDPs is kept, still known.
    expect(again.nodes['bellman equations']).toBeUndefined()
    expect(again.known).toEqual(['mdps'])
    expect(again.nodes['q learning'].breakdown).toEqual([
      concept('mdps'),
      concept('Value iteration'),
    ])
    expect(missingChildren(again, 'q learning')).toEqual([])
  })
  it('a fresh breakdown clears the whole lineage, keeping what the rest still needs', () => {
    let map = withChildren(dqnCourse(), 'mdps', [concept('Markov chains')])
    map = withChildren(map, 'bellman equations', [concept('Dynamic programming')])
    // Bellman equations is also needed outside Q-learning's branch.
    map = withChildren(map, 'experience replay', [concept('Bellman equations')])
    const again = withBreakdownAgain(map, 'q learning', [concept('MDPs')])
    // MDPs came back, but new: not broken down, its old child gone.
    expect(again.nodes.mdps.expanded).toBeUndefined()
    expect(again.nodes.mdps.freshLesson).toBe(true)
    expect(again.nodes['markov chains']).toBeUndefined()
    // Bellman equations is still needed by Experience replay: it stays, with its own.
    expect(again.nodes['bellman equations'].expanded).toBe(true)
    expect(again.nodes['dynamic programming']).toBeDefined()
    expect(needs(again, 'q learning').map((edge) => edge.to)).toEqual(['mdps'])
    // Not revived from the archive, which would bring the old state back.
    expect(again.archive?.mdps).toBeUndefined()
  })
  it('a fresh breakdown clears its lessons to be written afresh', () => {
    const map = dqnCourse()
    const read = {
      ...map,
      nodes: Object.fromEntries(
        Object.entries(map.nodes).map(([id, node]) => [id, { ...node, lesson: 'Old.' }]),
      ),
    }
    const again = withBreakdownAgain(read, 'q learning', [
      concept('mdps'),
      concept('Value iteration'),
    ])
    for (const id of ['q learning', 'mdps', 'value iteration']) {
      expect(again.nodes[id].lesson).toBeUndefined()
      expect(again.nodes[id].freshLesson).toBe(true)
    }
    // Lessons outside the redone breakdown are left alone.
    expect(again.nodes['experience replay'].lesson).toBe('Old.')
    // Waiting on a rewrite reads as new again, broken down or not; known stays green.
    expect(nodeLook(again, again.nodes['q learning']).color).toBe(KNOWLEDGE_COLOR.fresh)
    const known = { ...again, known: ['mdps'] }
    expect(nodeLook(known, known.nodes.mdps).color).toBe(KNOWLEDGE_COLOR.known)
  })
})

describe('a lesson\'s "How it fits in" section', () => {
  it('splits off at its heading, and joins back around a new one', () => {
    const text = 'Core idea.\n\n$$Q$$\n\n### How it fits in\n\nIt serves DQN.'
    expect(splitLesson(text)).toEqual({ body: 'Core idea.\n\n$$Q$$', fit: 'It serves DQN.' })
    // A model's drift in level or case still splits; no heading, no card.
    expect(splitLesson('A.\n## how it fits in\nB.').fit).toBe('B.')
    expect(splitLesson('Just a lesson.')).toEqual({ body: 'Just a lesson.', fit: null })
    expect(splitLesson(joinLesson('Core idea.', 'New.'))).toEqual({
      body: 'Core idea.',
      fit: 'New.',
    })
  })
  it('goes stale when what needs the item changes, and only then', () => {
    const map = dqnCourse()
    const lesson = joinLesson('Q.', 'For DQN.')
    const written = {
      ...map,
      nodes: {
        ...map.nodes,
        'q learning': { ...map.nodes['q learning'], lesson, fitFor: ['playing atari'] },
      },
    }
    expect(fitIsStale(written, 'q learning')).toBe(false)
    const shared = withChildren(written, 'experience replay', [concept('Q-learning')])
    expect(fitIsStale(shared, 'q learning')).toBe(true)
    // A lesson from before the section, or one that doesn't know what it was for, is left be.
    const legacy = {
      ...shared,
      nodes: {
        ...shared.nodes,
        'q learning': { ...shared.nodes['q learning'], fitFor: undefined },
      },
    }
    expect(fitIsStale(legacy, 'q learning')).toBe(false)
  })
})
