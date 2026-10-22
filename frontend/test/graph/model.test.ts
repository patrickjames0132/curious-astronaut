/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The graph view-model's pure helpers: date formatting, relation priority,
 * radius scaling, node persistence stripping, count rebuilding, and the
 * pasted-arXiv-id fast path.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { describe, expect, it } from 'vitest'
import type { GraphNode } from '../../src/api'
import {
  CITE_SLIDER_STEPS,
  ID_RE,
  betweenLinkType,
  citationThreshold,
  cleanNode,
  countRels,
  findMatches,
  edgeLit,
  edgeTypeFrom,
  focusAnchor,
  focusOf,
  foldRetiredEdgeTypes,
  foldRetiredNodeRels,
  formatPubDate,
  nodeFill,
  nodeRadius,
  primaryRel,
  type VLink,
} from '../../src/graph/model'
import type { VNode } from '../../src/graph/model'
import { EXPANDED_COLOR, REL_COLOR } from '../../src/graph/theme'

/** A minimal valid GraphNode; override per test. */
function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node01',
    arxiv_id: null,
    title: 'A Paper',
    year: 2017,
    citation_count: 0,
    url: null,
    rels: [],
    is_seed: false,
    ...overrides,
  }
}

describe('findMatches', () => {
  const NODES = [
    makeNode({ id: 'attn', title: 'Attention Is All You Need', authors: 'Vaswani, Shazeer' }),
    makeNode({ id: 'bert', title: 'BERT: Pre-training of Deep Bidirectional Transformers' }),
    makeNode({ id: 'gpt', title: 'Language Models are Few-Shot Learners', authors: 'Brown' }),
  ]

  it('matches case-insensitively on title and author substrings', () => {
    expect(findMatches(NODES, 'attention')).toEqual(new Set(['attn']))
    expect(findMatches(NODES, 'VASWANI')).toEqual(new Set(['attn']))
    expect(findMatches(NODES, 'transformers')).toEqual(new Set(['bert']))
  })

  it('an empty or whitespace query means no find at all (null, not empty)', () => {
    expect(findMatches(NODES, '')).toBeNull()
    expect(findMatches(NODES, '   ')).toBeNull()
  })

  it('a query with no hits returns an EMPTY set — dim everything, honestly', () => {
    expect(findMatches(NODES, 'quantum gravity')).toEqual(new Set())
  })

  it('a node without authors still matches by title', () => {
    expect(findMatches(NODES, 'few-shot')).toEqual(new Set(['gpt']))
  })
})

describe('formatPubDate', () => {
  it('renders a full date, parsed by hand (no timezone off-by-one)', () => {
    expect(formatPubDate('2017-06-12', 2017)).toBe('Jun 12, 2017')
  })

  it('degrades gracefully as data thins out', () => {
    expect(formatPubDate('2017-06', 2017)).toBe('Jun 2017')
    expect(formatPubDate(null, 2017)).toBe('2017')
    expect(formatPubDate(undefined, null)).toBe('—')
  })

  it('falls back to the year on a malformed date string', () => {
    expect(formatPubDate('June 2017', 2017)).toBe('2017')
  })

  it('returns the bare year for an out-of-range month', () => {
    expect(formatPubDate('2017-13-01', null)).toBe('2017')
  })
})

describe('primaryRel', () => {
  it('lets the seed flag win over everything', () => {
    expect(primaryRel(makeNode({ is_seed: true, rels: ['reference'] }))).toBe('seed')
  })

  it('picks the first graph relation in priority order', () => {
    expect(primaryRel(makeNode({ rels: ['citation', 'reference'] }))).toBe('reference')
  })

  // The function has to stay TOTAL: its result indexes REL_COLOR, so a
  // relation it has no case for would paint an undefined fill rather than
  // degrade. The two relations that used to have cases here — `search` and
  // `similar` — were removed in v7.3.0 and v7.5.0 and can no longer be
  // created, but a session saved before then still carries them.
  it('renders a retired relation as unknown rather than uncoloured', () => {
    expect(primaryRel(makeNode({ rels: ['search'] }))).toBe('unknown')
    expect(primaryRel(makeNode({ rels: ['similar'] }))).toBe('unknown')
  })

  it('falls back to unknown when a node has no relation at all', () => {
    expect(primaryRel(makeNode({ rels: [] }))).toBe('unknown')
  })
})

