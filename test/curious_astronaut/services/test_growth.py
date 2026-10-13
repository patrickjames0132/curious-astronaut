"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Growing a built graph (services/graph/growth.py): what an expansion adds and
links, and the citations found among a graph's papers, per provider, with the
per-paper reference cache.

Provider lookups are monkeypatched; the cache is real SQLite on the per-test
temp DB (see conftest ``_isolate``).

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import pytest

from curious_astronaut.services.graph import growth
from curious_astronaut.services.graph.shape import BuildShape


def hit(node_id: str, citations: int = 0, influential: bool = False) -> dict:
    """A traversal entry for one neighbour."""
    return {
        "node": {
            "id": node_id, "arxiv_id": None, "title": node_id.upper(), "abstract": None,
            "tldr": None, "year": 2020, "month": None, "pub_date": None,
            "citation_count": citations, "authors": None, "url": f"https://x/{node_id}",
        },
        "influential": influential,
    }


def test_expand_links_known_papers_and_adds_up_to_the_limit_of_new_ones():
    hits = [hit("origin"), hit("known1"), hit("new1"), hit("known2"), hit("new2"), hit("new3")]
    grown = growth.expand("origin", "references", hits, {"origin", "known1", "known2"}, limit=2)
    # Known papers never count against the limit, so two new ones still come in.
    assert [node.id for node in grown.nodes] == ["new1", "new2"]
    assert all(node.rels == ["reference"] and not node.is_seed for node in grown.nodes)
    # A reference edge runs from the expanded paper to the paper it cites.
    assert [(edge.source, edge.target) for edge in grown.edges] == [
        ("origin", "known1"), ("origin", "new1"), ("origin", "known2"), ("origin", "new2"),
    ]


def test_expand_without_a_limit_adds_every_new_paper():
    hits = [hit(f"new{index}") for index in range(30)]
    grown = growth.expand("origin", "references", hits, {"origin"})
    assert len(grown.nodes) == 30


def test_hop_hits_takes_every_reference_on_s2(monkeypatch):
    seen = {}

    def fake_references(paper_id, limit=None):
        seen.update(paper_id=paper_id, limit=limit)
        return [hit("r1"), hit("r2")]

    monkeypatch.setattr(growth.s2, "references", fake_references)
    hits = growth.hop_hits("CorpusId:7", "references", "s2", BuildShape())
    assert [entry["node"]["id"] for entry in hits] == ["r1", "r2"]
    # No limit: the whole list.
    assert seen == {"paper_id": "CorpusId:7", "limit": None}


def test_hop_hits_bands_citers_like_the_seed_and_caches_per_shape(monkeypatch):
    calls = []

    def fake_citations(seed_paper, seed_ref, shape):
        calls.append((seed_paper, seed_ref, shape.adaptive))
        return [hit("landmark")], [hit("latest")], "corpus"

    monkeypatch.setattr(growth, "s2_citations", fake_citations)
    hits = growth.hop_hits("CorpusId:7", "citations", "s2", BuildShape(), arxiv_id="1509.06461")
    # Landmarks and latest together, through the build's own tau step.
    assert [entry["node"]["id"] for entry in hits] == ["landmark", "latest"]
    assert calls == [({"id": "CorpusId:7", "arxiv_id": "1509.06461"}, "CorpusId:7", True)]
    # Cached for the day; a different shape is a different hop.
    growth.hop_hits("CorpusId:7", "citations", "s2", BuildShape())
    assert len(calls) == 1
    growth.hop_hits("CorpusId:7", "citations", "s2", BuildShape(adaptive=False))
    assert len(calls) == 2


def test_hop_hits_on_openalex_resolves_the_work_first(monkeypatch):
    monkeypatch.setattr(growth.openalex, "resolve_seed_work", lambda node_id: {"id": "W1"})
    monkeypatch.setattr(growth.openalex, "bare_work_id", lambda work: "W1")
    monkeypatch.setattr(
        growth, "openalex_citations", lambda work_id, shape: ([hit("land")], [hit("late")])
    )
    hits = growth.hop_hits("DOI:10.1/x", "citations", "openalex", BuildShape())
    assert [entry["node"]["id"] for entry in hits] == ["land", "late"]
    monkeypatch.setattr(growth.openalex, "resolve_seed_work", lambda node_id: None)
    assert growth.hop_hits("DOI:10.1/y", "references", "openalex", BuildShape()) == []


def test_expand_citations_point_at_the_expanded_paper():
    grown = growth.expand("origin", "citations", [hit("citer", influential=True)], set(), limit=5)
    edge = grown.edges[0]
    assert (edge.source, edge.target, edge.type, edge.influential) == (
        "citer", "origin", "citation", True,
    )
    assert grown.nodes[0].rels == ["citation"]


def test_links_between_on_s2_and_its_per_paper_cache(monkeypatch):
    asked = []

    def fake_reference_ids(paper_ids):
        asked.append(list(paper_ids))
        return {"a": ["b", "outside", "a"], "b": ["c"], "c": []}

    monkeypatch.setattr(growth.s2, "reference_ids", fake_reference_ids)
    pairs = growth.links_between(["a", "b", "c", "a", "gone"], "s2")
    # Only citations whose both ends are on the graph, and no self-loop.
    assert sorted(pairs) == [("a", "b"), ("b", "c")]
    assert asked == [["a", "b", "c", "gone"]]

    # The graph grows by one paper: only that one is asked about. "gone" was
    # cached as unresolved, so it isn't asked again either.
    growth.links_between(["a", "b", "c", "gone", "d"], "s2")
    assert asked[1] == ["d"]


def test_links_between_on_openalex_matches_by_work_id(monkeypatch):
    monkeypatch.setattr(
        growth.openalex,
        "reference_keys",
        lambda node_ids: {"DOI:10.1/x": ("W1", ["W2"]), "W2": ("W2", ["W7"])},
    )
    assert growth.links_between(["DOI:10.1/x", "W2"], "openalex") == [("DOI:10.1/x", "W2")]


def test_links_between_caps_the_request(monkeypatch):
    seen = []
    monkeypatch.setattr(growth.s2, "reference_ids", lambda ids: seen.extend(ids) or {})
    growth.links_between([f"id{index}" for index in range(growth.MAX_LINK_IDS + 5)], "s2")
    assert len(seen) == growth.MAX_LINK_IDS


@pytest.mark.parametrize("provider", ["s2", "openalex"])
def test_links_between_empty_graph_asks_nothing(monkeypatch, provider):
    monkeypatch.setattr(growth.s2, "reference_ids", lambda ids: pytest.fail("asked"))
    monkeypatch.setattr(growth.openalex, "reference_keys", lambda ids: pytest.fail("asked"))
    assert growth.links_between([], provider) == []
