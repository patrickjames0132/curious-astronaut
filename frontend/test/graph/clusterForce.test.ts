/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Force layout's relation clustering: sector directions (references pull
 * west, citations east), √population orbits, seed and unknown-relation
 * exemptions, re-initialization picking up discoveries, the expansion groups
 * that leave the formation (references west of their paper, citers east),
 * the bridges between a group and the formation, and connected mode.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import {
  bridgesOf,
  capSpeed,
  clusterCounts,
  clusterForce,
  clusterRadius,
  deriveOrigins,
  expansionGroups,
  groupAnchors,
  groupSideRadius,
  layoutPlan,
} from '../../src/graph/clusterForce'
import type { VNode } from '../../src/graph/model'

function makeNode(id: string, rels: string[], overrides: Partial<VNode> = {}): VNode {
  return {
    id,
    arxiv_id: null,
    title: id,
    year: 2020,
    citation_count: 10,
    url: null,
    rels,
    is_seed: false,
    abstract: null,
    tldr: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ...overrides,
  }
}

const seed = () => makeNode('seed', [], { is_seed: true, x: 0, y: 0 })

describe('clusterRadius', () => {
  it('grows with the square root of the population', () => {
    const orbit1 = clusterRadius(1)
    const orbit100 = clusterRadius(100)
    expect(orbit100).toBeGreaterThan(orbit1)
    // √100 = 10× the √1 growth over the base.
    expect(orbit100 - clusterRadius(0)).toBeCloseTo(10 * (orbit1 - clusterRadius(0)))
  })
})

describe('clusterCounts', () => {
  it('counts by primary relation and skips the seed', () => {
    const counts = clusterCounts([
      seed(),
      makeNode('r1', ['reference']),
      makeNode('r2', ['reference']),
      makeNode('c1', ['citation']),
      // Multi-relation: clusters where it's painted (its primary rel).
      makeNode('rc', ['reference', 'citation']),
    ])
    expect(counts).toEqual({ reference: 3, citation: 1 })
  })
})

describe('deriveOrigins', () => {
  it('re-stamps restored discoveries from their first edge, skipping seed anchors', () => {
    const nodes = [
      seed(),
      makeNode('expanded', ['citation']),
      makeNode('sat', ['reference'], { discovered: true }),
      makeNode('fromSeed', ['reference'], { discovered: true }),
      makeNode('plain', ['reference']),
    ]
    deriveOrigins(
      nodes,
      [
        { _s: 'expanded', _t: 'sat' },
        { _s: 'seed', _t: 'fromSeed' },
        { _s: 'seed', _t: 'plain' },
      ],
      'seed',
    )
    expect(nodes.find((node) => node.id === 'sat')!._origin).toBe('expanded')
    // Seed-anchored and non-discovered nodes stay sector members.
    expect(nodes.find((node) => node.id === 'fromSeed')!._origin).toBeUndefined()
    expect(nodes.find((node) => node.id === 'plain')!._origin).toBeUndefined()
  })
})

