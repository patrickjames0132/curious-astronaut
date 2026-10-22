"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The graph's survey pass (services/graph/surveys.py): which nodes it looks up,
that a whole graph costs one S2 batch call at most, and that a failed lookup
leaves papers unknown instead of failing the graph.

``conftest._isolate`` stubs ``lookup_review_flags`` to answer nothing for every
test; these tests patch it again (or the S2 batch call beneath it) to script
the answer.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging

from curious_astronaut.integrations import semantic_scholar as s2
from curious_astronaut.integrations.semantic_scholar import nodes as s2_nodes
from curious_astronaut.services.graph import surveys
from curious_astronaut.services.graph.model import Node

#: The real lookup, captured at import, before ``conftest._isolate`` stubs it.
REAL_LOOKUP = surveys.lookup_review_flags


def make_node(node_id: str, is_survey: bool | None = None) -> Node:
    """A minimal graph node with the given survey flag."""
    return Node(
        id=node_id, arxiv_id=None, title=f"Paper {node_id}", abstract=None, tldr=None,
        year=2020, month=None, pub_date=None, citation_count=1, authors=None, url="x",
        is_survey=is_survey, rels=["citation"], is_seed=False,
    )


def test_looks_up_only_unknown_resolvable_nodes_in_one_call(monkeypatch):
    """Known flags are kept; unknown ones S2 can resolve go out together; a bare
    OpenAlex ``W…`` id is never sent, since S2 can't resolve it."""
    calls: list[list[str]] = []

    def lookup(node_ids):
        calls.append(node_ids)
        return {"CorpusId:1": True, "DOI:10.1/x": False}

    monkeypatch.setattr(surveys, "lookup_review_flags", lookup)
    known_yes = make_node("CorpusId:9", is_survey=True)
    known_no = make_node("CorpusId:8", is_survey=False)
    corpus_citer = make_node("CorpusId:1")
    openalex_paper = make_node("DOI:10.1/x")
    unresolvable = make_node("W123")
    unanswered = make_node("ARXIV:2101.00001")

    surveys.flag_surveys([known_yes, known_no, corpus_citer, openalex_paper, unresolvable, unanswered])

    assert calls == [["CorpusId:1", "DOI:10.1/x", "ARXIV:2101.00001"]]
    assert (known_yes.is_survey, known_no.is_survey) == (True, False)
    assert (corpus_citer.is_survey, openalex_paper.is_survey) == (True, False)
    assert unresolvable.is_survey is None
    assert unanswered.is_survey is None


def test_no_call_when_every_flag_is_known(monkeypatch):
    """A graph fetched wholly from S2's live API already knows; it costs nothing."""

    def lookup(node_ids):
        raise AssertionError("no lookup expected")

    monkeypatch.setattr(surveys, "lookup_review_flags", lookup)
    surveys.flag_surveys([make_node("CorpusId:1", True), make_node("CorpusId:2", False)])


def test_failed_lookup_leaves_papers_unknown(monkeypatch, caplog):
    """Best-effort: an S2 failure logs and draws those papers as not surveys,
    rather than failing the graph they belong to."""

    def lookup(node_ids):
        raise s2.S2Error("S2 POST batch -> HTTP 429", status=429)

    monkeypatch.setattr(surveys, "lookup_review_flags", lookup)
    node = make_node("CorpusId:1")
    with caplog.at_level(logging.WARNING):
        surveys.flag_surveys([node])
    assert node.is_survey is None
    assert "survey lookup failed" in caplog.text


def test_lookup_asks_s2_for_publication_types_only(monkeypatch):
    """The real lookup is one batch call for the two fields the flag needs,
    read through S2's own node normalizer."""
    seen = {}

    def get_papers(node_ids, fields):
        seen["ids"], seen["fields"] = node_ids, fields
        return {
            "CorpusId:1": s2_nodes.node({"paperId": "a", "publicationTypes": ["Review"]}),
            "CorpusId:2": s2_nodes.node({"paperId": "b", "publicationTypes": None}),
        }

    monkeypatch.setattr(surveys.s2, "get_papers", get_papers)

    assert REAL_LOOKUP(["CorpusId:1", "CorpusId:2", "CorpusId:3"]) == {
        "CorpusId:1": True,
        "CorpusId:2": False,
    }
    assert seen == {
        "ids": ["CorpusId:1", "CorpusId:2", "CorpusId:3"],
        "fields": "paperId,publicationTypes",
    }
