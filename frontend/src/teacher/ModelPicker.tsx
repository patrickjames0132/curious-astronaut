/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The chat bar's model picker (v8.33.0): which model the researcher answers
 * on, for this conversation. Settings keeps the default (Agents → Agent
 * Settings → Researcher); a pick here overrides it for the conversation the
 * bar belongs to, and "Settings default" goes back. A round icon inside the
 * bar, beside 📚, shared by both assistants and the General chat.
 *
 * **The pick lives in the transcript store** (`Conversation.model`), keyed by
 * conversation like the answer it shapes, so moving between threads keeps
 * each one's own model and a background answer runs on the model it was
 * asked with. It is sent on every ask from that conversation and read
 * server-side by `routes/agents._opt_model`. It isn't saved: a reload goes
 * back to the default.
 *
 * **What it lists** is what the Settings modal's model dropdowns list
 * (`GET /api/settings/models`): every configured vendor's models, fetched
 * when the popover opens, so a key added in Settings shows up without a
 * reload. A vendor whose models couldn't be listed (offline, a bad key)
 * shows nothing to pick, as in Settings.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getAgentModels, getSettings, type AgentModels } from '../api/settings'
import { useAppDispatch, useAppSelector } from '../store'
import { conversationModelSet } from '../store/transcript'
import { usePresence } from '../ui/usePresence'

/** The gap the popover keeps from the window's edge, in px: a small one,
 *  so a tight window still gives the list what room there is (Patrick). */
const EDGE_GAP = 8

/** Keep the model list compact even when the window has ample space. */
const LIST_MAX_HEIGHT = 180

/** What the popover lists, once fetched. */
interface Choices {
  /** The researcher's model in Settings, `"provider:model"` ('' if unset). */
  configured: string
  models: AgentModels
}

/**
 * Fetch the Settings default and the listed models. Neither fetch fails the
 * picker: a blank default and an empty list still render.
 *
 * @returns The picker's choices.
 */
async function loadChoices(): Promise<Choices> {
  const [settings, models] = await Promise.all([getSettings().catch(() => null), getAgentModels()])
  const researcher = settings?.config.llm.agents.find((agent) => agent.id === 'researcher')
  return { configured: researcher?.model ?? '', models }
}

/**
 * A `"provider:model"` string's model half, for the tooltip and the rows.
 *
 * @param model The full string.
 * @returns The part after the vendor prefix.
 */
const modelName = (model: string): string => model.slice(model.indexOf(':') + 1)

/** The ring's radius and each node's, on a 24-unit grid. */
const RING = 8.6
const NODE_RADIUS = 2.2

/** The network's nodes: a pointy-top hexagon's six corners, clockwise from
 *  the top, then the hub at its centre (index 6). */
const NODES: [number, number][] = [
  ...[-90, -30, 30, 90, 150, 210].map((degrees): [number, number] => [
    12 + RING * Math.cos((degrees * Math.PI) / 180),
    12 + RING * Math.sin((degrees * Math.PI) / 180),
  ]),
  [12, 12],
]

/** Which nodes are joined, by index into {@link NODES}: the hexagon's rim,
 *  the two crossbars, the four long diagonals from the top and bottom, and
 *  the hub's six spokes. */
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 0],
  [5, 1],
  [4, 2],
  [0, 4],
  [0, 2],
  [3, 5],
  [3, 1],
  ...[0, 1, 2, 3, 4, 5].map((corner): [number, number] => [corner, 6]),
]

/**
 * One edge, trimmed to stop at both nodes' rims, so the hollow nodes stay
 * hollow on any background without a fill to match it.
 *
 * @param from The edge's first node.
 * @param to The edge's second node.
 * @returns The trimmed segment's endpoints.
 */
function trimmed(from: [number, number], to: [number, number]) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1])
  const stepX = ((to[0] - from[0]) / length) * NODE_RADIUS
  const stepY = ((to[1] - from[1]) / length) * NODE_RADIUS
  return { x1: from[0] + stepX, y1: from[1] + stepY, x2: to[0] - stepX, y2: to[1] - stepY }
}

/**
 * The picker's icon: a small network of hollow nodes, a hexagon around a hub,
 * every corner wired to its neighbours and the centre (Patrick, v8.33.0, in
 * place of a 🧠). Drawn in `currentColor` like the bar's 🗑 (`ClearGlyph`),
 * so it takes the bar's hover colour and both themes, where an emoji keeps
 * its own.
 *
 * @returns The glyph.
 */
function NetworkGlyph() {
  return (
    <svg
      className="model-glyph"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
        {EDGES.map(([from, to]) => (
          <line key={`${from}-${to}`} {...trimmed(NODES[from], NODES[to])} />
        ))}
        {NODES.map(([nodeX, nodeY], index) => (
          <circle key={index} cx={nodeX} cy={nodeY} r={NODE_RADIUS} strokeWidth="1.4" />
        ))}
      </g>
    </svg>
  )
}

/**
 * Render the picker.
 *
 * @param props Component props.
 * @param props.conversationKey The conversation the pick belongs to.
 * @param props.open Whether its popover is open.
 * @param props.onOpenChange Open or close it (the bar arbitrates, so only
 *   one of its popovers is open at a time).
 * @param props.dataTour The tour's anchor, on the Citation Graph's alone.
 * @returns The trigger and, while open, its popover.
 */