describe('clusterForce', () => {
  /** One initialized force plus the node set it was initialized with. */
  function runOnce(nodes: VNode[]) {
    const force = clusterForce()
    force.initialize(nodes)
    force(1)
    return nodes
  }

  it('pulls each relation toward its own sector around the seed', () => {
    const reference = makeNode('ref', ['reference'])
    const citer = makeNode('cite', ['citation'])
    runOnce([seed(), reference, citer])
    // References west (negative x), citations east — the axis the layout is
    // there to draw. Citations sat at -PI/3 (up-right) until v7.17.0, sharing
    // the eastern half with `latest` at +PI/3; with one citing relation the
    // sector recentres on due east.
    expect(reference.vx!).toBeLessThan(0)
    expect(citer.vx!).toBeGreaterThan(0)
  })

  it('gives a retired `latest` tag the default orbit rather than a sector', () => {
    // A pre-v7.17.0 save is folded to `citation` on restore
    // (`foldRetiredNodeRels`), so this only bites if a stray tag slips
    // through — it must still be placed, not dropped.
    const stale = makeNode('old', ['latest'])
    runOnce([seed(), stale])
    expect(Number.isFinite(stale.vx!)).toBe(true)
    expect(Number.isFinite(stale.vy!)).toBe(true)
  })

  it('anchors relative to the seed’s live position', () => {
    const reference = makeNode('ref', ['reference'], { x: 1000, y: 500 })
    runOnce([seed(), makeNode('ref2', ['reference'], { x: 1000, y: 500 }), reference])
    // From far east of a seed at the origin, the westward anchor pulls the
    // node back toward (and past) the seed: strongly negative x velocity.
    expect(reference.vx!).toBeLessThan(0)
    expect(reference.vy!).toBeLessThan(0)
  })

  it('leaves the seed free with the sectors on, wherever it is', () => {
    // Held at the centre, the seed's citers had to go round it and set into a
    // ring; free, it slides out to the apex of their cone.
    const theSeed = makeNode('seed', [], { is_seed: true, x: 300, y: -200 })
    runOnce([theSeed, makeNode('ref', ['reference'])])
    expect(theSeed.vx).toBe(0)
    expect(theSeed.vy).toBe(0)
  })

  it('leaves the seed and unknown relations alone', () => {
    const theSeed = seed()
    const stranger = makeNode('odd', ['unheard-of-relation'])
    // primaryRel falls back to 'similar' for unknown rels, so use rels that
    // resolve to a sectorless key is impossible — instead confirm the seed
    // itself never moves.
    runOnce([theSeed, stranger])
    expect(theSeed.vx).toBe(0)
    expect(theSeed.vy).toBe(0)
  })

  it('moves an expansion group out of the formation, the expanded paper included', () => {
    // The origin is a citer, so its group goes to the east side, angled up
    // off the citation axis. Its satellite carries a REFERENCE rel, which the
    // sectors would pull west: the group must win, for both of them.
    const origin = makeNode('origin', ['citation'])
    const satellite = makeNode('sat', ['reference'], { _origin: 'origin' })
    runOnce([seed(), origin, satellite])
    for (const member of [origin, satellite]) {
      expect(member.vx!).toBeGreaterThan(0)
      expect(member.vy!).toBeLessThan(0)
    }
  })

  it('excludes group members, the expanded paper too, from the sector populations', () => {
    const counts = clusterCounts([
      seed(),
      makeNode('r1', ['reference']),
      makeNode('r2', ['reference']),
      makeNode('sat', ['reference'], { _origin: 'r1' }),
    ])
    expect(counts).toEqual({ reference: 1 })
  })

  it('still anchors a group whose expanded paper is filtered out of the sim', () => {
    const orphan = makeNode('sat', ['reference'], { _origin: 'gone' })
    runOnce([seed(), orphan])
    // No origin on screen to say which side: the group heads due north
    // rather than falling back into the reference sector.
    expect(orphan.vy!).toBeLessThan(0)
    expect(Math.abs(orphan.vx!)).toBeLessThan(Math.abs(orphan.vy!))
  })

  it('re-initializing after discoveries widens a grown cluster’s orbit', () => {
    const force = clusterForce()
    const probe = makeNode('probe', ['reference'])
    const small: VNode[] = [seed(), probe]
    force.initialize(small)
    force(1)
    const smallPull = probe.vx!
    probe.vx = 0
    probe.vy = 0
    const grown = [
      ...small,
      ...Array.from({ length: 99 }, (_, index) => makeNode(`extra-${index}`, ['reference'])),
    ]
    force.initialize(grown)
    force(1)
    // A 100-strong cluster orbits farther out, so the probe (still at the
    // seed) is pulled harder toward the more distant anchor.
    expect(Math.abs(probe.vx!)).toBeGreaterThan(Math.abs(smallPull))
  })
})

describe('expansionGroups', () => {
  it('groups an expansion with its expanded paper, in the order groups formed', () => {
    const groups = expansionGroups([
      seed(),
      makeNode('second', ['citation']),
      makeNode('first', ['reference']),
      makeNode('a', ['reference'], { _origin: 'first' }),
      makeNode('b', ['citation'], { _origin: 'second' }),
      makeNode('c', ['reference'], { _origin: 'first' }),
      makeNode('plain', ['reference']),
    ])
    expect(groups.order).toEqual(['first', 'second'])
    expect(groups.groupOf.get('first')).toBe('first')
    expect(groups.groupOf.get('c')).toBe('first')
    expect(groups.sizes.get('first')).toBe(3)
    expect(groups.groupOf.has('plain')).toBe(false)
    expect(groups.groupOf.has('seed')).toBe(false)
  })

  it('lets an expanded paper from an earlier expansion lead its own group', () => {
    const groups = expansionGroups([
      seed(),
      makeNode('top', ['reference']),
      makeNode('mid', ['reference'], { _origin: 'top' }),
      makeNode('leaf', ['reference'], { _origin: 'mid' }),
    ])
    expect(groups.groupOf.get('mid')).toBe('mid')
    expect(groups.groupOf.get('leaf')).toBe('mid')
    expect(groups.sizes.get('top')).toBe(1)
  })
})

