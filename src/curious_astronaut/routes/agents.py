"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The assistant's routes: one for every view, streaming typed events (v9.0.0).

POST /api/assistant/route        -> which workflow a typed message wants, in
                                    the view it was typed in (JSON, not SSE)
POST /api/assistant/route/papers -> which graph papers a lecture request named (JSON)
POST /api/assistant/route/place  -> what a message is about: here, General, or
                                    another of the exploration's papers (JSON)
POST /api/assistant              -> the workflow, streamed: an answer, a
                                    lecture over the graph, or a guided read

Until v9.0.0 there was a route per assistant and per workflow (``/api/ask``,
``ask_sources``, ``ask_course``, ``ask_reader``, ``lecture``,
``guide_reader``, and ``route`` / ``route_reader``). They differed in what the
view lent the model and which tools it allowed, which is the
``agents.orchestrators.assistant`` package's business now; these routes
validate, relay and set status codes. The event stream comes back as SSE
frames named by each event's ``type`` tag (``model_dump`` minus the tag),
always terminated by ``done`` or ``error``. The client owns the persisted
transcript and sends completed history on every request.

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
from ..agents.orchestrators import assistant, router
from .sse import sse, sse_response

bp = Blueprint("agents", __name__)

# Module logger, NOT current_app.logger: the SSE generators below run during
# response iteration, after the request/app context is gone — touching
# current_app there raises RuntimeError and kills the stream before the
# `error` event the frontend waits for can be sent.
log = logging.getLogger(__name__)


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


@bp.post("/api/assistant/route")
def api_assistant_route() -> ResponseReturnValue:
    """Say which workflow a typed message wants, before anything is streamed.

    Not SSE, because it produces a decision rather than an answer: the client
    may have work to do between the two. On the Citation Graph a lecture's
    scope is resolved against the graph on screen, which only the client
    holds, so the decision and the stream stay two round trips.

    Body:
        ``{message: str, view: {kind}}`` — the message as typed, mentions and
        all, and the view it was typed in.

    Returns:
        ``{workflow: 'answer'|'lecture'|'guide', framing, scope, year_from,
        year_to}`` (``assistant.AssistantRoute``), always HTTP 200. A blank
        message, an unknown view, a dead model and an unparseable
        classification all answer: this sits in front of every message the
        reader sends, so failing it would break asking questions in order to
        protect a routing nicety. ``scope`` and the years are which papers a
        lecture is about, as far as the message says; ``named`` means
        ``/api/assistant/route/papers`` can say which.
    """
    payload = request.get_json(silent=True) or {}
    message = payload.get("message")
    decision = assistant.route(
        message if isinstance(message, str) else "", assistant.view_kind(payload.get("view"))
    )
    return jsonify(decision.model_dump())


@bp.post("/api/assistant/route/papers")
def api_assistant_route_papers() -> ResponseReturnValue:
    """Say which of the graph's papers a lecture request named.

    The second half of routing on the Citation Graph, split out so the
    graph's paper list crosses the wire only for the messages that need it:
    ``/api/assistant/route`` reads the message alone, and a client calls this
    only when it answered ``scope: 'named'``.

    Body:
        ``{message: str, papers: [{id, title, year?, authors?}]}`` — every
        paper on the graph, in any order. Malformed entries are skipped
        rather than 400-ing the call, since one bad node should not cost the
        reader their lecture.

    Returns:
        ``{ids: [paper id, ...]}`` in the order the message named them, always
        HTTP 200. Empty when nothing matched — and on every failure, since the
        client already has to handle "nothing matched".
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


@bp.post("/api/assistant/route/place")
def api_assistant_route_place() -> ResponseReturnValue:
    """Say what a message is about, before it is asked (v9.0.0, stage 4b).

    The view on screen, no view (General), or another of the exploration's
    papers and which of its tools; the answer is the question's tag, and the
    view it names is the one whose context the answer gets. The client asks
    only when the exploration has another paper the message could mean.

    Body:
        ``{message: str, papers: [title, ...], screen: {paper: n|null, tool:
        'graph'|'knowledge'|'reader'|null}}`` — the exploration's papers, the
        open one's number in that list (from 1), and its view.

    Returns:
        ``{place: 'here'|'general'|'paper'|'papers', paper: n|null, tool,
        papers: [n, ...]}`` (``router.PlaceRoute``; ``papers`` lists a
        bridge question's papers), always HTTP 200: every failure, and every
        malformed body, keeps the question where it was asked.
    """
    payload = request.get_json(silent=True) or {}
    message = payload.get("message")
    raw_papers = payload.get("papers")
    papers = [title for title in raw_papers if isinstance(title, str)] if isinstance(raw_papers, list) else []
    raw_screen = payload.get("screen")
    screen: dict = raw_screen if isinstance(raw_screen, dict) else {}
    paper = screen.get("paper")
    tool = screen.get("tool")
    decision = router.route_place(
        message if isinstance(message, str) else "",
        papers,
        screen_paper=paper if isinstance(paper, int) and not isinstance(paper, bool) else None,
        screen_tool=tool if isinstance(tool, str) else None,
    )
    return jsonify(decision.model_dump())


@bp.post("/api/assistant")
def api_assistant() -> ResponseReturnValue:
    """Run what a message asked for, in the view it was asked from, as SSE.

    Body:
        ``{workflow?, question?, view: {kind, ...}, provider?, source_ids?,
        history?, thread_context?, quick?, model?}`` — see
        ``assistant.run``; each view's own fields are listed in the assistant
        package's README.

    Returns:
        An SSE stream ending in ``done`` or ``error``. An answer sends
        ``trace``, ``discovery`` (on the Citation Graph), ``figure``,
        ``source_refs``, ``token``, ``cited``, ``paper_refs`` and
        ``provenance`` frames; a lecture or a guided read sends ``beat``
        frames (a lecture may lead with ``source_refs``). HTTP 400, with
        ``{error}``, for an unknown view, a workflow the view doesn't offer,
        or a view missing what its workflow needs.
    """
    payload = request.get_json(silent=True) or {}
    try:
        workflow = assistant.run(payload)
    except assistant.RequestError as error:
        return jsonify({"error": str(error)}), 400
    return sse_response(_relay(streams.terminated(workflow)))
