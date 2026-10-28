"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The Criticisms card's service (services/reviews): which source answers,
how verified ids become quotes from real citing papers, and the cache.
Both sources and the reviewer are stubbed; no network, no model.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import pytest

from curious_astronaut.agents.orchestrators import reviewer
from curious_astronaut.integrations import semantic_scholar as s2
from curious_astronaut.services import reviews

PAPER = {"id": "CorpusId:1", "arxiv_id": "1706.03762", "title": "Attention Is All You Need",
         "authors": "Vaswani, Shazeer", "year": 2017, "url": "https://arxiv.org/abs/1706.03762"}


def citer(corpus_id: int, title: str, citations: int, *sentences: str) -> dict:
    """A ``{"node", "sentences"}`` entry as either source returns it."""
    node = {"id": f"CorpusId:{corpus_id}", "arxiv_id": None, "title": title, "year": 2020,
            "authors": "Someone", "citation_count": citations, "url": "", "abstract": None}
    return {"node": node, "sentences": list(sentences)}


CITERS = [
    citer(2, "Linformer", 3000, "Self-attention is quadratic [1].", "We fix that."),
    citer(3, "FlashAttention", 5000, "Standard attention [1] is memory-bound."),
]


@pytest.fixture()
def calls(monkeypatch):
    """Stub both sources and the reviewer; record what was asked."""
    seen: dict = {"live": 0, "review": []}

    monkeypatch.setattr(reviews.corpus_source, "citing_sentences",
                        lambda paper, ref, limit: CITERS)

    def live(ref, limit):
        seen["live"] += 1
        return CITERS

    monkeypatch.setattr(reviews.s2, "citing_sentences", live)

    def review(target, sentences):
        seen["review"].append((target, sentences))
        return reviewer.Review(
            themes=[reviewer.Theme(name="Quadratic cost", summary="It scales badly.",
                                   sentence_ids=["s0", "s2"])],
            critiques=2, judged=len(sentences),
        )

    monkeypatch.setattr(reviews.reviewer, "review", review)
    return seen


def test_s2_ref_prefers_arxiv_then_s2_ids_then_doi():
    assert reviews.s2_ref(PAPER) == "arXiv:1706.03762"
    assert reviews.s2_ref({"id": "CorpusId:9"}) == "CorpusId:9"
    assert reviews.s2_ref({"id": "a" * 40}) == "a" * 40
    assert reviews.s2_ref({"id": "W123", "url": "https://doi.org/10.1/x"}) == "DOI:10.1/x"
    assert reviews.s2_ref({"id": "W123", "url": "https://openalex.org/W123"}) is None


def test_build_turns_verified_ids_into_quotes_from_real_citers(calls):
    card = reviews.build(PAPER)
    assert card["source"] == "corpus" and calls["live"] == 0
    assert (card["citers"], card["sentences"], card["critiques"]) == (2, 3, 2)
    target, sentences = calls["review"][0]
    assert target.title == PAPER["title"] and target.year == 2017
    assert [sentence.id for sentence in sentences] == ["s0", "s1", "s2"]
    [theme] = card["themes"]
    assert theme["papers"] == 2
    # Quotes are ordered by the citing paper's citation count, word for word.
    assert [(quote["text"], quote["paper"]["title"]) for quote in theme["quotes"]] == [
        ("Standard attention [1] is memory-bound.", "FlashAttention"),
        ("Self-attention is quadratic [1].", "Linformer"),
    ]
    assert set(theme["quotes"][0]["paper"]) == {
        "id", "arxiv_id", "title", "year", "authors", "citation_count", "url"
    }


def test_build_falls_back_to_live_when_the_corpus_cannot_serve(calls, monkeypatch):
    monkeypatch.setattr(reviews.corpus_source, "citing_sentences", lambda paper, ref, limit: None)
    assert reviews.build(PAPER)["source"] == "live" and calls["live"] == 1


def test_a_paper_semantic_scholar_cannot_name_is_an_answer_not_a_failure(calls, monkeypatch):
    card = reviews.build({"id": "W123", "title": "An OpenAlex-only paper"})
    assert card == {"source": None, "citers": 0, "sentences": 0, "critiques": 0, "themes": []}

    def missing(ref, limit):
        raise s2.S2Error("not found", status=404)

    monkeypatch.setattr(reviews.corpus_source, "citing_sentences", lambda paper, ref, limit: None)
    monkeypatch.setattr(reviews.s2, "citing_sentences", missing)
    assert reviews.build(PAPER)["source"] is None
    assert calls["review"] == []


def test_the_card_is_cached_until_asked_fresh(calls):
    first = reviews.peer_reviews(PAPER)
    assert reviews.peer_reviews(PAPER) == first
    assert len(calls["review"]) == 1
    reviews.peer_reviews(PAPER, fresh=True)
    assert len(calls["review"]) == 2


def test_a_cached_live_card_gives_way_once_the_corpus_can_answer(calls, monkeypatch):
    # Gathered while the corpus couldn't serve the paper (off, or half-built).
    monkeypatch.setattr(reviews.corpus_source, "citing_sentences", lambda paper, ref, limit: None)
    assert reviews.peer_reviews(PAPER)["source"] == "live"
    assert reviews.peer_reviews(PAPER)["source"] == "live"  # still the best there is
    assert len(calls["review"]) == 1
    monkeypatch.setattr(reviews.corpus_source, "citing_sentences", lambda paper, ref, limit: CITERS)
    assert reviews.peer_reviews(PAPER)["source"] == "corpus"
    assert len(calls["review"]) == 2


def test_a_live_card_is_kept_a_day_at_most(calls, monkeypatch):
    monkeypatch.setattr(reviews.corpus_source, "citing_sentences", lambda paper, ref, limit: None)
    reviews.peer_reviews(PAPER)
    monkeypatch.setattr(reviews, "LIVE_CACHE_SECONDS", -1)
    reviews.peer_reviews(PAPER)
    assert len(calls["review"]) == 2
