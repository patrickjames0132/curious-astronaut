"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
AI-teacher routes: one endpoint per agent, each streaming typed events.

POST /api/route        -> which assistant a typed message wants (JSON, not SSE)
POST /api/route/papers -> which graph papers a lecture request named (JSON)
POST /api/lecture      -> streamed AI lecture over the visible graph
POST /api/ask          -> the research agent, streamed over the visible graph
POST /api/ask_sources  -> streamed chat with no graph open (library + search)
POST /api/ask_course   -> the Knowledge Graph's assistant: the researcher,
                          graph-free, over a thread's course (v8.25.0)

Each endpoint validates the request, builds typed inputs, and hands off to
the agent that serves it; the typed event stream comes back as SSE
frames named by each event's ``type`` tag (``model_dump`` minus the tag),
always terminated by ``done`` or ``error``. The client owns the persisted
transcript and sends completed history on every request. Agents receive
history; neither agents nor routes maintain a competing copy.

(This module is ``routes/agents.py``, the route face of the ``agents``
package — a deliberate name-cousin, different full paths.)

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
from typing import Iterable, Iterator

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from pydantic import ValidationError

from ..agents import events, streams
from ..agents.orchestrators import lecturer, researcher, router
from ..config import config
from ..services import search as search_service
from ..services.graph import Node, Provider, resolve_provider
from .sse import sse, sse_response

bp = Blueprint("agents", __name__)

# Module logger, NOT current_app.logger: the SSE generators below run during
# response iteration, after the request/app context is gone — touching
# current_app there raises RuntimeError and kills the stream before the
# `error` event the frontend waits for can be sent.
log = logging.getLogger(__name__)

def _opt_filters(payload: dict, provider: Provider) -> dict:
    """Parse the optional paper-discovery filters from a request body.

    The chat bar carries one set of filters for both of its modes, so the same
    year window and field restriction a direct search would apply also reach
    the researcher — which forwards them to every scout it sends out. They
    scope *discovery* only; citation hops ignore them (see ``ResearcherDeps``).

    Args:
        payload: The parsed JSON body.
        provider: The resolved graph provider, for validating field values
            against the right vocabulary.

    Returns:
        ``{year_from, year_to, fields}`` ready to splat into
        ``researcher.answer``. Absent, blank, or non-numeric years become
        None; unknown field values are dropped.
    """

    def year(name: str) -> int | None:
        """Read one optional year from the payload.

        Args:
            name: The key to read (``year_from`` / ``year_to``).

        Returns:
            The year as an int, or None when absent or unparseable.
        """
        raw = payload.get(name)
        if isinstance(raw, int):
            return raw
        try:
            return int(str(raw).strip())
        except (TypeError, ValueError):
            return None

    raw_fields = payload.get("fields")
    fields = [str(value) for value in raw_fields] if isinstance(raw_fields, list) else []
    return {
        "year_from": year("year_from"),
        "year_to": year("year_to"),
        "fields": search_service.valid_fields(provider, fields),
    }


def _opt_source_ids(payload: dict) -> list[str] | None:
    """Parse the optional ``source_ids`` scope from a request body.

    Args:
        payload: The parsed JSON body.

    Returns:
        The library source ids to scope the answer to. ``None`` when the key
        is absent or malformed — no scope, so the whole library is searched.
        A **present** ``source_ids`` array yields exactly its string entries,
        including an **empty list** — an explicit "no sources selected" that
        searches nothing rather than everything.
    """
    raw = payload.get("source_ids")
    if not isinstance(raw, list):
        return None
    return [source_id for source_id in raw if isinstance(source_id, str) and source_id]


def _opt_quick(payload: dict) -> bool:
    """Whether a request asks for a quick response (v8.30.0).

    Every chat bar's ⚡ Quick response re-asks a question with ``quick: true``:
    the researcher answers with no tools (see ``researcher.answer``). Only a
    literal ``true`` counts, so a stray truthy value can't strip the tools.

    Args:
        payload: The parsed JSON body.

    Returns:
        True only for ``"quick": true``.
    """
    return payload.get("quick") is True


