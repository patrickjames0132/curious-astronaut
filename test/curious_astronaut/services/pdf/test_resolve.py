"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
OA-PDF URL resolution: the candidate chain (the provider's link, then OpenAlex's),
trying each until one downloads, caching hits for a month and misses for a
day, and priming.

Provider clients and the download are monkeypatched — resolution must never
touch the live APIs from tests.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from pathlib import Path

import pytest

from curious_astronaut.services.pdf import resolve
from curious_astronaut.services.pdf.errors import PdfError


@pytest.fixture
def sources(monkeypatch):
    """Scripted sources and downloads: what each knows, and every call made.

    Returns:
        A dict to fill per test: ``node`` (what the provider returns),
        ``openalex`` (URL lists by DOI), ``good`` (URLs that
        download as PDFs), and ``calls`` (each lookup and download, in order).
    """
    state: dict = {"node": None, "openalex": {}, "good": set(), "calls": []}

    def get_paper(node_id):
        state["calls"].append(("provider", node_id))
        return state["node"]

    def openalex_urls(doi):
        state["calls"].append(("openalex", doi))
        return state["openalex"].get(doi, [])

    def fetch(url):
        state["calls"].append(("fetch", url))
        if url not in state["good"]:
            raise PdfError(f"Payload at {url} is not a PDF")
        return Path("/cached.pdf")

    monkeypatch.setattr(resolve.s2, "get_paper", get_paper)
    monkeypatch.setattr(resolve.openalex, "get_paper", get_paper)
    monkeypatch.setattr(resolve.openalex, "pdf_urls_for_doi", openalex_urls)
    monkeypatch.setattr(resolve, "fetch_pdf", fetch)
    return state


def test_the_providers_link_wins_when_it_downloads_and_is_cached(sources):
    sources["node"] = {"oa_pdf": "https://jmlr.org/x.pdf", "doi": None}
    sources["good"] = {"https://jmlr.org/x.pdf"}
    assert resolve.resolve_oa_pdf("abc", "s2") == "https://jmlr.org/x.pdf"
    assert resolve.resolve_oa_pdf("abc", "s2") == "https://jmlr.org/x.pdf"
    assert sources["calls"] == [("provider", "abc"), ("fetch", "https://jmlr.org/x.pdf")]


def test_falls_through_to_another_copy_when_the_providers_link_fails(sources):
    sources["node"] = {"oa_pdf": "https://publisher/login", "doi": "10.1/x"}
    sources["openalex"] = {
        "10.1/x": ["https://publisher/login", "https://repo/x.pdf", "https://pmc/x.pdf"]
    }
    sources["good"] = {"https://repo/x.pdf", "https://pmc/x.pdf"}
    assert resolve.resolve_oa_pdf("abc", "s2") == "https://repo/x.pdf"
    fetched = [url for kind, url in sources["calls"] if kind == "fetch"]
    # The duplicate publisher link is tried once; the later copy isn't needed.
    assert fetched == ["https://publisher/login", "https://repo/x.pdf"]


def test_finds_openalexs_copy_when_the_provider_has_none(sources):
    sources["node"] = {"oa_pdf": None, "doi": "10.1/x"}
    sources["openalex"] = {"10.1/x": ["https://pmc/x.pdf"]}
    sources["good"] = {"https://pmc/x.pdf"}
    assert resolve.resolve_oa_pdf("abc", "openalex") == "https://pmc/x.pdf"


def test_a_doi_node_id_is_asked_about_even_when_the_provider_knows_no_doi(sources):
    sources["node"] = {"oa_pdf": None, "doi": None}
    sources["openalex"] = {"10.1/x": ["https://pmc/x.pdf"]}
    sources["good"] = {"https://pmc/x.pdf"}
    assert resolve.resolve_oa_pdf("DOI:10.1/x", "s2") == "https://pmc/x.pdf"


def test_a_miss_is_cached_for_a_day_once_every_source_answered(sources):
    sources["node"] = {"oa_pdf": None, "doi": "10.1/x"}
    assert resolve.resolve_oa_pdf("W1", "openalex") is None
    assert resolve.resolve_oa_pdf("W1", "openalex") is None
    assert [kind for kind, _ in sources["calls"]] == ["provider", "openalex"]


def test_a_failed_lookup_is_not_cached_as_a_miss(sources, monkeypatch):
    def down(doi):
        sources["calls"].append(("openalex", doi))
        raise resolve.openalex.OpenAlexError("down")

    monkeypatch.setattr(resolve.openalex, "pdf_urls_for_doi", down)
    sources["node"] = {"oa_pdf": None, "doi": "10.1/x"}
    assert resolve.resolve_oa_pdf("abc", "s2") is None
    assert resolve.resolve_oa_pdf("abc", "s2") is None
    # Asked again: a transient outage isn't pinned. The provider's answer was
    # still remembered, so it isn't re-asked.
    assert [kind for kind, _ in sources["calls"]] == ["provider", "openalex", "openalex"]


def test_a_provider_failure_still_tries_a_doi_id_and_caches_nothing(sources, monkeypatch):
    def flaky(node_id):
        sources["calls"].append(("provider", node_id))
        raise resolve.s2.S2Error("down")

    monkeypatch.setattr(resolve.s2, "get_paper", flaky)
    assert resolve.resolve_oa_pdf("abc", "s2") is None
    assert resolve.resolve_oa_pdf("abc", "s2") is None
    assert sources["calls"] == [("provider", "abc"), ("provider", "abc")]


def test_prime_preempts_the_provider_lookup(sources):
    sources["good"] = {"https://host/p.pdf", "https://pmc/d.pdf"}
    sources["openalex"] = {"10.1/d": ["https://pmc/d.pdf"]}
    resolve.prime("abc", "https://host/p.pdf")
    assert resolve.resolve_oa_pdf("abc", "s2") == "https://host/p.pdf"
    # A primed "no link" still lets the DOI find a copy elsewhere.
    resolve.prime("def", None, "10.1/d")
    assert resolve.resolve_oa_pdf("def", "s2") == "https://pmc/d.pdf"
    assert not [call for call in sources["calls"] if call[0] == "provider"]


def test_arxiv_pdf_url():
    assert resolve.arxiv_pdf_url("1706.03762") == "https://arxiv.org/pdf/1706.03762"


def test_paper_pdf_url_is_arxivs_for_an_arxiv_id_else_the_providers(monkeypatch):
    asked = []

    def fake_resolve(node_id, provider):
        asked.append((node_id, provider))
        return "https://journal.example/paper.pdf"

    monkeypatch.setattr(resolve, "resolve_oa_pdf", fake_resolve)
    assert resolve.paper_pdf_url("1412.6980", "s2") == "https://arxiv.org/pdf/1412.6980"
    assert asked == []  # arXiv's PDF is always open; no provider lookup
    assert resolve.paper_pdf_url("abc123", "openalex") == "https://journal.example/paper.pdf"
    assert asked == [("abc123", "openalex")]
