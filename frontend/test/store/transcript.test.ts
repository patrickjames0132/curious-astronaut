/**
 * Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.
 *
 * Description:
 * The transcript slice: turns landing in the right conversation while several
 * stream at once, lectures riding on the turns that hold them, and what
 * survives a graph load.
 *
 * The `lecture` slot's own reducers used to be tested here at length —
 * start/beat/show/hide/drop over one cached lecture per exploration. They are
 * all gone in v7.21.0: a lecture is a turn, so `chatBeatAdded` is the only
 * path and there is no show/hide state to pin.
 *
 * Authors:
 * Charles Patrick James <charles.patrick.james@gmail.com>
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Beat } from '../../src/api'
import workspaceReducer, { workspaceCleared } from '../../src/store/workspace'
import reducer, {
  answerFailed,
  chatBeatAdded,
  conversationModelSet,
  backgroundDiscovery,
  conversationDropped,
  failedTurnDropped,
  pendingDiscoveriesDrained,
  selectConversation,
  selectRunningKeys,
  streamEnded,
  streamStarted,
  conversationStarted,
  traceAdded,
  tracesSettled,
  turnCompleted,
  turnRouted,
  tokenAppended,
  turnStarted,
} from '../../src/store/transcript'
import type { Conversation, TranscriptState } from '../../src/store/transcript'

/** A minimal valid lecture beat; override per test. */
function makeBeat(overrides: Partial<Beat> = {}): Beat {
  return { heading: 'Beat', text: 'A beat.', node_ids: [], ...overrides }
}

/**
 * The conversation on screen.
 *
 * The slice holds several at once now — that is what lets a stream keep
 * writing to its own exploration after the reader moves on — so these tests,
 * which are about what a single conversation does, read through the active one
 * exactly as the panel's selectors do.
 *
 * @param state The slice state.
 * @returns The active conversation.
 */
function active(state: TranscriptState): Conversation {
  return selectConversation({ transcript: state })
}

/**
 * Run a sequence of actions and return the whole slice, for the tests that are
 * about more than one conversation at a time.
 *
 * @param actions The actions to play, in order.
 * @returns The resulting slice state.
 */
function playAll(...actions: Parameters<typeof reducer>[1][]): TranscriptState {
  return actions.reduce(
    (current, action) => reducer(current, action),
    reducer(undefined, { type: '@@init' }),
  )
}

/** Run a sequence of actions through the reducer from the initial state. */
function play(...actions: Parameters<typeof reducer>[1][]): TranscriptState {
  return actions.reduce(
    (state, action) => reducer(state, action),
    reducer(undefined, { type: '@@init' }),
  )
}

/** A `loadGraph.fulfilled` action, as the store would dispatch it. */
function graphLoadedAction() {
  return {
    type: 'workspace/loadGraph/fulfilled',
    payload: {
      seed: { id: 'seed', arxiv_id: null, title: 'Seed' },
      nodes: [],
      edges: [],
      counts: {},
    },
    meta: { arg: { seed: 'seed' }, requestId: 'r', requestStatus: 'fulfilled' },
  } as unknown as Parameters<typeof reducer>[1]
}