def _node(raw: dict) -> Node:
    """Build a typed ``Node`` from a frontend node payload.

    Strict about the core shape, tolerant about baggage: exactly the model's
    fields are picked out of the dict (the force-graph renderer mutates node
    objects with simulation fields — ``x``, ``vy``, ``index``, ... — and
    ``extra="forbid"`` would reject every real payload), and the graph
    annotations default (``rels``/``is_seed``) since discovered nodes may
    not carry them.

    Args:
        raw: One node dict from the request body.

    Returns:
        The validated ``Node``.

    Raises:
        ValidationError: When the core fields are missing/malformed.
    """
    data = {name: raw[name] for name in Node.model_fields if name in raw}
    data.setdefault("rels", [])
    data.setdefault("is_seed", False)
    return Node.model_validate(data)


def _relay(workflow: Iterable[events.Event]) -> Iterator[str]:
    """Serialize a terminated workflow without storing conversational state.

    Args:
        workflow: Typed events ending in Done or Error.

    Yields:
        SSE frames for the client-owned transcript.
    """
    try:
        for event in workflow:
            yield sse(event.type, event.model_dump(exclude={"type"}))
    except Exception:
        log.exception("agent stream failed")
        yield sse("error", {"message": "The teacher hit an unexpected error."})


@bp.post("/api/route")
def api_route() -> ResponseReturnValue:
    """Say which assistant a typed message wants, before anything is streamed.

    The one endpoint here that is **not** SSE, because it produces a decision
    rather than an answer: the client uses it to pick between
    ``/api/lecture`` and ``/api/ask`` and then streams from the one it picked.
    Two round trips rather than one, deliberately — folding the choice into a
    single streaming endpoint would mean a second implementation of both
    workflows' event relays, to save a few milliseconds on localhost.

    Body:
        ``{message: str}`` — the message as typed, mentions and all.

    Returns:
        ``{target: 'lecture'|'answer', framing: 'summary'|'history', scope:
        'screen'|'references'|'citations'|'seed'|'named'|'graph', year_from: int|null,
        year_to: int|null}``, always HTTP 200.
        A blank message, a missing key, a dead model and an unparseable
        classification all come back as the researcher (see
        ``router.route``): this endpoint sits in front of every message the
        reader sends, so failing it would break asking questions in order to
        protect a routing nicety. ``scope`` is which papers a lecture is
        about, as far as the message says; ``named`` means the message
        pointed at specific papers and ``/api/route/papers`` can say which.
        The years are a period the message limited it to, on top of the scope.
    """
    payload = request.get_json(silent=True) or {}
    message = payload.get("message")
    decision = router.route(message if isinstance(message, str) else "")
    return jsonify(decision.model_dump())


@bp.post("/api/route/papers")
def api_route_papers() -> ResponseReturnValue:
    """Say which of the graph's papers a lecture request named.

    The second half of routing, split out so the graph's paper list crosses
    the wire only for the messages that need it: ``/api/route`` reads the
    message alone, and a client calls this only when it answered ``scope:
    'named'``. Plain JSON like its sibling — a decision, not a stream.

    Body:
        ``{message: str, papers: [{id, title, year?, authors?}]}`` — every
        paper on the graph, in any order. Malformed entries are skipped
        rather than 400-ing the call, since one bad node should not cost the
        reader their lecture.

    Returns:
        ``{ids: [paper id, ...]}`` in the order the message named them, always
        HTTP 200. Empty when nothing matched — and on every failure, for the
        reason ``/api/route`` never fails: the client already has to handle
        "nothing matched", so a dead model is just that case again.
    """
    payload = request.get_json(silent=True) or {}
    message = payload.get("message")
    raw_papers = payload.get("papers")
    papers: list[router.RoutePaper] = []
    for raw in raw_papers if isinstance(raw_papers, list) else []:
        try:
            papers.append(router.RoutePaper.model_validate(raw))
        except ValidationError:
            continue
    ids = router.resolve_papers(message if isinstance(message, str) else "", papers)
    return jsonify({"ids": ids})


