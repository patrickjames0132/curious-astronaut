"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
node(): normalizing a raw S2 paper object into the app's graph-node shape.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import pytest

from curious_astronaut.integrations.semantic_scholar import nodes


def test_node_normalizes_rich_paper():
    raw = {
        "paperId": "abc",
        "externalIds": {"ArXiv": "1706.03762"},
        "title": "Attention",
        "abstract": "We propose...",
        "tldr": {"model": "v2", "text": "Attention is enough."},
        "year": 2017,
        "publicationDate": "2017-06-12",
        "citationCount": 100000,
        "authors": [{"name": "Vaswani"}, {"name": ""}, {"name": "Shazeer"}],
    }
    node = nodes.node(raw)
    assert node["id"] == "abc" and node["arxiv_id"] == "1706.03762"
    assert node["tldr"] == "Attention is enough."
    assert node["month"] == 6 and node["pub_date"] == "2017-06-12"
    assert node["authors"] == "Vaswani, Shazeer"  # blanks dropped
    assert node["url"] == "https://arxiv.org/abs/1706.03762"


def test_node_handles_sparse_paper():
    node = nodes.node({"paperId": "xyz"})
    assert node["title"] == "(untitled)" and node["arxiv_id"] is None
    assert node["month"] is None and node["authors"] is None
    assert node["url"] == "https://www.semanticscholar.org/paper/xyz"
    assert node["fields_of_study"] == []  # absent → empty, never missing


def test_fields_of_study_prefers_s2_deduped_in_order():
    paper = {
        "s2FieldsOfStudy": [
            {"category": "Computer Science", "source": "external"},
            {"category": "Computer Science", "source": "s2-fos-model"},  # dup source
            {"category": "Mathematics", "source": "s2-fos-model"},
            {"source": "s2-fos-model"},  # no category — skipped
        ],
        "fieldsOfStudy": ["Physics"],  # ignored when s2FieldsOfStudy has entries
    }
    assert nodes.fields_of_study(paper) == ["Computer Science", "Mathematics"]


def test_fields_of_study_falls_back_to_coarse_list():
    assert nodes.fields_of_study({"fieldsOfStudy": ["Computer Science"]}) == ["Computer Science"]
    assert nodes.fields_of_study({"s2FieldsOfStudy": [], "fieldsOfStudy": None}) == []
    assert nodes.fields_of_study({}) == []


@pytest.mark.parametrize(
    "pub,month",
    [
        ("2017-06-12", 6),
        ("2017-13-01", None),
        ("2017", None),
        (None, None),
        ("2017-0x-01", None),
    ],
)
def test_node_month_parsing(pub, month):
    node = nodes.node({"paperId": "a", "publicationDate": pub})
    assert node["month"] == month


def test_venue_prefers_normalized_record_with_string_fallback():
    normalized = {
        "paperId": "a",
        "venue": "NeurIPS",
        "publicationVenue": {"name": "Neural Information Processing Systems"},
    }
    assert nodes.node(normalized)["venue"] == "Neural Information Processing Systems"
    # No normalized record: the legacy string fills in; neither → None.
    assert nodes.node({"paperId": "a", "venue": "NeurIPS"})["venue"] == "NeurIPS"
    assert nodes.node({"paperId": "a", "venue": ""})["venue"] is None
    assert nodes.node({"paperId": "a"})["venue"] is None


def test_node_none_for_unresolved():
    assert nodes.node(None) is None
    assert nodes.node({}) is None
    assert nodes.node({"title": "no paperId"}) is None


def test_from_papers_wraps_and_skips_unresolved():
    raw = [{"paperId": "r1", "title": "Resolved"}, None, {"title": "no paperId"}]
    assert nodes.from_papers(raw) == [{"node": nodes.node({"paperId": "r1", "title": "Resolved"})}]


def test_node_oa_pdf_from_open_access_field():
    """openAccessPdf.url surfaces as oa_pdf; absent/empty → None."""
    raw = {"paperId": "a", "openAccessPdf": {"url": "https://jmlr.org/x.pdf", "status": "GOLD"}}
    assert nodes.node(raw)["oa_pdf"] == "https://jmlr.org/x.pdf"
    assert nodes.node({"paperId": "a"})["oa_pdf"] is None
    assert nodes.node({"paperId": "a", "openAccessPdf": None})["oa_pdf"] is None
    assert nodes.node({"paperId": "a", "openAccessPdf": {"url": ""}})["oa_pdf"] is None


def test_node_is_survey_from_publication_types():
    """A ``Review`` publication type marks a survey; a null list is a known no;
    an absent field (not requested) is unknown, for the survey pass to fill."""
    assert nodes.node({"paperId": "a", "publicationTypes": ["JournalArticle", "Review"]})[
        "is_survey"
    ] is True
    assert nodes.node({"paperId": "a", "publicationTypes": ["JournalArticle"]})["is_survey"] is False
    assert nodes.node({"paperId": "a", "publicationTypes": None})["is_survey"] is False
    assert nodes.node({"paperId": "a"})["is_survey"] is None


def test_neighbor_fields_request_publication_types():
    """Live neighbors carry the flag for free; the survey pass only looks up the rest."""
    assert "publicationTypes" in nodes.NEIGHBOR_FIELDS.split(",")
    assert "publicationTypes" in nodes.DETAIL_FIELDS.split(",")


def test_node_id_is_the_corpus_id_when_s2_has_one():
    # The offline corpus knows papers only by corpus id, so a live node must
    # wear the same id or one paper gets two (v8.18.0).
    raw = {"paperId": "abc", "externalIds": {"CorpusId": 6208256}, "title": "Double Q"}
    node = nodes.node(raw)
    assert node["id"] == "CorpusId:6208256"
    # The page link still uses the hex id it was built from.
    assert node["url"] == "https://www.semanticscholar.org/paper/abc"


@pytest.mark.parametrize(
    ("paper", "expected"),
    [
        ({"paperId": "abc", "externalIds": {"CorpusId": 7}}, "CorpusId:7"),
        ({"paperId": "abc", "corpusId": "9"}, "CorpusId:9"),  # a nested reference
        ({"paperId": "abc", "externalIds": {"DOI": "10.1/x"}}, "abc"),
        ({"paperId": None}, None),
    ],
)
def test_canonical_id(paper, expected):
    assert nodes.canonical_id(paper) == expected
