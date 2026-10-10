/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The knowledge network (Phase 5b): a short course on what a reader needs
 * to know before a paper makes sense, drawn as a **graph of ideas**. The
 * paper sits in the middle; breaking an item down adds the concepts it needs
 * as new nodes, and a concept two items share is one node with two arrows
 * into it. A click opens the item's lesson in a side panel; a double-click
 * breaks it down. The course controls (2D / 3D and the citation
 * graph's Release · Fit · Clear row) fold into a sliders button like the
 * citation graph's, and a legend
 * sits bottom-left.
 *
 * This component owns the in-flight state (which items are being broken
 * down, which failed) and the calls; the course itself lives on the thread
 * (`ThreadRecord.knowledge`), so it saves with the exploration and survives
 * leaving the tool.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { expandKnowledge, type KnowledgePaper } from '../api'
import { useAppDispatch } from '../store'
import {
  knowledgeExpanded,
  knowledgeKnownSet,
  knowledgeKnownToggled,
  knowledgeOpened,
  knowledgeStarted,
  type ThreadRecord,
} from '../store/explorations'
import { usePresence } from '../ui/usePresence'
import { useBoxSelect } from '../ui/useBoxSelect'
import KnowledgeControls from './KnowledgeControls'
import KnowledgeGraph, { type KnowledgeEngine } from './KnowledgeGraph'
import KnowledgeLegend from './KnowledgeLegend'
import KnowledgePanel from './KnowledgePanel'
import { courseNames, createMap, isCurrentMap, tutorPath } from './model'
import { useLessons } from './useLessons'
import './knowledge.css'

/** three.js only loads when someone flips to 3D. */
const KnowledgeGraph3D = lazy(() => import('./KnowledgeGraph3D'))

/** localStorage keys for the per-browser view preferences. */
const MODE_KEY = 'ca.knowledge3d'

/**
 * The paper at the root of a thread's course.
 *
 * @param thread The paper thread.
 * @returns The paper, from the thread's hydrated details or its seed.
 */
function rootPaper(thread: ThreadRecord): KnowledgePaper {
  const paper = thread.paper
  if (paper)
    return {
      id: paper.id,
      title: paper.title,
      year: paper.year,
      abstract: paper.abstract,
      arxiv_id: paper.arxiv_id,
      url: paper.url,
      authors: paper.authors,
    }
  const seed = thread.data.graph_ref?.seed
  return { id: seed?.id ?? thread.id, title: seed?.title ?? thread.title }
}

/**
 * Read a remembered view preference.
 *
 * @param key Its localStorage key.
 * @returns The stored value, or null when absent or unreadable.
 */
function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Remember a view preference; a private window just doesn't remember it.
 *
 * @param key Its localStorage key.
 * @param value The value.
 */
function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Unwritable storage: the choice lasts for this visit only.
  }
}

/**
 * Render a paper thread's knowledge network.
 *
 * @param props Component props.
 * @param props.thread The active paper thread.
 * @param props.children The shell's floating overlays (the ‹ pill, errors).
 * @returns The network.
 */