@bp.post("/api/lecture")
def api_lecture() -> ResponseReturnValue:
    """Stream a lecture over the reader's scoped graph as SSE ``beat`` events.

    Body:
        ``{seed: {node fields}, nodes: [scoped node objects], framing?:
        summary|history, target?: {node fields}}``. ``nodes`` is the subject
        of the lecture — whatever the reader has on screen after their filters
        and selection — so the route passes it through untouched. ``framing``
        is the reader's one remaining choice (how to tell it, not which papers
        to tell it about); an unknown value falls back to ``summary`` rather
        than 400-ing, since a framing is a preference and refusing the whole
        lecture over one is a worse answer. A ``target`` asks for the bridge
        lecture instead. Since v7.17.0 there is no ``mode``: an old client
        still sending one is ignored rather than refused, since the field no
        longer selects anything.

    Returns:
        An SSE stream of ``beat`` frames ``{heading, text, node_ids}``,
        ending with ``done`` or ``error``. A lecture narrates the scoped
        nodes as-is — it never expands the graph, so no ``trace`` or
        ``discovery`` frames appear. HTTP 400 for missing/malformed nodes.
    """
    payload = request.get_json(silent=True) or {}
    raw_nodes = payload.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        return jsonify({"error": "nodes must be a non-empty list"}), 400
    raw_target = payload.get("target")
    framing: lecturer.Framing = "history" if payload.get("framing") == "history" else "summary"
    try:
        seed = _node(payload.get("seed") or {})
        nodes = [_node(raw) for raw in raw_nodes]
        target = _node(raw_target) if raw_target else None
    except ValidationError:
        return jsonify({"error": "seed/nodes are malformed"}), 400

    return sse_response(
        _relay(
            streams.terminated(
                lecturer.lecture(seed=seed, nodes=nodes, target=target, framing=framing)
            )
        )
    )


#: The most course items laid out for a prompt; a course is a few dozen.
COURSE_ITEMS = 200
#: The open lesson is shown whole up to this many characters…
OPEN_LESSON_CHARS = 12000
#: …and every other written lesson up to this many, its opening.
LESSON_EXCERPT_CHARS = 1200
#: The whole course block's ceiling, lessons included.
COURSE_CHARS = 40000


def _clip(value: object, limit: int) -> str:
    """A string field from the client, or '' when it is not one, cut to a limit.

    Args:
        value: The raw field.
        limit: The most characters kept.

    Returns:
        The string, at most ``limit`` characters.
    """
    return value[:limit] if isinstance(value, str) else ""


def _course_line(item: dict) -> str:
    """One course item as an outline line: its kind, check-off and links.

    Args:
        item: ``{title, kind, known?, needs?: [{title, why}], members?:
            [titles], toward?}`` from the client.

    Returns:
        The line, with an indented line per prerequisite.
    """
    kind = _clip(item.get("kind"), 20) or "concept"
    line = f"- {_clip(item.get('title'), 200)} ({kind})"
    if item.get("known") is True:
        line += " [checked off as known]"
    members = [_clip(member, 200) for member in item.get("members") or []][:12]
    if members:
        line += f": combines {', '.join(members)} toward {_clip(item.get('toward'), 200)}"
    for need in (item.get("needs") or [])[:20]:
        if isinstance(need, dict):
            line += f"\n    needs {_clip(need.get('title'), 200)}: {_clip(need.get('why'), 300)}"
    return line