describe('nodeFill', () => {
  it('keeps a survey in its relation colour', () => {
    // The survey mark is an orange outline drawn by the canvas, so the fill
    // still says whether the survey is a reference or a citer.
    expect(nodeFill(makeNode({ rels: ['citation'], is_survey: true }), false)).toBe(
      REL_COLOR.citation,
    )
    expect(nodeFill(makeNode({ rels: ['reference'], is_survey: true }), false)).toBe(
      REL_COLOR.reference,
    )
  })

  it('fills the seed gold', () => {
    expect(nodeFill(makeNode({ is_seed: true, rels: ['seed'] }), false)).toBe(REL_COLOR.seed)
  })

  it('lets an expanded paper turn pink', () => {
    expect(nodeFill(makeNode({ rels: ['citation'] }), true)).toBe(EXPANDED_COLOR)
  })
})

describe('betweenLinkType', () => {
  const reference = makeNode({ id: 'ref', rels: ['reference'] })
  const citer = makeNode({ id: 'cite', rels: ['citation'] })

  it('takes the citing paper’s relation', () => {
    expect(betweenLinkType(citer, reference)).toBe('citation')
    expect(betweenLinkType(reference, reference)).toBe('reference')
  })

  it('falls back to the cited paper’s when the citing one has no colour of its own', () => {
    expect(betweenLinkType(makeNode({ is_seed: true }), citer)).toBe('citation')
    expect(betweenLinkType(makeNode({ rels: ['similar'] }), citer)).toBe('citation')
    expect(betweenLinkType(makeNode({ rels: [] }), makeNode({ rels: [] }))).toBe('reference')
  })
})

describe('nodeRadius', () => {
  it('draws the seed fixed-large regardless of citations', () => {
    expect(nodeRadius(makeNode({ is_seed: true, citation_count: 0 }))).toBe(10)
  })

  it('scales with the square root of citations', () => {
    expect(nodeRadius(makeNode({ citation_count: 0 }))).toBe(3)
    expect(nodeRadius(makeNode({ citation_count: 36 }))).toBe(4)
  })

  it('caps megahit papers so they cannot swallow the canvas', () => {
    expect(nodeRadius(makeNode({ citation_count: 1_000_000 }))).toBe(18)
  })
})

describe('citationThreshold', () => {
  it('anchors position 0 to the graph floor (not a hardcoded 0)', () => {
    expect(citationThreshold(0, 8, 5000)).toBe(8)
  })

  it('reaches exactly the ceiling at the top position', () => {
    expect(citationThreshold(CITE_SLIDER_STEPS, 8, 5000)).toBe(5000)
  })

  it('rises on a log scale — the midpoint sits far below the linear midpoint', () => {
    // expm1(mid of log1p(0)…log1p(5000)) ≈ 70, not 2500: most travel is low.
    expect(citationThreshold(CITE_SLIDER_STEPS / 2, 0, 5000)).toBe(70)
  })

  it('is monotonic across the slider', () => {
    let previous = -1
    for (let position = 0; position <= CITE_SLIDER_STEPS; position += 10) {
      const threshold = citationThreshold(position, 8, 5000)
      expect(threshold).toBeGreaterThanOrEqual(previous)
      previous = threshold
    }
  })

  it('collapses to the ceiling when the range is flat (nothing to filter)', () => {
    expect(citationThreshold(0, 42, 42)).toBe(42)
    expect(citationThreshold(CITE_SLIDER_STEPS, 42, 42)).toBe(42)
  })
})

