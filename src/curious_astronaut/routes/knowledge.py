"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The knowledge network's two routes (Phase 5b): expand one course item into
the concepts it needs, and stream one item's lesson. Both are thin over the
``tutor`` agent. What lives here is the grounding (fetching the paper's real
reference list, which informs the paper's expansion; lessons stopped citing
it in v8.17.0) and the caching.

**Both results are cached permanently**, like generated TL;DRs: a lesson on
Bellman equations under DQN is the same lesson tomorrow, and a reader
re-opening a course should never pay for it twice. The cache keys include the
tutor's two knobs, so changing ``children`` or ``lesson_words`` in settings
misses the old entries instead of serving lessons written to the old length.
The reader's "ALREADY IN THE COURSE" list is deliberately *not* in the key:
it only nudges naming, and the frontend merges repeats by name either way.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Iterator

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue
from pydantic import ValidationError

from ..agents import events, factory, streams, traversal
from ..agents.orchestrators import tutor
from ..storage import cache
from .sse import sse, sse_response

log = logging.getLogger(__name__)

bp = Blueprint("knowledge", __name__)

REFERENCE_LIMIT = 40
"""How much of a paper's reference list the tutor sees. Enough for a
landmark's real prerequisites (the list is ranked most-cited first); more
only adds prompt tokens the model has to read past."""

_REFERENCE_FIELDS = ("id", "title", "year", "url")
"""What the tutor needs from a reference: a title to read and number, and the
id and url a lesson citation resolves to."""


def _digest(payload: Any) -> str:
    """A short, stable hash of a JSON-able payload, for a cache key.

    Args:
        payload: Anything ``json.dumps`` accepts.

    Returns:
        16 hex characters.
    """
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def _steps(raw: Any) -> list[tutor.Step]:
    """Validate the client's course path.

    Args:
        raw: The ``path`` field: a list of ``{title, kind}``.

    Returns:
        The path, root first.

    Raises:
        ValidationError: When an entry is malformed.
        TypeError: When ``raw`` is not a list.
    """
    if not isinstance(raw, list):
        raise TypeError("path must be a list")
    return [tutor.Step.model_validate(step) for step in raw]


def _references(paper_id: str, provider: str) -> list[dict]:
    """The paper's reference list as trimmed node dicts, or [] when unavailable.

    A failed fetch degrades to a concepts-only expansion rather than an
    error: the reader still gets a course, just without paper nodes.

    Args:
        paper_id: The provider's id for the paper.
        provider: ``s2`` or ``openalex``.

    Returns:
        Up to ``REFERENCE_LIMIT`` reference nodes, most-cited first.
    """
    try:
        hits = traversal.neighbors(
            paper_id,
            "references",
            REFERENCE_LIMIT,
            "openalex" if provider == "openalex" else "s2",
        )
    except Exception:
        log.warning("reference fetch failed for %s (%s)", paper_id, provider, exc_info=True)
        return []
    return [
        {field: hit["node"].get(field) for field in _REFERENCE_FIELDS}
        for hit in hits
        if hit.get("node", {}).get("title")
    ]


@bp.post("/api/knowledge/expand")
def api_expand() -> ResponseReturnValue:
    """Break one course item into its prerequisites.

    Body:
        ``{item: {title, kind, paper_id?}, path: [{title, kind}], existing:
        [names], provider?}``. ``paper_id`` is the provider id of the paper
        item (the course's root); with it, the tutor sees the paper's
        reference list when judging which ideas it builds on. ``existing``
        lists names already in the course.

    Returns:
        ``{children: [{name, why}]}``; HTTP 400 for a malformed body, 502 when
        the model fails.
    """
    payload = request.get_json(silent=True) or {}
    raw_item = payload.get("item") or {}
    try:
        item = tutor.Step.model_validate(
            {"title": raw_item.get("title"), "kind": raw_item.get("kind")}
        )
        path = _steps(payload.get("path") or [])
    except (ValidationError, TypeError):
        return jsonify({"error": "item/path are malformed"}), 400
    paper_id = raw_item.get("paper_id") if item.kind == "paper" else None
    provider = payload.get("provider") or "s2"
    existing = [name for name in payload.get("existing") or [] if isinstance(name, str)][:200]

    children_knob = factory.agent_entry("tutor").extras["children"]
    key = "tutor:expand:v2:" + _digest(
        [provider, children_knob, item.model_dump(), paper_id, [step.model_dump() for step in path]]
    )
    cached = cache.get(key)
    if cached is not None:
        return jsonify({"children": cached})

    references = _references(str(paper_id), provider) if paper_id else []
    try:
        children = tutor.expand(item, path, references, existing)
    except Exception:
        log.exception("tutor expansion failed for %r", item.title)
        return jsonify({"error": "The tutor couldn't break this down — try again."}), 502
    dumped = [child.model_dump() for child in children]
    cache.set(key, dumped)
    return jsonify({"children": dumped})


@bp.post("/api/knowledge/lesson")
def api_lesson() -> ResponseReturnValue:
    """Stream one course item's lesson as SSE ``token`` events.

    Body:
        ``{item: {title, kind}, why?, path: [{title, kind}], abstract?,
        paper_id?}``. ``paper_id`` is the course's paper; it only keys the
        cache. Lessons no longer cite the reference list (v8.17.0), so none is
        fetched here.

    Returns:
        An SSE stream of ``token`` frames, then ``done`` or ``error``. A
        cached lesson arrives as one ``token``. HTTP 400 for a malformed body.
    """
    payload = request.get_json(silent=True) or {}
    raw_item = payload.get("item") or {}
    try:
        item = tutor.Step.model_validate(
            {"title": raw_item.get("title"), "kind": raw_item.get("kind")}
        )
        path = _steps(payload.get("path") or [])
    except (ValidationError, TypeError):
        return jsonify({"error": "item/path are malformed"}), 400
    why = str(payload.get("why") or "")
    abstract = str(payload.get("abstract") or "")
    paper_id = payload.get("paper_id")

    words = factory.agent_entry("tutor").extras["lesson_words"]
    # v3: lessons without citations. A v2 entry still holds `[n]` markers.
    key = "tutor:lesson:v3:" + _digest(
        [words, item.model_dump(), why, [step.model_dump() for step in path], paper_id]
    )
    cached = cache.get(key)

    def stream() -> Iterator[str]:
        """Relay the lesson, caching it once it finished cleanly.

        Yields:
            SSE frames.
        """
        if isinstance(cached, dict) and isinstance(cached.get("text"), str):
            yield sse("token", {"text": cached["text"]})
            yield sse("done", {})
            return
        written: list[str] = []
        try:
            for event in streams.terminated(tutor.lesson(item, why, path, abstract)):
                if isinstance(event, events.Token):
                    written.append(event.text)
                elif isinstance(event, events.Done) and written:
                    cache.set(key, {"text": "".join(written)})
                yield sse(event.type, event.model_dump(exclude={"type"}))
        except Exception:
            log.exception("lesson stream failed")
            yield sse("error", {"message": "The tutor hit an unexpected error."})

    return sse_response(stream())