def _course_context(raw: object, lessons: bool = True) -> str:
    """Lay a Knowledge Graph course out for the researcher's prompt (v8.25.0).

    The client sends the course as structure; the bounds are kept here, as
    for sibling threads, so a large course cannot crowd out the question.

    Args:
        raw: ``{paper, open?, items: [{title, kind, known?, needs?,
            members?, toward?, lesson?}]}``.
        lessons: Include the lessons; False gives the outline alone (a
            course attached from another chat).

    Returns:
        The course block, or '' when ``raw`` is not a course.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        return ""
    items = [item for item in raw["items"][:COURSE_ITEMS] if isinstance(item, dict)]
    block = f"THE COURSE, on the paper {_clip(raw.get('paper'), 300)!r}:\n"
    block += "\n".join(_course_line(item) for item in items)
    if not lessons:
        return block[:COURSE_CHARS]
    opened = _clip(raw.get("open"), 200)
    for item in items:
        if opened and item.get("title") == opened:
            text = _clip(item.get("lesson"), OPEN_LESSON_CHARS)
            block += f"\n\nTHE LESSON THE STUDENT HAS OPEN: {opened}\n"
            block += text or "(not written yet)"
    written = [
        item
        for item in items
        if item.get("title") != opened and isinstance(item.get("lesson"), str) and item["lesson"]
    ]
    if written:
        block += "\n\nOTHER LESSONS WRITTEN SO FAR (their openings):"
        for item in written:
            block += f"\n\n## {_clip(item.get('title'), 200)}\n"
            block += _clip(item.get("lesson"), LESSON_EXCERPT_CHARS)
    return block[:COURSE_CHARS]


def _sibling_context(payload: dict) -> str:
    """Bound explicitly labelled background material from sibling threads.

    Args:
        payload: Request containing an index and optionally mentioned histories.

    Returns:
        A bounded context string; empty when no siblings were supplied.
    """
    raw = payload.get("thread_context")
    if not isinstance(raw, list):
        return ""
    sections: list[str] = []
    remaining = 24000
    for item in raw[:max(0, config.server.history_turns * 2)]:
        if not isinstance(item, dict) or not isinstance(item.get("title"), str):
            continue
        summary = item.get("summary", "")
        summary = summary[:1500] if isinstance(summary, str) else ""
        section = f"From sibling thread {item['title'][:200]!r}:\n{summary}"
        # A Knowledge Graph chat brings its course's outline along (v8.25.0):
        # its turns are about a course, and read poorly without it.
        course = _course_context(item.get("course"), lessons=False)
        if item.get("mentioned") is True and course:
            section += "\nIts course:\n" + course
        if item.get("mentioned") is True:
            turns = _resumed_history(item)
            section += "\nExplicitly attached discussion:\n" + "\n".join(
                f"{turn['role']}: {turn['content']}" for turn in turns
            )
        sections.append(section[:remaining])
        remaining -= len(sections[-1])
        if remaining <= 0:
            break
    return "\n\n".join(sections)


def _resumed_history(payload: dict) -> list[dict]:
    """Validate and cap the completed history supplied by the client.

    Args:
        payload: Request body containing optional role/content turns.

    Returns:
        Valid turns within the configured history window.
    """
    raw = payload.get("history")
    if not isinstance(raw, list):
        return []
    clean = [
        {"role": turn["role"], "content": turn["content"]}
        for turn in raw
        if isinstance(turn, dict)
        and turn.get("role") in {"user", "assistant"}
        and isinstance(turn.get("content"), str)
        and turn["content"].strip()
    ]
    keep = config.server.history_turns * 2
    return clean[-keep:] if keep else []


@bp.post("/api/ask")
def api_ask() -> ResponseReturnValue:
    """Answer a question grounded in the visible graph, streamed as SSE.

    The researcher reads papers via tool use. The client supplies completed
    history for the active thread on every request, including lecture prose.

    Body:
        ``{question, seed, nodes, provider?, source_ids?,
        history?, quick?}`` — ``provider`` (``s2``/``openalex``) matches the
        graph's backend so the researcher's expand/hydrate use it (it has no
        paper search here since v8.28.0, so the bar's filters aren't read);
        ``quick: true`` answers with no tools, now (a quick response,
        v8.30.0; the same on every ``ask`` route);
        ``source_ids`` scopes the library search to a subset of uploaded
        sources. ``history`` is the client's own copy of the conversation,
        validated and bounded by ``_resumed_history`` on every request.

        A ``lectures`` field used to ride along here, carrying every lecture
        the reader had played so the researcher could build on it. It went in
        v7.21.0 with the frontend's lecture slot: a lecture is a chat turn
        now, so it reaches the agent through ``history`` like any other turn.

    Returns:
        An SSE stream: ``trace`` frames (tool steps), ``discovery`` frames
        (papers + edges to merge into the live graph), ``figure`` frames,
        ``token`` prose, one ``cited`` frame (``{node_ids}``), then ``done``
        or ``error``. HTTP 400 when the question or nodes are
        missing/malformed.
    """
    payload = request.get_json(silent=True) or {}
    question = (payload.get("question") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400
    raw_nodes = payload.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        return jsonify({"error": "nodes must be a non-empty list"}), 400
    try:
        seed = _node(payload.get("seed") or {})
        nodes = [_node(raw) for raw in raw_nodes]
    except ValidationError:
        return jsonify({"error": "seed/nodes are malformed"}), 400
    source_ids = _opt_source_ids(payload)
    provider = resolve_provider(payload.get("provider"))
    history = _resumed_history(payload)

    return sse_response(
        _relay(
            streams.terminated(
                researcher.answer(
                    question=question,
                    seed=seed,
                    nodes=nodes,
                    history=history,
                    sibling_context=_sibling_context(payload),
                    source_ids=source_ids,
                    provider=provider,
                    # The Citation Graph assistant works from the graph and
                    # doesn't search papers past it (v8.28.0), so the bar's
                    # paper filters, which only ever bound that search, aren't
                    # read here either.
                    paper_search=False,
                    quick=_opt_quick(payload),
                )
            ),
        )
    )


@bp.post("/api/ask_sources")
def api_ask_sources() -> ResponseReturnValue:
    """Answer a question purely from the user's local library, streamed as SSE.

    The graph-free chat — the same researcher as ``/api/ask``, run with no
    seed and no numbered papers, so it reaches for the library (and, if it
    needs to, Semantic Scholar) through its tools rather than having
    passages pushed at it. History is supplied by the client, just as for
    graph-thread questions.

    Body:
        ``{question, history?, thread_context?, provider?, source_ids?,
        quick?}`` — ``provider``
        (``s2``/``openalex``) is the backend the agent's paper search runs
        against, sent by the header's Data source dropdown exactly as
        ``/api/ask`` does; ``source_ids`` scopes retrieval to a subset of
        sources.

    Returns:
        An SSE stream: a ``source_refs`` frame when a library is in play,
        ``trace`` frames as the agent searches, ``token`` prose interleaved
        with any ``figure`` frames, then ``cited`` + ``provenance``, then
        ``done`` or ``error``. HTTP 400 when the question is missing.
    """
    payload = request.get_json(silent=True) or {}
    question = (payload.get("question") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400
    source_ids = _opt_source_ids(payload)
    # The graph-free chat has no graph to inherit a backend from, so the
    # provider rides on the request like everything else here. Omitting it
    # (as this route did until v6.14.0) doesn't leave the agent backend-less
    # — it silently pins it to the default, which is how a chat under the
    # OpenAlex dropdown ended up searching Semantic Scholar and handing back
    # citations no OpenAlex seed build could resolve.
    provider = resolve_provider(payload.get("provider"))
    history = _resumed_history(payload)

    return sse_response(
        _relay(
            streams.terminated(
                researcher.answer(
                    question=question,
                    history=history,
                    sibling_context=_sibling_context(payload),
                    source_ids=source_ids,
                    provider=provider,
                    quick=_opt_quick(payload),
                    **_opt_filters(payload, provider),
                )
            ),
        )
    )


@bp.post("/api/ask_course")
def api_ask_course() -> ResponseReturnValue:
    """Answer a question about a thread's Knowledge Graph course (v8.25.0).

    The course's own assistant: the same researcher as ``/api/ask_sources``,
    graph-free, with the course laid out where a graph would be (its
    concepts, what each needs, the reader's check-offs, and the lessons
    written so far, the open one whole). Its tools reach the library and the
    web; not the literature, since v8.28.0 (``paper_search=False``).

    Body:
        ``{question, course, history?, thread_context?, provider?,
        source_ids?}`` — ``course`` as ``_course_context`` reads it; the rest
        as for ``/api/ask_sources``.

    Returns:
        An SSE stream as for ``/api/ask_sources``. HTTP 400 when the question
        or the course is missing.
    """
    payload = request.get_json(silent=True) or {}
    question = (payload.get("question") or "").strip()
    if not question:
        return jsonify({"error": "question is required"}), 400
    course = _course_context(payload.get("course"))
    if not course:
        return jsonify({"error": "course is required"}), 400
    provider = resolve_provider(payload.get("provider"))

    return sse_response(
        _relay(
            streams.terminated(
                researcher.answer(
                    question=question,
                    history=_resumed_history(payload),
                    sibling_context=_sibling_context(payload),
                    source_ids=_opt_source_ids(payload),
                    provider=provider,
                    course=course,
                    # Like the Citation Graph assistant's (v8.28.0): the course
                    # is the map here, and finding papers is the General chat's.
                    paper_search=False,
                    quick=_opt_quick(payload),
                )
            ),
        )
    )