describe('transcript survival across a graph load', () => {
  const graphLoaded = graphLoadedAction

  it('keeps the conversation, however the new graph was reached', () => {
    // The chat is the user's: they asked those questions, and loading another
    // graph doesn't say they're done with the answers. Clearing it is theirs
    // to do — the Clear button, or Home. A citation-seeded load and a cold
    // search are the same action here: the `fromChat` flag that once told them
    // apart is gone (v7.11.0), along with the detail panel it opened.
    const state = play(turnStarted('What is new in quantum computing?'), graphLoaded())
    // turnStarted seeds the user turn plus the assistant placeholder.
    expect(active(state).chat).toHaveLength(2)
    expect(active(state).chat[0].text).toBe('What is new in quantum computing?')
  })

  it('keeps a lecture too, now that a lecture is a turn', () => {
    // This **reverses** the pre-v7.21.0 behaviour, and deliberately. A lecture
    // in its own slot was dropped here, on the reasoning that it belonged to
    // the graph whose nodes its beats point at. A lecture in the transcript is
    // one of the reader's turns, and the transcript has always survived a
    // graph load — deleting half of it would be the conversation rewriting
    // itself. The beats degrade instead: their `[n]` chips grey out against
    // the new graph's ids, exactly as an answer's do.
    const state = play(
      turnStarted('lecture me on these'),
      chatBeatAdded(makeBeat({ heading: 'Roots' })),
      graphLoaded(),
    )
    expect(active(state).chat).toHaveLength(2)
    expect(active(state).chat[1].beats?.map((beat) => beat.heading)).toEqual(['Roots'])
  })
})

describe('workspace epoch across a graph load', () => {
  it('holds the epoch steady on a graph load', () => {
    // The shell keys the teacher panel on `epoch`, so a bump remounts it and
    // rebuilds the transcript's scroll container at the top — throwing the
    // reader back to the start of the answer they were reading. Only Home and
    // a session restore remount now.
    const loaded = workspaceReducer(undefined, graphLoadedAction())
    expect(loaded.epoch).toBe(0)
  })
})

describe('conversations run in parallel', () => {
  // The point of keying the slice: a stream started in one exploration keeps
  // writing there after the reader moves to another. Before this, the single
  // conversation meant a running answer had nowhere to write but whatever was
  // now on screen — which is why switching used to abort it outright.
  it('keeps a background answer in its own conversation', () => {
    let state = playAll(turnStarted('Why attention?'))
    const first = state.activeKey

    // The reader starts a new exploration while that answer is still coming.
    state = reducer(state, workspaceCleared({ conversationKey: 'second' }))
    expect(state.activeKey).toBe('second')

    // Tokens from the first exploration's stream, addressed to its own key.
    state = reducer(state, tokenAppended('Because it ', first))
    state = reducer(state, tokenAppended('scales.', first))

    // They landed there, and nothing reached the conversation on screen.
    expect(state.byKey[first].chat[1].text).toBe('Because it scales.')
    expect(active(state).chat).toEqual([])
  })

  it('marks a conversation as running until its last stream ends', () => {
    // The rail reads this to show which explorations are still working, and
    // the autosave reads it to know a background answer has settled.
    let state = playAll(streamStarted('ask:1'), streamStarted('lecture:history:2'))
    const key = state.activeKey
    expect(selectRunningKeys({ transcript: state })).toEqual([key])

    state = reducer(state, streamEnded('ask:1', key))
    expect(selectRunningKeys({ transcript: state })).toEqual([key])

    state = reducer(state, streamEnded('lecture:history:2', key))
    expect(selectRunningKeys({ transcript: state })).toEqual([])
  })

  it('holds a background discovery instead of dropping it on the visible graph', () => {
    // A paper found by one exploration's agent belongs to that exploration's
    // graph. The workspace only holds the active one, so an off-screen find
    // waits here rather than landing on a map it has nothing to do with.
    let state = playAll(turnStarted('Why attention?'))
    const first = state.activeKey
    state = reducer(state, workspaceCleared({ conversationKey: 'second' }))
    state = reducer(
      state,
      backgroundDiscovery({ nodes: [{ id: 'found-1' }], edges: [] } as never, first),
    )

    expect(state.byKey[first].pendingDiscoveries.nodes).toHaveLength(1)
    expect(active(state).pendingDiscoveries.nodes).toEqual([])

    // Opening that exploration takes them.
    state = reducer(state, pendingDiscoveriesDrained(first))
    expect(state.byKey[first].pendingDiscoveries.nodes).toEqual([])
  })

  it('a late write to a deleted conversation lands nowhere', () => {
    // A stream can outlive the exploration the reader deleted; it must not
    // resurrect it as a phantom row.
    let state = playAll(turnStarted('one'))
    const key = state.activeKey
    state = reducer(state, workspaceCleared({ conversationKey: 'second' }))
    state = reducer(state, conversationDropped(key))
    state = reducer(state, tokenAppended('late token', key))

    expect(state.byKey[key]).toBeUndefined()
    expect(active(state).chat).toEqual([])
  })
})