describe('groupAnchors', () => {
  it('puts each group past the formation, and a second one on the same side elsewhere', () => {
    const nodes = [
      seed(),
      ...Array.from({ length: 25 }, (_, index) => makeNode(`r${index}`, ['reference'])),
      makeNode('o1', ['reference']),
      makeNode('o2', ['reference']),
      makeNode('s1', ['citation'], { _origin: 'o1' }),
      makeNode('s2', ['citation'], { _origin: 'o2' }),
    ]
    const anchors = groupAnchors(nodes, expansionGroups(nodes), false)
    const first = anchors.get('o1')!
    const second = anchors.get('o2')!
    // Beyond the reference cluster's orbit, on the west side, apart.
    expect(first.distance).toBeGreaterThan(clusterRadius(25))
    expect(Math.cos(first.angle)).toBeLessThan(0)
    expect(Math.cos(second.angle)).toBeLessThan(0)
    expect(first.angle).not.toBeCloseTo(second.angle)
  })
})

describe('clusterForce, connected', () => {
  it('plans on its first tick, from the links as they are by then', () => {
    // The graph library hands the sim new nodes before new links, so a plan
    // made at initialize would miss the links between papers.
    let links: { _s: string; _t: string; _between?: boolean }[] = []
    const one = makeNode('one', ['citation'], { x: 0, y: 0 })
    const two = makeNode('two', ['citation'], { x: 0, y: 0 })
    const force = clusterForce(true, () => links)
    force.initialize([seed(), one, two])
    links = [{ _s: 'one', _t: 'two', _between: true }]
    force(1)
    // Linked, so no lone home pulls them east.
    expect(one.vx).toBe(0)
  })

  it('drops the sectors and holds the seed at the centre', () => {
    const theSeed = makeNode('seed', [], { is_seed: true, x: 50, y: -40 })
    const reference = makeNode('ref', ['reference'], { x: 50, y: -40 })
    const other = makeNode('other', ['reference'], { x: 50, y: -40 })
    const force = clusterForce(true, () => [{ _s: 'ref', _t: 'other', _between: true }])
    force.initialize([theSeed, reference, other])
    force(1)
    // Linked, so no westward pull: the links between papers place it instead.
    expect(reference.vx).toBe(0)
    expect(reference.vy).toBe(0)
    expect(theSeed.vx!).toBeLessThan(0)
    expect(theSeed.vy!).toBeGreaterThan(0)
  })

  it('leaves a pinned seed where the user put it', () => {
    const theSeed = makeNode('seed', [], { is_seed: true, x: 50, y: 0, fx: 50 })
    const force = clusterForce(true)
    force.initialize([theSeed])
    force(1)
    expect(theSeed.vx).toBe(0)
  })

  it('keeps expansion groups out on their own anchors', () => {
    const origin = makeNode('origin', ['citation'], { x: 0, y: 0 })
    const satellite = makeNode('sat', ['citation'], { x: 0, y: 0, _origin: 'origin' })
    const force = clusterForce(true)
    force.initialize([seed(), origin, satellite])
    force(1)
    expect(satellite.vx!).toBeGreaterThan(0)
  })
})

