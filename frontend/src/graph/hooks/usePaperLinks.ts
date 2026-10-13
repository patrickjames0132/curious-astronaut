/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The interconnected links (v8.18.0): the citations among the papers
 * already on the graph, not just the ones to the seed. While they're wanted
 * (the controls' Show button, in Force), this asks the server for them, and asks again whenever the
 * graph grows (an expansion, a discovery). The server caches each paper's
 * reference list, so a re-ask costs only the papers that are new.
 *
 * The links join the force simulation (GraphExplorer adds them to the view
 * as `_between` links), so they shape the layout the way Connected Papers'
 * do: in Force the sectors give way to the web the links draw (see
 * `../clusterForce.ts`). They still never enter `base.links`, so they are
 * not saved, and the relation chips never count them.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { useEffect, useState } from 'react'
import { fetchPaperLinks } from '../../api'
import type { PaperLink, Provider } from '../../api'
import type { Base } from '../model'

/** The links while they are off: ONE array, never a fresh `[]`.
 *  GraphExplorer's view memo depends on the list, so a new array per render
 *  rebuilt the view every render, and the view's store dispatch re-rendered
 *  again: an update loop that blanked the screen on every graph. */
const NO_LINKS: PaperLink[] = []

/** Where the lookup stands. */
export type PaperLinksStatus = 'off' | 'loading' | 'ready' | 'error'

/** Arguments for {@link usePaperLinks}. */
export interface UsePaperLinksArgs {
  /** The graph's stable dataset. */
  base: Base | null
  /** Bumped when `base` grows in place, which is when to ask again. */
  graphVersion: number
  /** The graph's provider. */
  provider: Provider
  /** The links are wanted (the controls' Show button, in Force). */
  on: boolean
  /** Bumped to ask again after a failed lookup (the button's retry). */
  attempt?: number
}

/** What {@link usePaperLinks} returns. */
export interface PaperLinksApi {
  /** The citations among the graph's papers that aren't drawn as edges already. */
  links: PaperLink[]
  status: PaperLinksStatus
}

/**
 * Fetch the citations among the graph's papers while they are shown.
 *
 * @param args The graph, its growth counter, its provider and whether they are wanted.
 * @returns The links and the lookup's status.
 */
export function usePaperLinks({
  base,
  graphVersion,
  provider,
  on,
  attempt = 0,
}: UsePaperLinksArgs): PaperLinksApi {
  const [links, setLinks] = useState<PaperLink[]>([])
  const [status, setStatus] = useState<PaperLinksStatus>('off')

  useEffect(() => {
    if (!on || !base) {
      setStatus('off')
      return undefined
    }
    let cancelled = false
    setStatus('loading')
    fetchPaperLinks(
      base.nodes.map((node) => node.id),
      provider,
    )
      .then((found) => {
        if (cancelled) return
        // A pair the graph already draws as an edge, either way round, would
        // only paint a second line over the first.
        const drawn = new Set(
          base.links.flatMap((link) => [`${link._s}|${link._t}`, `${link._t}|${link._s}`]),
        )
        setLinks(found.filter((link) => !drawn.has(`${link.source}|${link.target}`)))
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [on, base, graphVersion, provider, attempt])

  return { links: on ? links : NO_LINKS, status }
}