export default function KnowledgeNetwork({
  thread,
  children,
}: {
  thread: ThreadRecord
  children?: ReactNode
}) {
  const dispatch = useAppDispatch()
  const threadId = thread.id
  const provider = thread.data.provider ?? 's2'
  const map = isCurrentMap(thread.knowledge) ? thread.knowledge : undefined
  const [expanding, setExpanding] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null)
  const [threeD, setThreeD] = useState(() => readPreference(MODE_KEY) === '1')
  const [fitSignal, setFitSignal] = useState(0)
  const { drafts, write, writing } = useLessons(threadId)
  // Items picked to check off together (v8.17.0): shift-click toggles one,
  // an alt-drag box adds the nodes inside it, as on the citation graph. Not
  // saved: a selection is a moment's gesture, not part of the course.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const engineRef = useRef<KnowledgeEngine | null>(null)
  // Nodes pinned by dragging, for the controls' Release count. The pins live
  // on the view's own node objects, so switching 2D/3D starts unpinned.
  const [pinned, setPinned] = useState(0)

  // The canvas fills whatever the panel leaves it.
  const wrapRef = useRef<HTMLDivElement>(null)
  const clearSelection = useCallback(() => setSelected(new Set()), [])
  const toggleSelected = useCallback(
    (nodeId: string) =>
      setSelected((previous) => {
        const next = new Set(previous)
        if (!next.delete(nodeId)) next.add(nodeId)
        return next
      }),
    [],
  )
  const box = useBoxSelect({
    wrapRef,
    hitTest: (bounds) => engineRef.current?.nodesIn(bounds) ?? [],
    onPick: (ids) => setSelected((previous) => new Set([...previous, ...ids])),
    onClear: clearSelection,
  })
  // Esc drops the selection, the way it drops the citation graph's highlights.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearSelection])
  const [size, setSize] = useState({ width: 800, height: 600 })
  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The first open starts the course with the paper as its only node (and
  // replaces a course saved in an older shape).
  useEffect(() => {
    if (!map) dispatch(knowledgeStarted({ threadId, map: createMap(rootPaper(thread)) }))
  }, [dispatch, thread, threadId, map])

  // The map as of the latest render, for callbacks that outlive one.
  const mapRef = useRef(map)
  mapRef.current = map

  const expand = useCallback(
    (nodeId: string) => {
      const current = mapRef.current
      const node = current?.nodes[nodeId]
      if (!current || !node || node.expanded) return
      setExpanding((previous) => (previous.has(nodeId) ? previous : new Set(previous).add(nodeId)))
      setFailed(({ [nodeId]: _dropped, ...rest }) => rest)
      expandKnowledge({
        item: {
          title: node.title,
          kind: node.kind,
          ...(node.paper ? { paper_id: node.paper.id } : {}),
        },
        path: tutorPath(current, nodeId),
        existing: courseNames(current),
        provider,
      })
        .then((found) => dispatch(knowledgeExpanded({ threadId, nodeId, children: found })))
        .catch((error: unknown) =>
          setFailed((previous) => ({
            ...previous,
            [nodeId]: error instanceof Error ? error.message : 'Could not break this down',
          })),
        )
        .finally(() =>
          setExpanding((previous) => {
            const next = new Set(previous)
            next.delete(nodeId)
            return next
          }),
        )
    },
    [dispatch, provider, threadId],
  )

  // The paper breaks down on its own the first time: a graph of one node
  // would be a course with nothing in it.
  const rootId = map?.rootId
  const rootExpanded = !!map && !!map.nodes[map.rootId]?.expanded
  useEffect(() => {
    if (rootId && !rootExpanded && !expanding.has(rootId) && !failed[rootId]) expand(rootId)
  }, [rootId, rootExpanded, expanding, failed, expand])

  // Opening an item writes its lesson, the first time only.
  const openId = map?.openId ?? null
  useEffect(() => {
    if (map && openId) write(map, openId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open, not on every map edit
  }, [openId, write])

  const open = useCallback(
    (nodeId: string) => dispatch(knowledgeOpened({ threadId, nodeId })),
    [dispatch, threadId],
  )
  // Opening an item, by a click on its node, Next lesson or a panel link,
  // centres it in view (a click only opened the lesson until v8.17.0).
  const openAndFocus = useCallback(
    (nodeId: string) => {
      open(nodeId)
      setFocus((previous) => ({ id: nodeId, seq: (previous?.seq ?? 0) + 1 }))
    },
    [open],
  )
  const close = useCallback(
    () => dispatch(knowledgeOpened({ threadId, nodeId: null })),
    [dispatch, threadId],
  )

  // The panel slides out rather than vanishing, showing the last item it held.
  const panel = usePresence(!!openId)
  const lastOpen = useRef(openId)
  if (openId) lastOpen.current = openId
  const shownId = openId ?? lastOpen.current

  // Same outer structure as below, so the canvas element (and its size
  // observer) survives the course arriving.
  if (!map)
    return (
      <div className="knowledge">
        <div className="knowledge-canvas" ref={wrapRef}>
          {children}
        </div>
      </div>
    )
  const graphProps = {
    map,
    width: size.width,
    height: size.height,
    expanding,
    focus,
    fitSignal,
    selected,
    onOpen: openAndFocus,
    onExpand: expand,
    onSelect: toggleSelected,
    onBackground: close,
    engineRef,
    onPinned: setPinned,
  }
  // The selection's one action marks them all known, or, when every one is
  // already known, takes them all back.
  const picked = [...selected].filter((nodeId) => map.nodes[nodeId])
  const allKnown = picked.length > 0 && picked.every((nodeId) => map.known.includes(nodeId))

  return (
    <div className="knowledge" data-tour="knowledge">
      <div className="knowledge-canvas" ref={wrapRef}>
        {threeD ? (
          <Suspense
            fallback={
              <p className="knowledge-loading">
                <span className="spin" /> Loading 3D…
              </p>
            }
          >
            <KnowledgeGraph3D {...graphProps} />
          </Suspense>
        ) : (
          <KnowledgeGraph {...graphProps} />
        )}

        <KnowledgeControls
          threeD={threeD}
          onThreeD={(on) => {
            setThreeD(on)
            setPinned(0)
            writePreference(MODE_KEY, on ? '1' : '0')
          }}
          onFit={() => setFitSignal((count) => count + 1)}
          pinnedCount={pinned}
          onRelease={() => engineRef.current?.release()}
          selectedCount={picked.length}
          onClear={clearSelection}
        />
        {/* The alt-drag box: the arm overlay captures the drag (so the
            engine never pans) and the outline paints the box. Shared CSS with
            the citation graph's marquee. */}
        <div
          className={`marquee-arm${box.armed ? ' armed' : ''}`}
          onMouseDown={box.onArmMouseDown}
        />
        {box.rect && (
          <div
            className="marquee-rect"
            style={{
              left: box.rect.left,
              top: box.rect.top,
              width: box.rect.width,
              height: box.rect.height,
            }}
          />
        )}
        {picked.length > 0 && (
          <div className="knowledge-selection" role="toolbar" aria-label="Selected items">
            <span>{picked.length} selected</span>
            <button
              type="button"
              className="knowledge-selection-mark"
              onClick={() => {
                dispatch(knowledgeKnownSet({ threadId, nodeIds: picked, known: !allKnown }))
                clearSelection()
              }}
            >
              {allKnown ? 'Not known' : '✓ I know these'}
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={clearSelection}
              title="Clear the selection (Esc)"
            >
              Clear
            </button>
          </div>
        )}
        <KnowledgeLegend />
        {failed[map.rootId] && (
          <div className="overlay overlay-card knowledge-failed">
            {failed[map.rootId]}{' '}
            <button type="button" onClick={() => expand(map.rootId)}>
              Try again
            </button>
          </div>
        )}
        {children}
      </div>

      {panel.present && shownId && map.nodes[shownId] && (
        <KnowledgePanel
          map={map}
          nodeId={shownId}
          draft={drafts[shownId]}
          writing={writing(shownId)}
          expanding={expanding.has(shownId)}
          expandError={failed[shownId]}
          closing={panel.closing}
          onAnimationEnd={panel.onAnimationEnd}
          onOpen={openAndFocus}
          onExpand={expand}
          onToggleKnown={(nodeId) => dispatch(knowledgeKnownToggled({ threadId, nodeId }))}
          onRetry={() => write(map, shownId)}
          onClose={close}
        />
      )}
    </div>
  )
}