describe('an answer that never arrived', () => {
  it('records the failure on the turn, so it survives a reload', () => {
    // The panel's own error state does not outlive a reload, and a reload is
    // exactly when this is most often seen — the reader comes back to a turn
    // that shows a trace and then simply stops.
    const state = play(turnStarted('Why attention?'), answerFailed('It stopped.'))
    expect(active(state).chat[1].failed).toBe('It stopped.')
  })

  it('leaves a partial answer alone', () => {
    // Prose that did arrive is real work and reads as an answer, not a failure.
    const state = play(
      turnStarted('Why attention?'),
      tokenAppended('Because it scales'),
      answerFailed('It stopped.'),
    )
    expect(active(state).chat[1].failed).toBeUndefined()
    expect(active(state).chat[1].text).toBe('Because it scales')
  })

  it('drops the whole failed exchange when it is retried', () => {
    // Both halves go, so the retry re-runs through the ordinary path and the
    // transcript ends with one exchange rather than a graveyard of attempts.
    const state = play(
      turnStarted('first'),
      tokenAppended('an answer'),
      turnStarted('second'),
      answerFailed('It stopped.'),
      failedTurnDropped(3),
    )
    expect(active(state).chat.map((turn) => turn.text)).toEqual(['first', 'an answer'])
  })

  it('ignores a drop aimed at a turn that did answer', () => {
    const state = play(
      turnStarted('first'),
      tokenAppended('an answer'),
      failedTurnDropped(0), // a user turn, not a failed answer
    )
    expect(active(state).chat).toHaveLength(2)
  })
})

describe('a run that dies mid-step', () => {
  it('stops every chip claiming to be in progress', () => {
    // `pending` drives the spinner and only the *finished* trace clears it, so
    // a run that dies mid-step left chips spinning for a request that no
    // longer exists — under a header already back to saying "2 steps".
    const state = play(
      turnStarted('Explain diffusion models in one paragraph.'),
      traceAdded({ action: 'search', ok: true, pending: true, query: 'diffusion' }),
      traceAdded({ action: 'read', ok: true, title: 'A paper' }),
      tracesSettled(),
    )
    const trace = active(state).chat[1].trace ?? []
    expect(trace[0]).toMatchObject({ pending: false, ok: false })
    // A step that genuinely finished is untouched.
    expect(trace[1]).toMatchObject({ ok: true })
  })
})

describe('a lecture in the transcript', () => {
  it('lands on the assistant turn that is answering', () => {
    const state = play(
      turnStarted('lecture me on these'),
      chatBeatAdded(makeBeat({ heading: 'A' })),
    )
    const conversation = active(state)
    expect(conversation.chat[1].role).toBe('assistant')
    expect(conversation.chat[1].beats?.map((beat) => beat.heading)).toEqual(['A'])
  })

  it("keeps each turn's beats to itself, so a second lecture does not overwrite the first", () => {
    const state = play(
      turnStarted('lecture me on these'),
      chatBeatAdded(makeBeat({ heading: 'First' })),
      turnStarted('now the history'),
      chatBeatAdded(makeBeat({ heading: 'Second' })),
    )
    const chat = active(state).chat
    expect(chat[1].beats?.map((beat) => beat.heading)).toEqual(['First'])
    expect(chat[3].beats?.map((beat) => beat.heading)).toEqual(['Second'])
  })

  it('records which assistant the router picked, so the turn can offer the other', () => {
    const state = play(turnStarted('teach me these'), turnRouted('lecture'))
    expect(active(state).chat[1].routedTo).toBe('lecture')
  })

  it('leaves routedTo unset when nothing routed the turn', () => {
    // A reader correcting a route: no decision was made on their behalf, so
    // the transcript must not offer to undo one.
    const state = play(turnStarted('what is attention?'))
    expect(active(state).chat[1].routedTo).toBeUndefined()
  })

  it('addresses the conversation that asked, like every other streaming action', () => {
    // The reader started another exploration and is looking at that one; the
    // beats still have to land where the message was sent.
    // Generated by the slice, so a test can't hardcode it.
    const asked = playAll().activeKey
    const state = playAll(
      turnStarted('lecture me'),
      conversationStarted('later'),
      chatBeatAdded(makeBeat({ heading: 'Background' }), asked),
    )
    expect(state.activeKey).toBe('later')
    expect(state.byKey[asked].chat[1].beats?.length).toBe(1)
    expect(state.byKey.later.chat).toEqual([])
  })
})

