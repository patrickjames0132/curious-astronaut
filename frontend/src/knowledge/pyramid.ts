/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The pyramid view's layout and its reading of what the reader knows (v8.41.0),
 * pure functions over the course like `model.ts`. Each item sits on a row by
 * its **height above the foundations**: an item that needs nothing is on the
 * bottom row, and every other item sits one row above the highest thing it
 * needs, so the paper ends on top and a shared prerequisite is drawn once, at
 * its natural level. Rows are ordered to keep lines from crossing (a
 * barycentre sweep, as layered graph drawing does). Each item is then raised
 * to sit just under the lowest item that needs it, so lines stay short. The rows ignore the
 * check-offs, so ticking a concept never reshuffles the pyramid: what you know
 * changes how it is drawn (`skippedItems`), not where.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { courseOrder, needs, type KnowledgeMap } from './model'

/** An item's spot in the pyramid, in graph units (y grows downward). */
export interface Spot {
  // oxlint-disable-next-line id-length -- the force engine's own coordinate names
  x: number
  // oxlint-disable-next-line id-length
  y: number
}

/** The gap between the pyramid's rows, in graph units. */
export const ROW_GAP = 80
/** The gap between neighbours on a row: room for a label under each. */
export const COLUMN_GAP = 100
/** How many down-and-up sweeps reorder the rows. A few settle it. */
const SWEEPS = 4

/**
 * What sits directly beneath an item in the pyramid: a concept's (or the
 * paper's) prerequisites and the syntheses that build toward it, or a
 * synthesis's members.
 *
 * @param map The course.
 * @param nodeId The item.
 * @returns The ids beneath it, on the course.
 */
export function beneath(map: KnowledgeMap, nodeId: string): string[] {
  const node = map.nodes[nodeId]
  if (!node) return []
  if (node.kind === 'synthesis') return (node.members ?? []).filter((id) => map.nodes[id])
  const below = needs(map, nodeId).map((edge) => edge.to)
  for (const other of Object.values(map.nodes))
    if (other.kind === 'synthesis' && other.toward === nodeId) below.push(other.id)
  return below.filter((id) => map.nodes[id])
}

/**
 * Each item's row, counted up from the foundations (0). The paper is always
 * the top row on its own. Two passes:
 *
 * 1. **Height**: an item that needs nothing starts on row 0, and every other
 *    item one row above the highest thing beneath it.
 * 2. **Raised to what needs it** (Patrick, at the first browser round): from
 *    the top down, each item rises to sit just one row under the lowest item
 *    that needs it. A foundation needed only near the top used to sit on the
 *    bottom row, its line running straight through whatever stood between.
 *    An item never sinks, so everything it needs stays below it, and one
 *    needed both low and high stays low (the view curves such a line).
 *
 * @param map The course.
 * @returns Row per item id.
 */
export function pyramidRows(map: KnowledgeMap): Map<string, number> {
  const rows = new Map<string, number>()
  const visiting = new Set<string>()
  const rowOf = (id: string): number => {
    const known = rows.get(id)
    if (known !== undefined) return known
    // A loop should never exist (the course drops them); count it as a floor.
    if (visiting.has(id)) return 0
    visiting.add(id)
    const below = beneath(map, id)
    const row = below.length ? 1 + Math.max(...below.map(rowOf)) : 0
    visiting.delete(id)
    rows.set(id, row)
    return row
  }
  for (const id of Object.keys(map.nodes)) rowOf(id)
  // The paper on top, alone, even if something cut off from it ran as high.
  const highest = Math.max(
    0,
    ...[...rows].filter(([id]) => id !== map.rootId).map(([, row]) => row),
  )
  rows.set(map.rootId, Math.max(rows.get(map.rootId) ?? 0, highest + 1))

  const above = new Map<string, string[]>()
  for (const id of rows.keys())
    for (const child of beneath(map, id)) above.set(child, [...(above.get(child) ?? []), id])
  // Top down, so whatever needs an item has its final row first.
  const topDown = [...rows.keys()].sort((left, right) => rows.get(right)! - rows.get(left)!)
  for (const id of topDown) {
    const needers = above.get(id)
    if (id === map.rootId || !needers?.length) continue
    const lowest = Math.min(...needers.map((other) => rows.get(other)!))
    rows.set(id, Math.max(rows.get(id)!, lowest - 1))
  }
  return rows
}

/**
 * The pyramid's layout: each item's spot, the paper at the top centre and the
 * foundations along the bottom, each row centred under it.
 *
 * @param map The course.
 * @returns Spot per item id, in graph units (y grows downward).
 */
export function pyramidLayout(map: KnowledgeMap): Map<string, Spot> {
  const rows = pyramidRows(map)
  const top = rows.get(map.rootId) ?? 0
  const byRow: string[][] = Array.from({ length: top + 1 }, () => [])
  const titled = (id: string) => map.nodes[id]?.title ?? id
  for (const id of [...rows.keys()].sort((left, right) =>
    titled(left).localeCompare(titled(right)),
  ))
    byRow[rows.get(id)!].push(id)

  // Who each item touches on other rows: what needs it, and what it needs.
  const above = new Map<string, string[]>()
  const below = new Map<string, string[]>()
  for (const id of rows.keys()) {
    const under = beneath(map, id)
    below.set(id, under)
    for (const child of under) above.set(child, [...(above.get(child) ?? []), id])
  }

  const spotX = new Map<string, number>()
  const place = (row: string[]) =>
    row.forEach((id, index) => spotX.set(id, (index - (row.length - 1) / 2) * COLUMN_GAP))
  for (const row of byRow) place(row)
  // Barycentre: sort a row by the mean x of its neighbours on the side just
  // placed. An item with none there keeps its place among the rest.
  const reorder = (row: string[], neighbours: Map<string, string[]>) => {
    const keyed = row.map((id, index) => {
      const xs = (neighbours.get(id) ?? []).map((other) => spotX.get(other)).filter(isNumber)
      const mean = xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null
      return { id, index, key: mean ?? spotX.get(id) ?? 0 }
    })
    keyed.sort((left, right) => left.key - right.key || left.index - right.index)
    row.splice(0, row.length, ...keyed.map((entry) => entry.id))
    place(row)
  }
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (let row = top - 1; row >= 0; row--) reorder(byRow[row], above)
    for (let row = 1; row < top; row++) reorder(byRow[row], below)
  }

  const spots = new Map<string, Spot>()
  byRow.forEach((row, level) => {
    for (const id of row) spots.set(id, { x: spotX.get(id)!, y: (top - level) * ROW_GAP })
  })
  return spots
}

/**
 * Whether a value is a number (a filter's type guard).
 *
 * @param value The value.
 * @returns True for a number.
 */
function isNumber(value: number | undefined): value is number {
  return value !== undefined
}

/**
 * The items the course skips because something the reader knows already
 * covers them: not in the teaching order (a known item prunes what it needs)
 * and not known themselves. The pyramid fades them, so what is left to learn
 * stands out between the green and the paper.
 *
 * @param map The course.
 * @returns Their ids.
 */
export function skippedItems(map: KnowledgeMap): Set<string> {
  const taught = new Set(courseOrder(map))
  const known = new Set(map.known)
  return new Set(Object.keys(map.nodes).filter((id) => !taught.has(id) && !known.has(id)))
}
