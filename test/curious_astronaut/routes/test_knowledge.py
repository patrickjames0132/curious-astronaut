"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The knowledge network's routes: the paper's expansion and every lesson see
its real reference list, results are cached so a course is never paid for
twice (a lesson with its citations), a failed reference fetch degrades
quietly, and bad input is a 400.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import json

from curious_astronaut.agents import events
from curious_astronaut.agents.orchestrators import tutor
from curious_astronaut.routes import knowledge

ITEM = {"title": "Playing Atari", "kind": "paper", "paper_id": "dqn"}


def _frames(response) -> list[tuple[str, dict]]:
    """Parse an SSE response into (event, data) pairs."""
    frames = []
    for chunk in response.data.decode().strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in chunk.splitlines())
        frames.append((lines["event"], json.loads(lines["data"])))
    return frames


def test_expand_shows_the_paper_its_references_and_caches(client, monkeypatch):
    fetched = []
    seen = {}

    def neighbors(paper_id, relation, limit, provider):
        fetched.append((paper_id, relation, provider))
        return [{"node": {"id": "ql", "title": "Q-learning", "year": 1992, "extra": "dropped"}}]

    def expand(item, path, references, existing):
        seen["references"] = references
        return [tutor.Child(name="Q-learning", why="w")]

    monkeypatch.setattr(knowledge.traversal, "neighbors", neighbors)
    monkeypatch.setattr(knowledge.tutor, "expand", expand)
    body = {"item": ITEM, "path": [], "existing": [], "provider": "s2"}
    first = client.post("/api/knowledge/expand", json=body)
    assert first.status_code == 200
    assert first.json["children"] == [{"name": "Q-learning", "why": "w"}]
    assert fetched == [("dqn", "references", "s2")]
    # Trimmed to the fields the frontend uses.
    assert "extra" not in seen["references"][0]

    second = client.post("/api/knowledge/expand", json=body)
    assert second.json == first.json
    assert len(fetched) == 1  # served from the cache


def test_a_failed_reference_fetch_still_expands(client, monkeypatch):
    def neighbors(*_args):
        raise RuntimeError("S2 down")

    seen = {}

    def expand(item, path, references, existing):
        seen["references"] = references
        return []

    monkeypatch.setattr(knowledge.traversal, "neighbors", neighbors)
    monkeypatch.setattr(knowledge.tutor, "expand", expand)
    response = client.post("/api/knowledge/expand", json={"item": ITEM, "path": []})
    assert response.status_code == 200
    assert seen["references"] == []


def test_a_concept_is_never_grounded_in_references(client, monkeypatch):
    def neighbors(*_args):
        raise AssertionError("a concept has no reference list")

    monkeypatch.setattr(knowledge.traversal, "neighbors", neighbors)
    monkeypatch.setattr(knowledge.tutor, "expand", lambda *_args: [])
    item = {"title": "Eigenvectors", "kind": "concept", "paper_id": "ignored"}
    assert client.post("/api/knowledge/expand", json={"item": item}).status_code == 200


def test_expand_failure_is_a_502(client, monkeypatch):
    def expand(*_args):
        raise RuntimeError("model down")

    monkeypatch.setattr(knowledge.tutor, "expand", expand)
    item = {"title": "Eigenvectors", "kind": "concept"}
    assert client.post("/api/knowledge/expand", json={"item": item}).status_code == 502


def test_malformed_bodies_are_rejected(client):
    assert client.post("/api/knowledge/expand", json={}).status_code == 400
    bad_kind = {"item": {"title": "X", "kind": "video"}}
    assert client.post("/api/knowledge/expand", json=bad_kind).status_code == 400
    bad_path = {"item": {"title": "X", "kind": "concept"}, "path": "nope"}
    assert client.post("/api/knowledge/lesson", json=bad_path).status_code == 400


def test_a_lesson_cites_the_papers_references_and_replays_from_the_cache(client, monkeypatch):
    calls = []
    ref = {"node_id": "ql", "title": "Q-learning", "url": "u", "provider": "s2"}

    def neighbors(paper_id, relation, limit, provider):
        return [{"node": {"id": "ql", "title": "Q-learning", "year": 1992}}]

    def lesson(item, why, path, abstract, references, provider):
        calls.append((references, provider))
        yield events.Token(text="Q-learning [1] ")
        yield events.Token(text="learns values.")
        yield events.PaperRefs(refs={"1": events.PaperRef(**ref)})

    monkeypatch.setattr(knowledge.traversal, "neighbors", neighbors)
    monkeypatch.setattr(knowledge.tutor, "lesson", lesson)
    body = {
        "item": {"title": "Q-learning", "kind": "concept"},
        "why": "w",
        "path": [],
        "paper_id": "dqn",
        "provider": "s2",
    }
    first = _frames(client.post("/api/knowledge/lesson", json=body))
    assert first == [
        ("token", {"text": "Q-learning [1] "}),
        ("token", {"text": "learns values."}),
        ("paper_refs", {"refs": {"1": ref}}),
        ("done", {}),
    ]
    assert calls[0][0][0]["id"] == "ql"
    again = _frames(client.post("/api/knowledge/lesson", json=body))
    assert again == [
        ("token", {"text": "Q-learning [1] learns values."}),
        ("paper_refs", {"refs": {"1": ref}}),
        ("done", {}),
    ]
    assert len(calls) == 1


def test_a_failed_lesson_is_not_cached(client, monkeypatch):
    def lesson(item, why, path, abstract, references, provider):
        yield events.Token(text="half a les")
        raise RuntimeError("stream dropped")

    monkeypatch.setattr(knowledge.tutor, "lesson", lesson)
    body = {"item": {"title": "Q-learning", "kind": "concept"}}
    frames = _frames(client.post("/api/knowledge/lesson", json=body))
    assert frames[-1][0] == "error"
    monkeypatch.setattr(
        knowledge.tutor, "lesson", lambda *_args: iter([events.Token(text="whole")])
    )
    frames = _frames(client.post("/api/knowledge/lesson", json=body))
    assert frames[0] == ("token", {"text": "whole"})
