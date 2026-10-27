"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The assistant's routing and its screen → tools table: every view routes only
to workflows it offers, and only the general chat may search the literature.
The HTTP face (status codes, what reaches the agents) is tested in
``routes/test_agents.py``.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import pytest

from curious_astronaut.agents.orchestrators import router
from curious_astronaut.agents.orchestrators.assistant import (
    CAPABILITIES,
    VIEW_KINDS,
    AssistantRoute,
    route,
    view_kind,
)


def test_every_view_has_a_row_and_every_row_answers():
    assert set(CAPABILITIES) == set(VIEW_KINDS)
    for capabilities in CAPABILITIES.values():
        assert "answer" in capabilities.workflows


def test_only_the_general_chat_searches_the_literature():
    """v8.28.0: a view is its own map; finding papers is the general chat's."""
    assert [kind for kind, row in CAPABILITIES.items() if row.paper_search] == ["general"]


def test_the_citation_graph_routes_through_the_graph_router(monkeypatch):
    monkeypatch.setattr(
        router,
        "route",
        lambda message: router.MessageRoute(
            target="lecture", framing="history", scope="named", year_from=2010, year_to=2019
        ),
    )
    assert route("lecture me on BERT in the 2010s", "citations") == AssistantRoute(
        workflow="lecture", framing="history", scope="named", year_from=2010, year_to=2019
    )


def test_the_reader_routes_through_the_reading_router(monkeypatch):
    monkeypatch.setattr(router, "route_reading", lambda message: router.ReadingRoute(target="guide"))
    assert route("teach me this", "reader") == AssistantRoute(workflow="guide")


@pytest.mark.parametrize(
    ("kind", "graph", "reading"),
    [("citations", "lecture", "answer"), ("reader", "answer", "guide")],
)
def test_every_route_is_a_workflow_its_view_offers(monkeypatch, kind, graph, reading):
    """Even when a router answers its loudest: a lecture is never routed in
    the Reader, nor a guided read beside the graph."""
    monkeypatch.setattr(
        router, "route", lambda message: router.MessageRoute(target="lecture", framing="summary")
    )
    monkeypatch.setattr(router, "route_reading", lambda message: router.ReadingRoute(target="guide"))
    decision = route("lecture me", kind)
    assert decision.workflow in CAPABILITIES[kind].workflows
    assert decision.workflow == (graph if kind == "citations" else reading)


@pytest.mark.parametrize(
    ("raw", "kind"),
    [
        ({"kind": "reader"}, "reader"),
        ({"kind": "Reader"}, None),
        ({}, None),
        ("general", None),
        (None, None),
    ],
)
def test_view_kind_reads_only_the_kinds_it_knows(raw, kind):
    assert view_kind(raw) == kind
