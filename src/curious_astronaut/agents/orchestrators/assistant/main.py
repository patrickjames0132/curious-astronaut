"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
One assistant for every view: route a message, then run what it asked for.

``route(message, kind)`` says which workflow a typed message wants in the
view it was typed in; ``run(request)`` checks the request against that view's
capabilities (``views.CAPABILITIES``), builds what the view lends the model
(``context``), and returns the workflow's event stream for the route to relay.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from typing import Callable, Iterator

from pydantic import BaseModel, ConfigDict, ValidationError

from ....config import config
from ....services import search as search_service
from ....services.graph import Node, Provider, resolve_provider
from ... import events
from .. import lecturer, researcher, router
from . import context
from .views import CAPABILITIES, ViewKind, Workflow, view_kind


class RequestError(ValueError):
    """A request the assistant can't run, with what to tell the client (HTTP 400)."""


class AssistantRoute(BaseModel):
    """Where one message goes in the view it was typed in.

    ``framing``, ``scope`` and the years mean something only for a lecture
    over the graph (``router.MessageRoute``); every other route carries the
    fillers, so a caller never checks two things to read one.
    """

    model_config = ConfigDict(extra="forbid")

    workflow: Workflow
    framing: lecturer.Framing = "summary"
    scope: router.Scope = "screen"
    year_from: int | None = None
    year_to: int | None = None


def _route_citations(message: str) -> AssistantRoute:
    """Route a message typed beside the Citation Graph: a lecture or an answer.

    Args:
        message: The message as typed.

    Returns:
        The graph router's decision, scope and period included.
    """
    decision = router.route(message)
    return AssistantRoute(
        workflow="lecture" if decision.target == "lecture" else "answer",
        framing=decision.framing,
        scope=decision.scope,
        year_from=decision.year_from,
        year_to=decision.year_to,
    )


def _route_reader(message: str) -> AssistantRoute:
    """Route a message typed in the Reader: a guided read or an answer.

    Args:
        message: The message as typed.

    Returns:
        The Reader router's decision.
    """
    guide = router.route_reading(message).target == "guide"
    return AssistantRoute(workflow="guide" if guide else "answer")


#: The views with more than one workflow, and who decides between them. The
#: rest only answer, so asking a model would be paying for a known result.
_ROUTERS: dict[ViewKind, Callable[[str], AssistantRoute]] = {
    "citations": _route_citations,
    "reader": _route_reader,
}


def route(message: str, kind: ViewKind | None) -> AssistantRoute:
    """Decide which workflow a typed message wants, in the view it was typed in.

    Args:
        message: The message as typed, mentions and all.
        kind: The view it was typed in; None (an unknown view) answers.

    Returns:
        The route. Never raises: the routers it calls answer on every failure,
        and so does a view with nothing to choose between.
    """
    chooser = _ROUTERS.get(kind) if kind else None
    return chooser(message) if chooser else AssistantRoute(workflow="answer")


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


def _graph(view: dict) -> tuple[Node, list[Node]]:
    """The Citation Graph's seed and the nodes in scope, typed.

    Args:
        view: The request's ``citations`` view.

    Returns:
        ``(seed, nodes)``.

    Raises:
        RequestError: When the nodes are missing or either is malformed.
    """
    raw_nodes = view.get("nodes")
    if not isinstance(raw_nodes, list) or not raw_nodes:
        raise RequestError("nodes must be a non-empty list")
    try:
        return _node(view.get("seed") or {}), [_node(raw) for raw in raw_nodes]
    except ValidationError as error:
        raise RequestError("seed/nodes are malformed") from error


def _papers(view: dict) -> tuple[Node, list[Node]]:
    """The papers a bridge question is about, typed (v9.0.0).

    Args:
        view: The request's ``papers`` view: ``{papers: [node, ...]}``.

    Returns:
        ``(first, papers)``: the first heads the context as a graph's seed
        would, and all of them are numbered as peers.

    Raises:
        RequestError: When there are fewer than two, or one is malformed.
    """
    raw = view.get("papers")
    if not isinstance(raw, list) or len(raw) < 2:
        raise RequestError("papers must list at least two papers")
    try:
        papers = [_node(item) for item in raw if isinstance(item, dict)]
    except ValidationError as error:
        raise RequestError("papers are malformed") from error
    if len(papers) < 2:
        raise RequestError("papers must list at least two papers")
    return papers[0], papers