describe("an answer's response timer (v8.33.0)", () => {
  afterEach(() => vi.restoreAllMocks())

  /** Dispatch `make()`'s action as if at `when` ms, since it stamps Date.now(). */
  function at<Action>(when: number, make: () => Action): Action {
    vi.spyOn(Date, 'now').mockReturnValue(when)
    const action = make()
    vi.restoreAllMocks()
    return action
  }

  it('starts with the turn and keeps how long it took once complete', () => {
    let state = playAll(at(1000, () => turnStarted('why?')))
    const answer = () => active(state).chat[1]
    expect(answer().startedAt).toBe(1000)
    expect(answer().respondedIn).toBeUndefined()
    state = reducer(
      state,
      at(13_500, () => turnCompleted()),
    )
    expect(answer().respondedIn).toBe(12_500)
    // The start goes once there is a time: the saved turn carries the answer.
    expect(answer().startedAt).toBeUndefined()
  })

  it('preserves an explicit original start, including zero, for a continued answer', () => {
    const state = playAll(
      at(12_000, () => turnStarted('quick answer', undefined, 0)),
      at(15_000, () => turnCompleted()),
    )
    expect(active(state).chat[1].respondedIn).toBe(15_000)
  })

  it('marks Quick response immediately and retains the label after completion', () => {
    let state = playAll(turnStarted('quick answer', undefined, 1000, true))
    expect(active(state).chat[1].text).toBe('')
    expect(active(state).chat[1].quickResponse).toBe(true)
    state = reducer(state, turnCompleted())
    expect(active(state).chat[1].quickResponse).toBe(true)
    state = reducer(state, turnStarted('ordinary question'))
    expect(active(state).chat[3].quickResponse).toBeUndefined()
  })

  it('gives each answer its own clock', () => {
    const state = playAll(
      at(0, () => turnStarted('first?')),
      at(900, () => turnCompleted()),
      at(2000, () => turnStarted('second?')),
      at(5000, () => turnCompleted()),
    )
    const answers = active(state).chat.filter((turn) => turn.role === 'assistant')
    expect(answers.map((turn) => turn.respondedIn)).toEqual([900, 3000])
  })

  it('shows no time for an answer that failed', () => {
    const state = playAll(
      at(0, () => turnStarted('why?')),
      answerFailed('This answer stopped before it finished.'),
    )
    expect(active(state).chat[1].respondedIn).toBeUndefined()
  })
})

describe('the chat bar model pick (v8.33.0)', () => {
  it('belongs to its conversation, and null goes back to the Settings default', () => {
    let state = playAll(conversationModelSet('openai:gpt-test'))
    expect(active(state).model).toBe('openai:gpt-test')
    state = reducer(state, conversationStarted('other'))
    expect(active(state).model).toBeUndefined()
    state = reducer(state, conversationModelSet(null, Object.keys(state.byKey)[0]))
    expect(Object.values(state.byKey).every((conversation) => !conversation.model)).toBe(true)
  })
})