describe('cleanNode', () => {
  it('strips sim positions and pins, keeping the persistable fields', () => {
    const live: VNode = { ...makeNode(), x: 12, y: 34, fx: 12, fy: 34 }
    const cleaned = cleanNode(live)
    expect(cleaned).not.toHaveProperty('x')
    expect(cleaned).not.toHaveProperty('fx')
    expect(cleaned.id).toBe('node01')
    expect(cleaned.title).toBe('A Paper')
  })
})

describe('countRels', () => {
  it('rebuilds per-relation counts from restored nodes', () => {
    const nodes = [
      makeNode({ rels: ['reference'] }),
      // A retired relation counts toward nothing and has no slot to count into.
      makeNode({ rels: ['citation', 'similar'] }),
      // A pre-v7.17.0 save's `latest` node counts as the citation it is.
      makeNode({ rels: ['latest'] }),
      makeNode({ is_seed: true, rels: [] }),
    ]
    expect(countRels(nodes)).toEqual({
      references: 1,
      citations: 2,
      nodes: 4,
    })
  })
})

describe('ID_RE — the pasted-id fast path', () => {
  it.each([
    ['1706.03762', '1706.03762'],
    ['1706.03762v5', '1706.03762v5'],
    ['https://arxiv.org/abs/1706.03762', '1706.03762'],
    ['https://arxiv.org/pdf/2304.01234v2', '2304.01234v2'],
    ['hep-th/9901001', 'hep-th/9901001'],
  ])('accepts %s', (input, id) => {
    const match = ID_RE.exec(input)
    expect(match?.[1]).toBe(id)
  })

  it.each(['attention is all you need', '1706', 'https://example.org/abs/1706.03762'])(
    'rejects %s (keyword search takes over)',
    (input) => {
      expect(ID_RE.test(input)).toBe(false)
    },
  )
})

describe('foldRetiredNodeRels / foldRetiredEdgeTypes', () => {
  it('folds a pre-v7.17.0 `latest` node into the citation relation', () => {
    // Not cosmetic: the filter chips are keyed by relation, so an unfolded
    // `latest` node belongs to no chip and is filtered off the canvas — a
    // saved exploration would come back missing its recent papers.
    const folded = foldRetiredNodeRels([makeNode({ rels: ['latest'] })])
    expect(folded[0].rels).toEqual(['citation'])
  })

  it('does not duplicate the tag when a node carried both', () => {
    const folded = foldRetiredNodeRels([makeNode({ rels: ['citation', 'latest'] })])
    expect(folded[0].rels).toEqual(['citation'])
  })

  it('leaves other relations, retired or current, exactly as they are', () => {
    // `similar` and `search` were removed outright rather than merged, so
    // rendering them as `unknown` is the honest treatment — folding them into
    // citations would claim a relationship the data never had.
    const folded = foldRetiredNodeRels([
      makeNode({ rels: ['reference'] }),
      makeNode({ rels: ['similar'] }),
      makeNode({ rels: ['search'] }),
    ])
    expect(folded.map((node) => node.rels)).toEqual([['reference'], ['similar'], ['search']])
  })

  it('folds a `latest` edge so it draws in the citing colour, not the unknown stroke', () => {
    const folded = foldRetiredEdgeTypes([
      { source: 'a', target: 'b', type: 'latest' as never },
      { source: 'b', target: 'c', type: 'reference' },
    ])
    expect(folded.map((edge) => edge.type)).toEqual(['citation', 'reference'])
  })
})