def _reading(view: dict, provider: Provider) -> str:
    """The paper open in the Reader, laid out, or a refusal.

    Args:
        view: The request's ``reader`` view.
        provider: Who to ask for a non-arXiv paper's PDF.

    Returns:
        The reading block.

    Raises:
        RequestError: When the paper has no text the assistant can read.
    """
    reading, error = context.reading_context(
        view.get("paper"), view.get("section"), provider, view.get("title")
    )
    if not reading:
        raise RequestError(error)
    return reading


def _filters(view: dict, provider: Provider) -> dict:
    """Parse the general chat's paper-discovery filters.

    The researcher forwards them to every paper scout it sends out. They
    scope *discovery* only; citation hops ignore them (see ``ResearcherDeps``).

    Args:
        view: The request's ``general`` view.
        provider: The resolved provider, for validating field values against
            the right vocabulary.

    Returns:
        ``{year_from, year_to, fields}`` ready to splat into
        ``researcher.answer``. Absent, blank, or non-numeric years become
        None; unknown field values are dropped.
    """

    def year(name: str) -> int | None:
        """Read one optional year from the view.

        Args:
            name: The key to read (``year_from`` / ``year_to``).

        Returns:
            The year as an int, or None when absent or unparseable.
        """
        raw = view.get(name)
        if isinstance(raw, int):
            return raw
        try:
            return int(str(raw).strip())
        except (TypeError, ValueError):
            return None

    raw_fields = view.get("fields")
    fields = [str(value) for value in raw_fields] if isinstance(raw_fields, list) else []
    return {
        "year_from": year("year_from"),
        "year_to": year("year_to"),
        "fields": search_service.valid_fields(provider, fields),
    }


def _source_ids(request: dict) -> list[str] | None:
    """Parse the optional ``source_ids`` scope.

    Args:
        request: The parsed request body.

    Returns:
        The library source ids to scope the answer to. ``None`` when the key
        is absent or malformed — no scope, so the whole library is searched.
        A **present** ``source_ids`` array yields exactly its string entries,
        including an **empty list** — an explicit "no sources selected" that
        searches nothing rather than everything.
    """
    raw = request.get("source_ids")
    if not isinstance(raw, list):
        return None
    return [source_id for source_id in raw if isinstance(source_id, str) and source_id]


def _model(request: dict) -> str | None:
    """The researcher model a chat bar picked for its conversation (v8.33.0).

    The bar's picker overrides the researcher's configured model for one
    conversation; Settings keeps the default. Anything that isn't a
    ``"provider:model"`` string naming a vendor the factory knows is ignored,
    so a malformed value falls back to the configured model rather than
    failing the answer. A known but unconfigured vendor still reaches the
    factory, which reports it as an answer error, as it does for config.

    Args:
        request: The parsed request body.

    Returns:
        The override, or None for the configured model.
    """
    raw = request.get("model")
    if not isinstance(raw, str) or ":" not in raw:
        return None
    vendor, name = raw.split(":", 1)
    if not name.strip() or vendor not in type(config.llm.providers).model_fields:
        return None
    return raw


