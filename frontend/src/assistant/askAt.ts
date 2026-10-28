/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * Ask a question in a view that isn't on screen (v9.0.0, the OnePager's "One
 * assistant", stage 4b). The router decides a question is about another of
 * the exploration's papers, or about none (General), and the answer gets
 * that place's context without the reader being moved there: the agent
 * never moves the view unasked. The question is tagged with the place, and
 * its tag (and the answer's links, stage 4a) are the way there.
 *
 * - **The course and the Reader** already read their paper off the thread
 *   record (the course; the paper and the section last in view), so they
 *   ask through their own thunks.
 * - **General** is the graph-free researcher, which searches the
 *   literature, as a chat with no paper open asks.
 * - **The Citation Graph** needs its graph: the one parked when the reader
 *   last left it, else built quietly (the server caches graphs for a day),
 *   never put on screen (Patrick, 2026-10-26). Its discoveries wait on that
 *   paper, as a background answer's do, and its `[n]` markers resolve
 *   against that graph's numbering.
 * - **Several papers at once** (stage 4c, a bridge question) are answered
 *   over the papers themselves, numbered as peers the researcher can read
 *   and expand: no graph is built for it. Each paper is its thread's
 *   hydrated details, fetched (and kept on the thread) when it has none.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import {
  fetchGraphStream,
  fetchPaperDetail,
  streamAcross,
  streamAsk,
  streamAskSources,
  type GraphNode,
  type TurnTag,
} from '../api'
import { askCourse } from '../knowledge/assistant/askCourse'
import { askOrGuideReader } from '../reader/askReader'
import type { AppDispatch, RootState } from '../store'
import { paperTag } from '../store/chats'
import { threadPaperSet, type ThreadRecord } from '../store/explorations'
import { backgroundDiscovery, graphRefsSet, selectChatKey } from '../store/transcript'
import { resolveGraphRefs } from '../teacher/useConversation'
import { streamAnswer, type AssistantQuestion } from './askAssistant'

/**
 * The graph a paper's question is answered over: parked from the last visit,
 * else built (and cached by the server) without being shown.
 *
 * @param thread The paper thread.
 * @returns Its seed and every paper on it, discoveries included.
 * @throws When the paper has no graph to build, or the build fails.
 */
async function graphOf(thread: ThreadRecord): Promise<{ seed: GraphNode; nodes: GraphNode[] }> {
  const parked = thread.workspace?.graph
  const graph =
    parked ??
    (thread.data.graph_ref
      ? await fetchGraphStream(thread.data.graph_ref.seed_ref, thread.data.provider ?? 's2')
      : null)
  if (!graph?.nodes.length) throw new Error(`There's no Citation Graph for ${thread.title} to ask.`)
  const nodes = [...graph.nodes, ...(thread.workspace?.discoveredNodes ?? [])]
  const seed = graph.nodes.find((node) => node.is_seed) ?? graph.nodes[0]
  return { seed, nodes }
}

/**
 * A paper as a bridge question reads it: its thread's hydrated details,
 * fetched and kept on the thread when it has none (as its cards do).
 *
 * @param thread The paper thread.
 * @param dispatch To keep what was fetched.
 * @returns The paper as a node.
 * @throws When it has no details and none can be fetched.
 */
async function paperOf(thread: ThreadRecord, dispatch: AppDispatch): Promise<GraphNode> {
  let paper = thread.paper
  const ref = thread.data.graph_ref?.seed_ref ?? thread.identity
  if (!paper && ref) {
    paper = await fetchPaperDetail(ref, thread.data.provider ?? 's2')
    dispatch(threadPaperSet({ id: thread.id, paper }))
  }
  if (!paper) throw new Error(`There's nothing to read of ${thread.title}.`)
  return { ...paper, rels: [], is_seed: false }
}

/**
 * Ask a question where the router placed it: General, a paper's view, or
 * several papers at once.
 *
 * @param tag Where: a paper and its tool, or undefined for General.
 * @param request The question, with where it was typed (`placedFrom`).
 * @returns The thunk; it settles when the answer has ended.
 */
export function askAt(tag: TurnTag | undefined, request: AssistantQuestion) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    if (!tag) {
      await dispatch(
        streamAnswer(undefined, request, (body, handlers) => streamAskSources(body, handlers)),
      )
      return
    }
    const threads = Object.values(getState().explorations.byId).flatMap((record) => record.threads)
    const thread = threads.find((item) => item.id === tag.threadId)
    if (!thread) return
    if (tag.tool === 'across') {
      const peers = (tag.papers ?? []).flatMap(
        (paper) => threads.find((item) => item.id === paper.threadId) ?? [],
      )
      const key = selectChatKey(getState())
      let numbered: string[] = []
      await dispatch(
        streamAnswer(
          tag,
          { ...request, provider: thread.data.provider ?? 's2' },
          async (body, handlers) => {
            const papers = await Promise.all(peers.map((peer) => paperOf(peer, dispatch)))
            numbered = papers.map((paper) => paper.id)
            await streamAcross({ ...body, papers }, handlers)
          },
          {
            // An expand numbers papers past the peers: kept for the `[n]`s, and
            // put on no graph, since a bridge question has none.
            onDiscovery: (discovery) => {
              for (const node of discovery.nodes)
                if (typeof node.idx === 'number' && node.idx >= 1) numbered[node.idx - 1] = node.id
            },
            onAnswered: (text) => dispatch(graphRefsSet(resolveGraphRefs(text, numbered), key)),
          },
        ),
      )
      return
    }
    const asked = { ...request, threadId: thread.id, provider: thread.data.provider ?? 's2' }
    if (tag.tool === 'knowledge') {
      await dispatch(askCourse(asked))
      return
    }
    if (tag.tool === 'reader') {
      await dispatch(askOrGuideReader(asked))
      return
    }
    const key = selectChatKey(getState())
    let numbered: string[] = []
    await dispatch(
      streamAnswer(
        paperTag(thread, 'graph'),
        asked,
        async (body, handlers) => {
          const { seed, nodes } = await graphOf(thread)
          numbered = nodes.map((node) => node.id)
          await streamAsk({ ...body, seed, nodes }, handlers)
        },
        {
          onDiscovery: (discovery) => {
            dispatch(backgroundDiscovery(discovery, thread.id))
            for (const node of discovery.nodes)
              if (typeof node.idx === 'number' && node.idx >= 1) numbered[node.idx - 1] = node.id
          },
          onAnswered: (text) => dispatch(graphRefsSet(resolveGraphRefs(text, numbered), key)),
        },
      ),
    )
  }
}
