"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The knowledge network's routes (Phase 5b): expand one course item into
the concepts it needs, stream one item's lesson, and since v8.23.0 name a
**synthesis** (several concepts synthesized toward the item they build
toward) and stream its lesson. Since v8.24.0 a lesson is written with
inline images unless the reader asks for a quick response, and a web image
it placed is served here (``/api/web_image/<handle>``). All are thin over the ``tutor`` agent. What lives here is the grounding (fetching the paper's real
reference list, which informs the paper's expansion; lessons stopped citing
it in v8.17.0) and the caching.

Since v8.25.0 it also names the concept behind a passage the reader
highlighted in a lesson (``/api/knowledge/phrase``, the lesson's "Expand"),
and since v8.44.0 finds where in the paper each of the course's concepts is
needed (``/api/knowledge/place``), for the Reader's margin notes.
The course's assistant, which answers over the course, is an ask route and
lives with the others in ``routes/agents.py``.

**Both results are cached permanently**, like generated TL;DRs: a lesson on
Bellman equations under DQN is the same lesson tomorrow, and a reader
re-opening a course should never pay for it twice. The cache keys include the
tutor's two knobs, so changing ``children`` or ``lesson_words`` in settings
misses the old entries instead of serving lessons written to the old length.
A breakdown asked for ``fresh`` (v8.23.0, "Break it down again") is the one
way past the cache: it writes over its entry. There is no TTL on purpose.
The reader's "ALREADY IN THE COURSE" list is deliberately *not* in the key:
it only nudges naming, and the frontend merges repeats by name either way.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any, Iterator, Literal

from flask import Blueprint, Response, jsonify, request
from flask.typing import ResponseReturnValue
from pydantic import ValidationError

from ..agents import events, factory, streams, traversal
from ..agents.orchestrators import tutor
from ..integrations import arxiv
from ..services.graph import Provider
from ..services.reader import sections as sections_service
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


#: The most items needing a subject that a lesson is told about.
NEEDS_LIMIT = 20


def _needs(raw: Any) -> list[tutor.Need]:
    """Validate the items that need a lesson's subject (v8.23.0).

    Args:
        raw: The ``needed_by`` field: a list of ``{title, kind, why}``, or
            nothing.

    Returns:
        The items, sorted by title so the same set keys the same cache entry
        whatever order it came in, and capped at ``NEEDS_LIMIT``.

    Raises:
        ValidationError: When an entry is malformed.
        TypeError: When ``raw`` is present but not a list.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise TypeError("needed_by must be a list")
    needs = [tutor.Need.model_validate(need) for need in raw[:NEEDS_LIMIT]]
    return sorted(needs, key=lambda need: (need.title, need.kind))


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
        [names], provider?, fresh?}``. ``paper_id`` is the provider id of the paper
        item (the course's root); with it, the tutor sees the paper's
        reference list when judging which ideas it builds on. ``existing``
        lists names already in the course. ``fresh`` (v8.23.0, "Break it
        down again") skips the cached breakdown and replaces it, so a redo
        costs one call on purpose and later opens see the new one.

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
    fresh = payload.get("fresh") is True

    children_knob = factory.agent_entry("tutor").extras["children"]
    key = "tutor:expand:v2:" + _digest(
        [provider, children_knob, item.model_dump(), paper_id, [step.model_dump() for step in path]]
    )
    cached = None if fresh else cache.get(key)
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


#: The longest highlighted passage the tutor is shown: a phrase or a few
#: sentences. A reader who selects a whole lesson gets its opening.
PHRASE_LIMIT = 1200


@bp.post("/api/knowledge/phrase")
def api_phrase() -> ResponseReturnValue:
    """Name the concept behind a passage highlighted in a lesson (v8.25.0).

    The lesson's "Expand": the frontend hangs the concept under the lesson's
    item as a breakdown would, so a concept already in the course gets an
    edge rather than a second node.

    Body:
        ``{phrase, item: {title, kind}, path: [{title, kind}], existing:
        [names], paper_id?}``. ``paper_id`` only keys the cache.

    Returns:
        ``{child: {name, why}}``, or ``{child: null}`` when the passage names
        the lesson's own subject or an item above it; HTTP 400 for a
        malformed body, 502 when the model fails.
    """
    payload = request.get_json(silent=True) or {}
    phrase = " ".join(str(payload.get("phrase") or "").split())[:PHRASE_LIMIT]
    raw_item = payload.get("item") or {}
    try:
        item = tutor.Step.model_validate(
            {"title": raw_item.get("title"), "kind": raw_item.get("kind")}
        )
        path = _steps(payload.get("path") or [])
    except (ValidationError, TypeError):
        return jsonify({"error": "item/path are malformed"}), 400
    if not phrase:
        return jsonify({"error": "phrase is required"}), 400
    existing = [name for name in payload.get("existing") or [] if isinstance(name, str)][:200]

    key = "tutor:phrase:v1:" + _digest(
        [phrase, item.model_dump(), [step.model_dump() for step in path], payload.get("paper_id")]
    )
    cached = cache.get(key)
    if isinstance(cached, dict) and "child" in cached:
        return jsonify(cached)
    try:
        child = tutor.name_phrase(phrase, item, path, existing)
    except Exception:
        log.exception("phrase naming failed for %r", phrase[:80])
        return jsonify({"error": "The tutor couldn't expand this — try again."}), 502
    result = {"child": child.model_dump() if child else None}
    cache.set(key, result)
    return jsonify(result)


def _pictures(payload: dict) -> tutor.Pictures | None:
    """What a lesson written with images needs, or None for a quick response.

    Args:
        payload: The request body: ``quick``, ``paper: {id, arxiv_id?,
            title}``, ``provider``.

    Returns:
        The tutor's ``Pictures``; None when ``quick`` is set or the tutor's
        ``images`` knob is 0.
    """
    if payload.get("quick") is True or factory.agent_entry("tutor").extras["images"] <= 0:
        return None
    raw_paper = payload.get("paper")
    paper: dict = raw_paper if isinstance(raw_paper, dict) else {}
    provider: Provider = "openalex" if payload.get("provider") == "openalex" else "s2"
    return tutor.Pictures(
        paper_ref=str(paper.get("arxiv_id") or paper.get("id") or ""),
        paper_title=str(paper.get("title") or ""),
        provider=provider,
    )


def _with_images(pictures: tutor.Pictures | None) -> list[Any]:
    """The part of a lesson's cache key that says how it was written.

    A quick lesson and one with images are different lessons: the first
    must not be served when images are wanted, nor the second for a quick
    response. ``images`` and ``min_images`` are in it so a new cap or floor
    misses the old lessons.

    Args:
        pictures: The lesson's ``Pictures``, or None for a quick response.

    Returns:
        ``[]`` for a quick lesson (its key is the one quick lessons always
        had, so lessons written before v8.24.0 still serve), else the knobs
        and the paper.
    """
    if pictures is None:
        return []
    # "lead" (v8.32.0): lessons cached before lead images can't be served as
    # ones that open on their subject's picture.
    extras = factory.agent_entry("tutor").extras
    return ["images", "lead", extras["images"], extras["min_images"], pictures.paper_ref]


def _relay(key: str, cached: Any, lesson: Iterator[tutor.LessonEvent]) -> Iterator[str]:
    """Stream a lesson as SSE, or replay its cached copy; cache it once clean.

    Args:
        key: Its cache key.
        cached: What the cache holds under it (None for a miss, or a fresh
            write).
        lesson: The tutor's stream, started only on a miss.

    Yields:
        ``token`` frames, with images ``step`` and ``image`` frames, then
        ``done``; or ``error``. A cached lesson is one ``token`` and its
        ``image`` frames.
    """
    if isinstance(cached, dict) and isinstance(cached.get("text"), str):
        yield sse("token", {"text": cached["text"]})
        for placed in cached.get("images") or []:
            yield sse("image", placed)
        yield sse("done", {})
        return
    written: list[str] = []
    placed_images: list[dict] = []
    try:
        for event in streams.terminated(lesson):
            if isinstance(event, events.Token):
                written.append(event.text)
            elif isinstance(event, tutor.images.LessonImage):
                placed_images.append(event.model_dump(exclude={"type"}))
            elif isinstance(event, events.Done) and written:
                cache.set(key, {"text": "".join(written), "images": placed_images})
            yield sse(event.type, event.model_dump(exclude={"type"}))
    except Exception:
        log.exception("lesson stream failed")
        yield sse("error", {"message": "The tutor hit an unexpected error."})


@bp.post("/api/knowledge/lesson")
def api_lesson() -> ResponseReturnValue:
    """Stream one course item's lesson as SSE ``token`` events.

    Body:
        ``{item: {title, kind}, why?, path: [{title, kind}], needed_by?:
        [{title, kind, why}], abstract?, paper_id?}``. ``paper_id`` is the
        course's paper; it only keys the cache. ``fresh`` (v8.23.0, after a
        "Break it down again") skips the cached lesson and replaces it.
        ``needed_by`` (v8.23.0) is
        every item that needs the subject, for the lesson's closing "How it
        fits in" section. Lessons no longer cite the reference list (v8.17.0),
        so none is fetched here. Since v8.24.0 a lesson is written **with
        images** unless ``quick`` is set: ``paper: {id, arxiv_id?, title}``
        and ``provider`` tell its image tools where the course paper's
        figures are.

    Returns:
        An SSE stream of ``token`` frames (with images, ``step`` frames, one
        status line each, and an ``image`` frame per image placed), then
        ``done`` or ``error``. A cached lesson arrives as one ``token`` and
        its ``image`` frames. HTTP 400 for a malformed body.
    """
    payload = request.get_json(silent=True) or {}
    raw_item = payload.get("item") or {}
    try:
        item = tutor.Step.model_validate(
            {"title": raw_item.get("title"), "kind": raw_item.get("kind")}
        )
        path = _steps(payload.get("path") or [])
        needed_by = _needs(payload.get("needed_by"))
    except (ValidationError, TypeError):
        return jsonify({"error": "item/path are malformed"}), 400
    why = str(payload.get("why") or "")
    abstract = str(payload.get("abstract") or "")
    paper_id = payload.get("paper_id")

    words = factory.agent_entry("tutor").extras["lesson_words"]
    pictures = _pictures(payload)
    # v4: lessons end with a marked "How it fits in" section covering every
    # item that needs them (v8.23.0). A v3 entry has no such section.
    key = "tutor:lesson:v4:" + _digest(
        [
            words,
            item.model_dump(),
            why,
            [step.model_dump() for step in path],
            [need.model_dump() for need in needed_by],
            paper_id,
            *_with_images(pictures),
        ]
    )
    cached = None if payload.get("fresh") is True else cache.get(key)
    if isinstance(cached, dict) and isinstance(cached.get("text"), str):
        return sse_response(_relay(key, cached, iter([])))
    return sse_response(
        _relay(key, None, tutor.lesson(item, why, path, abstract, needed_by, pictures))
    )


@bp.post("/api/knowledge/fit")
def api_fit() -> ResponseReturnValue:
    """Rewrite only a lesson's closing "How it fits in" section (v8.23.0).

    A lesson is written once. When the items that need its subject change
    later (another breakdown makes it a shared prerequisite, or one is
    deleted), the panel asks for this one section again rather than the
    whole lesson.

    Body:
        ``{item: {title, kind}, lesson: "<the lesson without its section>",
        needed_by: [{title, kind, why}], paper_id?}``.

    Returns:
        ``{text}``, the section's body without its heading; cached on the
        subject, the lesson and the needing set, so the same change never
        bills twice. HTTP 400 for a malformed body or nothing needing it, 502
        when the model fails.
    """
    payload = request.get_json(silent=True) or {}
    raw_item = payload.get("item") or {}
    try:
        item = tutor.Step.model_validate(
            {"title": raw_item.get("title"), "kind": raw_item.get("kind")}
        )
        needed_by = _needs(payload.get("needed_by"))
    except (ValidationError, TypeError):
        return jsonify({"error": "item/needed_by are malformed"}), 400
    body = str(payload.get("lesson") or "").strip()
    if not body or not needed_by:
        return jsonify({"error": "a lesson and what needs it are required"}), 400

    key = "tutor:fit:v1:" + _digest(
        [
            item.model_dump(),
            body,
            [need.model_dump() for need in needed_by],
            payload.get("paper_id"),
        ]
    )
    cached = cache.get(key)
    if isinstance(cached, str):
        return jsonify({"text": cached})
    try:
        text = tutor.fit_section(item, body, needed_by)
    except Exception:
        log.exception("fit section failed for %r", item.title)
        return jsonify({"error": "The tutor couldn't update how this fits in — try again."}), 502
    cache.set(key, text)
    return jsonify({"text": text})


def _synthesis_body(payload: dict) -> tuple[list[tutor.Step], tutor.Step, list[tutor.Step]]:
    """Validate a synthesis request's concepts, target and path.

    Args:
        payload: The JSON body: ``{members: [{title, kind}], toward: {title,
            kind}, path: [{title, kind}]}``.

    Returns:
        The members (two or more), the item they build toward, and the
        course path above it.

    Raises:
        ValidationError: When an entry is malformed.
        TypeError: When a list is not a list, or fewer than two members came.
    """
    members = _steps(payload.get("members"))
    if len(members) < 2:
        raise TypeError("a synthesis needs two or more members")
    toward = tutor.Step.model_validate(payload.get("toward") or {})
    return members[:12], toward, _steps(payload.get("path") or [])


def _synthesis_key(kind: str, payload: list[Any]) -> str:
    """A synthesis cache key. Members are sorted: the same group is the same synthesis.

    Args:
        kind: ``name`` or ``lesson``.
        payload: What else identifies it.

    Returns:
        The cache key.
    """
    return f"tutor:synthesis:{kind}:v1:" + _digest(payload)


@bp.post("/api/knowledge/synthesis")
def api_synthesis() -> ResponseReturnValue:
    """Name a synthesis: what several concepts become together (v8.23.0).

    Body:
        ``{members: [{title, kind}], toward: {title, kind}, path: [{title,
        kind}], paper_id?}``. ``paper_id`` only keys the cache.

    Returns:
        ``{name, why}``; HTTP 400 for a malformed body, 502 when the model
        fails.
    """
    payload = request.get_json(silent=True) or {}
    try:
        members, toward, path = _synthesis_body(payload)
    except (ValidationError, TypeError):
        return jsonify({"error": "members/toward/path are malformed"}), 400
    key = _synthesis_key(
        "name",
        [
            sorted(member.title for member in members),
            toward.model_dump(),
            [step.model_dump() for step in path],
            payload.get("paper_id"),
        ],
    )
    cached = cache.get(key)
    if isinstance(cached, dict):
        return jsonify(cached)
    try:
        named = tutor.name_synthesis(members, toward, path)
    except Exception:
        log.exception("synthesis naming failed for %r", [member.title for member in members])
        return jsonify({"error": "The tutor couldn't synthesize these — try again."}), 502
    if not named.name:
        return jsonify({"error": "The tutor couldn't synthesize these — try again."}), 502
    dumped = named.model_dump()
    cache.set(key, dumped)
    return jsonify(dumped)


@bp.post("/api/knowledge/synthesis/lesson")
def api_synthesis_lesson() -> ResponseReturnValue:
    """Stream a synthesis's lesson as SSE ``token`` events (v8.23.0).

    Body:
        ``{name, members: [{title, kind}], toward: {title, kind}, path:
        [{title, kind}], paper_id?}``, and since v8.24.0 ``quick``, ``paper``
        and ``provider`` as for a lesson (written with images unless quick),
        and ``fresh`` to skip the cached copy and replace it.

    Returns:
        An SSE stream as for a lesson: ``token``, with images ``step`` and
        ``image`` frames, then ``done`` or ``error``; a cached lesson arrives
        as one ``token`` and its ``image`` frames. HTTP 400 for a malformed body.
    """
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name") or "").strip()
    try:
        members, toward, path = _synthesis_body(payload)
    except (ValidationError, TypeError):
        return jsonify({"error": "members/toward/path are malformed"}), 400
    if not name:
        return jsonify({"error": "name is required"}), 400

    words = factory.agent_entry("tutor").extras["lesson_words"]
    pictures = _pictures(payload)
    key = _synthesis_key(
        "lesson",
        [
            words,
            name,
            sorted(member.title for member in members),
            toward.model_dump(),
            [step.model_dump() for step in path],
            payload.get("paper_id"),
            *_with_images(pictures),
        ],
    )
    # ``fresh`` (v8.24.0, ↻ "Rewrite this lesson") skips the cached copy and replaces it.
    cached = None if payload.get("fresh") is True else cache.get(key)
    if isinstance(cached, dict) and isinstance(cached.get("text"), str):
        return sse_response(_relay(key, cached, iter([])))
    return sse_response(
        _relay(key, None, tutor.synthesis_lesson(name, members, toward, path, pictures))
    )


#: The most concepts one placement reads (a course rarely nears it).
PLACE_CONCEPTS = 120


@bp.post("/api/knowledge/place")
def api_place() -> ResponseReturnValue:
    """Where in the paper each of the course's concepts is needed (v8.44.0).

    The Reader's Knowledge Graph notes: the tutor reads the paper's sections
    and names the sections each concept matters in (``tutor.place``). From
    the paper's cached document (``integrations/arxiv/document.py``) by
    default; with ``source: "pdf"``, from its PDF's contents and page text,
    for a paper the Reader can only show as a PDF (the PDF view of a paper
    with a text reuses the text's placement, matched to the PDF's headings
    in the browser). Cached permanently, like the lessons, by the paper, the
    source and the course's concepts: a course that changes asks again; the
    same course never does.

    Body:
        ``{paper, concepts: [names], source?: "text" | "pdf", provider?}``.
        ``paper`` is an arXiv id, or for the PDF a provider id too.

    Returns:
        ``{sections: {<section id>: [concept names]}}``, each list in the
        order the concepts were given; section ids are the document's, or
        ``pdf:<n>`` for the PDF's n-th contents entry. ``{sections: {}}``
        when there's nothing to place in. HTTP 400 for a malformed body, 502
        when the model fails.
    """
    payload = request.get_json(silent=True) or {}
    raw_paper = str(payload.get("paper") or "").strip()
    paper = arxiv.extract_id(raw_paper) or raw_paper
    source: Literal["text", "pdf"] = "pdf" if payload.get("source") == "pdf" else "text"
    provider: Provider = "openalex" if payload.get("provider") == "openalex" else "s2"
    raw = payload.get("concepts")
    if not isinstance(raw, list) or not paper or (source == "text" and not arxiv.looks_arxiv(paper)):
        return jsonify({"error": "paper and concepts are required"}), 400
    concepts = list(dict.fromkeys(" ".join(str(name).split()) for name in raw if isinstance(name, str)))
    concepts = [name for name in concepts if name][:PLACE_CONCEPTS]
    if not concepts:
        return jsonify({"sections": {}})
    shape = [sections_service.DEPTH] if source == "text" else ["pdf", provider, sections_service.PDF_PAGES]
    key = "tutor:place:v1:" + _digest([paper, sorted(concepts), *shape])
    cached = cache.get(key)
    if isinstance(cached, dict) and "sections" in cached:
        return jsonify(cached)
    try:
        sections = sections_service.paper_sections(paper, source, provider)
    except Exception:  # the render or the PDF unreachable: nothing to place in, this time
        log.warning("place: reading %s's %s failed", paper, source, exc_info=True)
        return jsonify({"sections": {}})
    if not sections:
        return jsonify({"sections": {}})
    try:
        placed = tutor.place(sections, concepts)
    except Exception:
        log.exception("placing concepts failed for %s", paper)
        return jsonify({"error": "The tutor couldn't place the course in the paper — try again."}), 502
    by_section: dict[str, list[str]] = {}
    for name in concepts:
        for section_id in placed.get(name, []):
            by_section.setdefault(section_id, []).append(name)
    result = {"sections": by_section}
    cache.set(key, result)
    return jsonify(result)


@bp.get("/api/web_image/<handle>")
def api_web_image(handle: str) -> ResponseReturnValue:
    """Serve an image a lesson's image search found on the web (v8.24.0).

    Through our origin, so a page's hotlink rules and the browser's
    mixed-content rules don't break the card, and the host never sees the
    reader. The image is fetched afresh (with a day-long browser cache) and
    never stored: only its address is kept.

    Args:
        handle: The image's handle. Only a handle a search registered
            resolves, so this is no open proxy, and the fetch itself is the
            guarded one (public addresses only).

    Returns:
        The image bytes; 404 for an unknown handle or an image that is gone
        or no longer an image.
    """
    if tutor.images.web_image_url(handle) is None:
        return Response(status=404)
    try:
        data, media_type = tutor.images.image_bytes(f"web:{handle}")
    except Exception:
        log.info("web image proxy failed for %s", handle, exc_info=True)
        return Response(status=404)
    return Response(data, mimetype=media_type, headers={"Cache-Control": "public, max-age=86400"})