def _answer(kind: ViewKind, view: dict, request: dict, provider: Provider) -> Iterator[events.Event]:
    """The researcher's answer, given what the view lends it.

    Args:
        kind: The view the question was asked in.
        view: The request's view.
        request: The parsed request body.
        provider: The resolved provider.

    Returns:
        The researcher's event stream, not yet started.

    Raises:
        RequestError: When the question is missing or the view lacks what
            the researcher needs (nodes, a course, a readable paper).
    """
    question = request.get("question")
    question = question.strip() if isinstance(question, str) else ""
    if not question:
        raise RequestError("question is required")
    lent: dict = {}
    if kind == "general":
        lent = _filters(view, provider)
    elif kind == "citations":
        lent["seed"], lent["nodes"] = _graph(view)
    elif kind == "knowledge":
        lent["course"] = context.course_context(view.get("course"))
        if not lent["course"]:
            raise RequestError("course is required")
    elif kind == "papers":
        lent["seed"], lent["nodes"] = _papers(view)
        lent["across"] = True
    elif kind == "reader":
        highlight, images = context.highlight_context(view.get("paper"), provider, view.get("places"))
        boxed, figures = context.boxed_figures(view.get("figures"))
        lent["reading"] = _reading(view, provider) + highlight + boxed
        lent["images"] = [*images, *figures]
    return researcher.answer(
        question=question,
        history=context.resumed_history(request),
        sibling_context=context.sibling_context(request),
        source_ids=_source_ids(request),
        provider=provider,
        paper_search=CAPABILITIES[kind].paper_search,
        # Only a literal true counts, so a stray truthy value can't strip the
        # tools from an answer (v8.30.0's quick response).
        quick=request.get("quick") is True,
        model=_model(request),
        **lent,
    )


def _lecture(view: dict) -> Iterator[events.Event]:
    """A lecture over the reader's scoped graph.

    ``nodes`` is the subject of the lecture: whatever the reader has on screen
    after their filters and selection, passed through untouched. ``framing``
    is how to tell it; an unknown value falls back to ``summary`` rather than
    refusing, since a framing is a preference. A ``bridge`` asks for the
    bridge lecture instead.

    Args:
        view: The request's ``citations`` view.

    Returns:
        The lecturer's beats, not yet started.

    Raises:
        RequestError: When the nodes or the bridge paper are missing or malformed.
    """
    seed, nodes = _graph(view)
    framing: lecturer.Framing = "history" if view.get("framing") == "history" else "summary"
    raw_bridge = view.get("bridge")
    try:
        bridge = _node(raw_bridge) if isinstance(raw_bridge, dict) else None
    except ValidationError as error:
        raise RequestError("bridge is malformed") from error
    return lecturer.lecture(seed=seed, nodes=nodes, target=bridge, framing=framing)


def _guide(view: dict, provider: Provider) -> Iterator[events.Event]:
    """A guided read of the paper open in the Reader (v8.50.0).

    Args:
        view: The request's ``reader`` view, with the student's ``known`` and
            ``learning`` concepts from the paper's course.
        provider: Who to ask for a non-arXiv paper's PDF.

    Returns:
        The guided read's beats, not yet started.

    Raises:
        RequestError: When the paper has no text the assistant can read.
    """
    return lecturer.guided_read(
        _reading(view, provider),
        known=context.concept_names(view.get("known")),
        learning=context.concept_names(view.get("learning")),
    )


def run(request: dict) -> Iterator[events.Event]:
    """Check a request against its view and start the workflow it asks for.

    Everything that can refuse runs **now**, before a stream exists, so the
    route can still answer HTTP 400; the workflow itself only starts when the
    returned iterator is.

    Args:
        request: The parsed body: ``{workflow?, question?, view: {kind, ...},
            provider?, source_ids?, history?, thread_context?, quick?,
            model?}``. ``workflow`` defaults to ``answer``. The view's own
            fields are what ``README.md`` lists per kind.

    Returns:
        The workflow's event stream, not yet started and not yet terminated
        (wrap it in ``streams.terminated``).

    Raises:
        RequestError: An unknown view, a workflow the view doesn't offer, or
            a view missing what its workflow needs.
    """
    view = request.get("view")
    kind = view_kind(view)
    if kind is None or not isinstance(view, dict):
        raise RequestError("view.kind must be one of general, citations, knowledge, reader, papers")
    workflow = request.get("workflow", "answer")
    if workflow not in CAPABILITIES[kind].workflows:
        raise RequestError(f"the {kind} view has no {workflow!r} workflow")
    provider = resolve_provider(request.get("provider"))
    if workflow == "lecture":
        return _lecture(view)
    if workflow == "guide":
        return _guide(view, provider)
    return _answer(kind, view, request, provider)
