/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The course as the Knowledge Graph's assistant reads it (v8.25.0): every
 * item with its kind, its check-off, what it needs and why (a synthesis's
 * concepts and target), and the lessons written so far. Sent as structure;
 * the server lays it out for the researcher and bounds it
 * (`routes/agents.py`, `_course_context`).
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import type { CourseContext } from '../../api'
import { courseOrder, lessonText, needs, withoutImageMarks, type KnowledgeMap } from '../model'

/**
 * Describe a course for its assistant.
 *
 * @param map The course.
 * @returns Its items in teaching order (the paper first, then each lesson
 *   in the order the course teaches it, then whatever a check-off pruned),
 *   the open item's title, and every lesson written, image markers removed.
 */
export function courseContext(map: KnowledgeMap): CourseContext {
  const taught = courseOrder(map).filter((id) => id !== map.rootId)
  const rest = Object.keys(map.nodes).filter((id) => id !== map.rootId && !taught.includes(id))
  const known = new Set(map.known)
  const title = (id: string) => map.nodes[id]?.title ?? id
  const items = [map.rootId, ...taught, ...rest]
    .map((id) => map.nodes[id])
    .filter((node) => !!node)
    .map((node) => {
      const lesson = lessonText(node)
      const needed = needs(map, node.id).map((edge) => ({ title: title(edge.to), why: edge.why }))
      return {
        title: node.title,
        kind: node.kind,
        ...(known.has(node.id) && { known: true }),
        ...(needed.length && { needs: needed }),
        ...(node.members && { members: node.members.map(title) }),
        ...(node.toward && { toward: title(node.toward) }),
        ...(lesson && { lesson: withoutImageMarks(lesson) }),
      }
    })
  return {
    paper: map.nodes[map.rootId]?.title ?? '',
    open: map.openId && map.nodes[map.openId] ? map.nodes[map.openId].title : null,
    items,
  }
}

/**
 * The course's outline alone, for a chat that mentions this one: its
 * lessons stay home (`ThreadContext.course`).
 *
 * @param map The course.
 * @returns The context without lessons or an open item.
 */
export function courseOutline(map: KnowledgeMap): CourseContext {
  const context = courseContext(map)
  return {
    ...context,
    open: null,
    items: context.items.map(({ lesson: _lesson, ...item }) => item),
  }
}