export default function ModelPicker({
  conversationKey,
  open,
  onOpenChange,
  dataTour,
}: {
  conversationKey: string
  open: boolean
  onOpenChange: (open: boolean) => void
  dataTour?: string
}) {
  const dispatch = useAppDispatch()
  const picked = useAppSelector((state) => state.transcript.byKey[conversationKey]?.model)
  const [choices, setChoices] = useState<Choices | null>(null)
  const popover = usePresence(open)
  const popRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // The list's height cut to fit the window, or null for its own.
  const [listHeight, setListHeight] = useState<number | null>(null)

  // Keep the popover clear of the window's edge. On the empty landing chat
  // it drops DOWN from a bar centred mid-page, like the filters beside it
  // (teacher.css); docked, it opens UP out of the bar. It keeps that
  // direction whatever the room (Patrick: never over the question box). A
  // vendor can list dozens of models (OpenAI's ran 3,500px), so the list, the
  // one part that scrolls (`.model-pop`), is cut to the room left, ending
  // `EDGE_GAP` short of the edge, and the wheel scrolls it in the smaller box.
  // (The head stays above it; the footer note went to give the list room.)
  //
  // What the first tries got wrong: the popover was a capped scroller itself
  // (`.scope-pop`), so cutting the list hardly moved its bottom; its
  // `getBoundingClientRect` reads it mid-entrance, scaled; and a 120px floor
  // on the list still overran the 150px measured under Patrick's landing
  // bar. The room is worked out from layout boxes (the chip row's box plus
  // the popover's offsets), which no transform touches, and the list takes
  // all of it and no more. Measured after every load (the list is only full
  // once it lands) and on resize.
  useLayoutEffect(() => {
    const pop = popRef.current
    const list = listRef.current
    const wrap = pop?.offsetParent
    // Gone: the next open measures from the full list again.
    if (!popover.present) setListHeight(null)
    if (!popover.present || !pop || !list || !wrap) return
    const measure = () => {
      const top = wrap.getBoundingClientRect().top + pop.offsetTop
      const chrome = pop.offsetHeight - list.offsetHeight
      // Down: everything from the popover's top to the window's bottom edge.
      // Up: everything from the window's top edge to the popover's bottom.
      const room =
        pop.offsetTop > 0
          ? window.innerHeight - EDGE_GAP - top - chrome
          : top + pop.offsetHeight - EDGE_GAP - chrome
      const limit = Math.max(0, Math.min(LIST_MAX_HEIGHT, Math.floor(room)))
      setListHeight(list.scrollHeight > limit ? limit : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [popover.present, choices])

  // Re-read on every open: a vendor key or a default changed in Settings
  // since the last one should show up here without a reload.
  useEffect(() => {
    if (!open) return
    let live = true
    void loadChoices().then((loaded) => {
      if (live) setChoices(loaded)
    })
    return () => {
      live = false
    }
  }, [open])

  /**
   * Pick a model (or null for the Settings default) and close.
   *
   * @param model The `"provider:model"`, or null.
   */
  const choose = (model: string | null) => {
    dispatch(conversationModelSet(model, conversationKey))
    onOpenChange(false)
  }

  const vendors = choices?.models.vendors.filter((vendor) => choices.models.models[vendor]?.length)
  const radioName = `model-${conversationKey}`
  return (
    <div className="scope-wrap model-picker" data-tour={dataTour}>
      <button
        type="button"
        className={`scope-btn ${picked ? 'on' : ''}`}
        onClick={() => onOpenChange(!open)}
        title={
          picked
            ? `Model · ${modelName(picked)} for this chat — click to switch, or go back to the Settings default`
            : 'Model · the Settings default — click to pick another model for this chat'
        }
        aria-label="Choose the model for this chat"
      >
        <span className="scope-btn-icon">
          <NetworkGlyph />
        </span>
        <span className="scope-btn-label">Model</span>
      </button>
      {popover.present && (
        <div
          ref={popRef}
          className={`scope-pop model-pop${popover.closing ? ' closing' : ''}`}
          onAnimationEnd={popover.onAnimationEnd}
        >
          <div className="scope-pop-head">
            <span>Answer with</span>
            <span className="scope-pop-actions">
              <button
                className="link-btn"
                onClick={() => onOpenChange(false)}
                aria-label="Close the model picker"
              >
                ✕
              </button>
            </span>
          </div>
          <label className="scope-item">
            <input type="radio" name={radioName} checked={!picked} onChange={() => choose(null)} />
            <span className="scope-item-title">
              Settings default
              {choices?.configured && (
                <span className="model-pop-default"> · {modelName(choices.configured)}</span>
              )}
            </span>
          </label>
          <div
            ref={listRef}
            className="model-pop-list"
            style={listHeight === null ? undefined : { maxHeight: listHeight }}
          >
            {vendors?.map((vendor) => (
              <div key={vendor} role="group" aria-label={vendor}>
                <div className="model-pop-vendor">{vendor}</div>
                {choices?.models.models[vendor]?.map((name) => {
                  const value = `${vendor}:${name}`
                  return (
                    <label key={value} className="scope-item">
                      <input
                        type="radio"
                        name={radioName}
                        checked={picked === value}
                        onChange={() => choose(value)}
                      />
                      <span className="scope-item-title" title={name}>
                        {name}
                      </span>
                    </label>
                  )
                })}
              </div>
            ))}
          </div>
          {/* A footer only while there's no list: "for this chat only" went
              (Patrick, v8.33.0) to give the list its room; the trigger's
              tooltip says it. */}
          {!vendors?.length && (
            <div className="scope-hint">
              {choices === null
                ? 'Loading models…'
                : 'No models to list. Set up a model provider in Settings → Agents.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