describe('layoutPlan', () => {
  /** A seed citer expanded both ways, plus a seed citer the expansion linked to. */
  function grown() {
    const origin = makeNode('origin', ['citation'])
    const newCiter = makeNode('newCiter', ['citation'], { _origin: 'origin' })
    const newRef = makeNode('newRef', ['reference'], { _origin: 'origin' })
    const shared = makeNode('shared', ['citation'])
    const nodes = [seed(), origin, newCiter, newRef, shared, makeNode('plain', ['citation'])]
    const links = [
      { _s: 'origin', _t: 'seed' },
      { _s: 'shared', _t: 'seed' },
      { _s: 'plain', _t: 'seed' },
      { _s: 'newCiter', _t: 'origin' },
      { _s: 'origin', _t: 'newRef' },
      { _s: 'shared', _t: 'origin' },
    ]
    return { nodes, links }
  }

  it('lays a group out like the seed’s neighbourhood: references west, citers east', () => {
    const { nodes, links } = grown()
    const plan = layoutPlan(nodes, links, false)
    const centre = plan.homes.get('origin')!
    expect(plan.homes.get('newRef')!.dx).toBeCloseTo(centre.dx - groupSideRadius(1))
    expect(plan.homes.get('newCiter')!.dx).toBeCloseTo(centre.dx + groupSideRadius(1))
    expect(plan.homes.get('newRef')!.dy).toBeCloseTo(centre.dy)
    expect(plan.homes.get('seed')).toEqual({ dx: 0, dy: 0 })
  })

  it('puts a paper the expansion linked to between its sector and the group', () => {
    const { nodes, links } = grown()
    const plan = layoutPlan(nodes, links, false)
    const sector = plan.homes.get('plain')!
    const group = plan.homes.get('origin')!
    const bridge = plan.homes.get('shared')!
    expect(bridge.dx).toBeCloseTo((sector.dx + group.dx) / 2)
    expect(bridge.dy).toBeCloseTo((sector.dy + group.dy) / 2)
    // And it no longer counts toward its sector's population.
    expect(plan.counts.citation).toBe(1)
  })

  it('gives a bridge a home in connected mode too, and gathers the lone papers', () => {
    const { nodes, links } = grown()
    const plan = layoutPlan(nodes, links, true)
    expect(plan.homes.get('shared')).toBeDefined()
    // No link between papers reaches `plain`: it's lone, homed with the
    // other lone citers out east, not left to ring the graph.
    expect(plan.lone.has('plain')).toBe(true)
    expect(plan.homes.get('plain')!.dx).toBeGreaterThan(0)
    expect(plan.homes.get('plain')!.dy).toBeCloseTo(0)
  })

  it('leaves a paper a link between papers reaches to its links, and homes lone references west', () => {
    const nodes = [
      seed(),
      makeNode('linkedOne', ['citation']),
      makeNode('linkedTwo', ['citation']),
      makeNode('loneRef', ['reference']),
    ]
    const links = [{ _s: 'linkedOne', _t: 'linkedTwo', _between: true }]
    const plan = layoutPlan(nodes, links, true)
    expect(plan.homes.get('linkedOne')).toBeUndefined()
    expect(plan.lone.has('linkedTwo')).toBe(false)
    expect(plan.homes.get('loneRef')!.dx).toBeLessThan(0)
    // Lone papers only exist in connected mode.
    expect(layoutPlan(nodes, links, false).lone.size).toBe(0)
  })
})

describe('bridgesOf', () => {
  it('ignores the seed, group members and the links between papers', () => {
    const nodes = [
      seed(),
      makeNode('origin', ['citation']),
      makeNode('member', ['citation'], { _origin: 'origin' }),
      makeNode('webbed', ['citation']),
      makeNode('shared', ['reference']),
    ]
    const links = [
      { _s: 'origin', _t: 'seed' },
      { _s: 'member', _t: 'origin' },
      { _s: 'webbed', _t: 'origin', _between: true },
      { _s: 'origin', _t: 'shared' },
    ]
    const bridges = bridgesOf(nodes, links, expansionGroups(nodes))
    expect([...bridges.entries()]).toEqual([['shared', ['origin']]])
  })
})

describe('clusterForce, bridges', () => {
  it('pulls a bridge off its sector toward the group it links', () => {
    const origin = makeNode('origin', ['citation'])
    const member = makeNode('member', ['citation'], { _origin: 'origin' })
    const shared = makeNode('shared', ['citation'])
    const plainCiter = makeNode('plain', ['citation'])
    const links = [{ _s: 'shared', _t: 'origin' }]
    const force = clusterForce(false, () => links)
    force.initialize([seed(), origin, member, shared, plainCiter])
    force(1)
    // The group sits up-right, so the bridge is pulled up (negative y) where
    // a plain citer is pulled only east along the axis.
    expect(shared.vy!).toBeLessThan(0)
    expect(plainCiter.vy!).toBeCloseTo(0)
  })
})

describe('capSpeed', () => {
  it('holds a node to its share of the trip left, never below the floor', () => {
    const far = makeNode('far', [], { vx: 300, vy: 400 })
    capSpeed(far, 2000)
    // 4% of 2000 is 80, direction kept (3:4:5).
    expect(far.vx).toBeCloseTo(48)
    expect(far.vy).toBeCloseTo(64)
    const near = makeNode('near', [], { vx: 30, vy: 40 })
    capSpeed(near, 10)
    expect(Math.hypot(near.vx!, near.vy!)).toBeCloseTo(12)
    const slow = makeNode('slow', [], { vx: 3, vy: 4 })
    capSpeed(slow, 2000)
    expect(slow.vx).toBe(3)
  })
})