describe('focusOf', () => {
  const find = new Set(['found'])
  const held = new Set(['open', 'linked'])
  const hover = new Set(['hovered'])
  const highlights = new Set(['cited'])

  const hoverId = 'hovered'

  it('ranks the find, then the open paper, then hover, then the teacher', () => {
    expect(focusOf({ find, held, hover, hoverId, highlights })).toBe(find)
    expect(focusOf({ find: null, held, hover, hoverId, highlights })).toBe(held)
    expect(focusOf({ find: null, held: null, hover, hoverId, highlights })).toBe(hover)
    expect(focusOf({ find: null, held: null, hover: null, hoverId: null, highlights })).toBe(
      highlights,
    )
  })

  it('hovering one of the open paper’s lit papers shows that paper’s neighbourhood', () => {
    const neighbour = new Set(['linked', 'further'])
    expect(focusOf({ find: null, held, hover: neighbour, hoverId: 'linked', highlights })).toBe(
      neighbour,
    )
    // A dimmed paper under the pointer changes nothing.
    expect(focusOf({ find: null, held, hover, hoverId, highlights })).toBe(held)
  })

  it('an empty find still wins (dims everything), and nothing lit means no dimming', () => {
    const none = new Set<string>()
    expect(focusOf({ find: none, held, hover, hoverId, highlights })).toBe(none)
    expect(
      focusOf({ find: null, held: null, hover: null, hoverId: null, highlights: new Set() }),
    ).toBeNull()
  })
})

describe('focusAnchor', () => {
  const held = new Set(['open', 'linked'])
  const hover = new Set(['linked', 'further'])

  it('is the open paper, or the lit paper hovered inside its focus', () => {
    const base = { find: null, held, heldId: 'open', hover: null, hoverId: null }
    expect(focusAnchor(base)).toBe('open')
    expect(focusAnchor({ ...base, hover, hoverId: 'linked' })).toBe('linked')
    // A dimmed paper under the pointer doesn't move it.
    expect(focusAnchor({ ...base, hover: new Set(['far']), hoverId: 'far' })).toBe('open')
  })

  it('is the hovered paper with nothing open, and the seed (null) under a find', () => {
    const none = { find: null, held: null, heldId: null, hover: null, hoverId: null }
    expect(focusAnchor(none)).toBeNull()
    expect(focusAnchor({ ...none, hover, hoverId: 'linked' })).toBe('linked')
    expect(
      focusAnchor({ find: new Set(['x']), held, heldId: 'open', hover, hoverId: 'linked' }),
    ).toBeNull()
  })
})

describe('edgeTypeFrom', () => {
  // A citer of the seed citing an older paper: citing -> cited.
  const link = {
    source: 'citer',
    target: 'older',
    _s: 'citer',
    _t: 'older',
    type: 'citation',
  } as VLink

  it('draws blue from the citing end and green from the cited end', () => {
    expect(edgeTypeFrom(link, 'citer')).toBe('reference')
    expect(edgeTypeFrom(link, 'older')).toBe('citation')
  })

  it('keeps its own type seen from elsewhere, or from the seed', () => {
    expect(edgeTypeFrom(link, 'someone')).toBe('citation')
    expect(edgeTypeFrom(link, null)).toBe('citation')
  })
})

describe('edgeLit', () => {
  const edge = (from: string, to: string) =>
    ({ source: from, target: to, _s: from, _t: to, type: 'citation' }) as VLink
  const lit = new Set(['open', 'linked', 'other'])

  it('under a focused paper, lights only its own edges', () => {
    expect(edgeLit(edge('open', 'linked'), lit, 'open')).toBe(true)
    expect(edgeLit(edge('linked', 'open'), lit, 'open')).toBe(true)
    // Between two of its neighbours, and out of the neighbourhood: dimmed.
    expect(edgeLit(edge('linked', 'other'), lit, 'open')).toBe(false)
    expect(edgeLit(edge('linked', 'far'), lit, 'open')).toBe(false)
  })

  it('without a focused paper, lights an edge with either end lit; nothing dims unfocused', () => {
    expect(edgeLit(edge('linked', 'far'), lit, null)).toBe(true)
    expect(edgeLit(edge('far', 'away'), lit, null)).toBe(false)
    expect(edgeLit(edge('far', 'away'), null, null)).toBe(true)
  })
})
