"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The Criticisms route (routes/reviews.py): the card for a paper, a 400 for a
body without one, and a 502 when Semantic Scholar or the model fails. The
service is stubbed; its own tests are in ``services/reviews``.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from curious_astronaut.integrations import semantic_scholar as s2
from curious_astronaut.services import reviews

PAPER = {"id": "CorpusId:1", "arxiv_id": "1706.03762", "title": "Attention Is All You Need"}

CARD = {"source": "corpus", "citers": 2, "sentences": 3, "critiques": 2,
        "themes": [{"name": "Quadratic cost", "summary": "", "papers": 1, "quotes": []}]}


def test_route_answers_the_card_from_the_papers_known_fields(client, monkeypatch):
    seen = []

    def peer_reviews(paper, *, fresh=False):
        seen.append((paper, fresh))
        return CARD

    monkeypatch.setattr(reviews, "peer_reviews", peer_reviews)
    response = client.post("/api/reviews", json={"paper": {**PAPER, "abstract": "x"}, "fresh": True})
    assert response.status_code == 200 and response.get_json() == CARD
    paper, fresh = seen[0]
    assert "abstract" not in paper and paper["arxiv_id"] == "1706.03762" and fresh is True


def test_route_rejects_a_body_without_a_paper_id(client):
    assert client.post("/api/reviews", json={"paper": {"title": "x"}}).status_code == 400
    assert client.post("/api/reviews", json={}).status_code == 400


def test_route_reports_a_failed_source_or_model_as_502(client, monkeypatch):
    def s2_down(paper, *, fresh=False):
        raise s2.S2Error("down")

    monkeypatch.setattr(reviews, "peer_reviews", s2_down)
    response = client.post("/api/reviews", json={"paper": PAPER})
    assert response.status_code == 502 and "Semantic Scholar" in response.get_json()["error"]

    def model_down(paper, *, fresh=False):
        raise RuntimeError("model")

    monkeypatch.setattr(reviews, "peer_reviews", model_down)
    assert client.post("/api/reviews", json={"paper": PAPER}).status_code == 502
