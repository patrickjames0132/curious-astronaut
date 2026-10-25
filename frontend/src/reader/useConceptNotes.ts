/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The Reader's Knowledge Graph notes (v8.44.0): which of the thread's course
 * concepts each section of the paper needs. Asked of the tutor once per
 * course (`/api/knowledge/place`, cached on the server by the concepts), and
 * again whenever the course's concepts change; a check-off or a lesson
 * changes nothing here, since the notes read those live from the course.
 * Nothing at all without a course, or a text to place it in (Patrick).
 *
 * Placed in the paper's text, by its document's section ids; or, for a paper
 * the Reader can only show as a PDF, in the PDF's contents entries
 * (`pdf:<n>`). The PDF view of a paper that has a text reuses the text's
 * placement (`pdfNotes`), so the two views agree and nothing is asked twice.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useMemo, useState } from 'react'
import { placeConcepts, type PlaceTarget, type ReaderSection } from '../api'
import { isCurrentMap, nameKey, type KnowledgeMap } from '../knowledge/model'
import { plainText } from './links'
import type { PdfOutlineEntry } from './pdf'

/**
 * The course's concepts the paper's sections need.
 *
 * @param course The thread's saved course, if any.
 * @param target What to place it in; null for no notes.
 * @returns The concept ids each section needs, by section id (each list in
 *          the course's own order), and the course when there is one.
 */
export function useConceptNotes(
  course: unknown,
  target: PlaceTarget | null,
): { notes: Map<string, string[]>; map: KnowledgeMap | null } {
  const map = isCurrentMap(course) ? course : null
  // The concepts by title, and a key that changes only when they do.
  const concepts = useMemo(
    () => (map ? Object.values(map.nodes).filter((node) => node.kind === 'concept') : []),
    [map],
  )
  const titles = concepts.map((node) => node.title)
  const conceptsKey = titles.join('\n')
  const [placed, setPlaced] = useState<Record<string, string[]>>({})

  const { paper, source, provider } = target ?? {}
  useEffect(() => {
    setPlaced({})
    if (!paper || !source || !conceptsKey) return
    const controller = new AbortController()
    placeConcepts({ paper, source, provider }, conceptsKey.split('\n'), controller.signal)
      .then(setPlaced)
      .catch((error: unknown) => {
        // A nicety: the paper reads the same without its notes.
        if (!controller.signal.aborted) console.warn('[reader] placing the course failed', error)
      })
    return () => controller.abort()
  }, [paper, source, provider, conceptsKey])

  const notes = useMemo(() => {
    const byKey = new Map(concepts.map((node) => [nameKey(node.title), node.id]))
    const result = new Map<string, string[]>()
    for (const [sectionId, names] of Object.entries(placed)) {
      const ids = names.map((name) => byKey.get(nameKey(name))).filter((id): id is string => !!id)
      if (ids.length) result.set(sectionId, ids)
    }
    return result
  }, [placed, concepts])
  return { notes, map }
}

/** A note's place in the PDF: its page, and how far down it (PDF points). */
export interface PdfNote {
  page: number
  top: number
  /** The PDF heading it sits by. */
  title: string
  ids: string[]
}

/**
 * A heading's number ("3.2.1", "B.1") and its words, for matching.
 *
 * @param text The heading, numbered or not.
 * @returns Its number ('' when it has none) and its title as a `nameKey`.
 */
function headingParts(text: string): { number: string; words: string } {
  const match = /^((?:\d{1,2}|[A-H])(?:\.\d{1,2}){0,3})\.?\s+(.*)$/.exec(text.trim())
  return {
    number: match ? match[1] : '',
    words: nameKey(match ? match[2] : text),
  }
}

/**
 * The notes placed in a paper's text, moved to its PDF: each section matched
 * to the PDF contents entry that heads it, by number when both have one
 * ("3.2.1"), else by title. An outline's entries often carry no number
 * (Attention's), and a title can repeat, so the search runs forward from the
 * last match before looking anywhere else. A section with no heading in the
 * PDF has no note there.
 *
 * @param notes The text's notes, by document section id.
 * @param sections The document's sections.
 * @param contents The PDF's contents entries.
 * @returns The notes by PDF place, in reading order.
 */
export function textNotesInPdf(
  notes: Map<string, string[]>,
  sections: ReaderSection[],
  contents: PdfOutlineEntry[],
): PdfNote[] {
  const entries = contents.map((entry) => headingParts(entry.title))
  const placed: PdfNote[] = []
  let cursor = 0
  for (const section of sections) {
    const ids = notes.get(section.id)
    if (!ids) continue
    const number = section.number ?? ''
    const words = nameKey(plainText(section.title))
    const matches = (index: number) => {
      const entry = entries[index]
      return number && entry.number ? entry.number === number : entry.words === words
    }
    const order = [...entries.keys()]
    const found = [...order.slice(cursor), ...order.slice(0, cursor)].find(matches)
    if (found === undefined) continue
    cursor = found + 1
    placed.push({
      page: contents[found].page,
      top: contents[found].top ?? 0,
      title: contents[found].title,
      ids,
    })
  }
  return placed
}

/**
 * The notes placed in a PDF's own contents (`pdf:<n>`), by PDF place.
 *
 * @param notes The notes, by `pdf:<n>`.
 * @param contents The PDF's contents entries the ids count.
 * @returns The notes by PDF place, in reading order.
 */
export function pdfContentsNotes(
  notes: Map<string, string[]>,
  contents: PdfOutlineEntry[],
): PdfNote[] {
  return contents.flatMap((entry, index) => {
    const ids = notes.get(`pdf:${index}`)
    return ids ? [{ page: entry.page, top: entry.top ?? 0, title: entry.title, ids }] : []
  })
}

/**
 * The card id a note's chip opens: its note and its concept.
 *
 * @param slot The note (its section, or its place in the PDF).
 * @param conceptId The concept.
 * @returns The id; `conceptOf` reads the concept back.
 */
export function chipId(slot: string, conceptId: string): string {
  return `${slot}|${conceptId}`
}

/**
 * The concept a chip's card id names.
 *
 * @param id The card id (`chipId`).
 * @returns The concept's id. Concept ids are `nameKey`s (letters and digits
 *          only), so the last `|` is always the note's.
 */
export function conceptOf(id: string): string {
  return id.slice(id.lastIndexOf('|') + 1)
}
