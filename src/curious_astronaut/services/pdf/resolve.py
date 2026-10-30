"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Where a paper's open-access PDF lives — resolved once, cached, shared.

An **arXiv id** needs no lookup at all: ``arxiv.org/pdf/<id>`` is always open
access (used when ar5iv has no render to mine instead).

Any other paper gets a list of **candidates**, tried in order until one
downloads as a real PDF (v9.1.0):

1. the graph's **provider**'s link (S2's ``openAccessPdf`` / OpenAlex's best
   location, both surfaced as the node dict's ``oa_pdf``). Hydration
   ``prime``s it, with the paper's DOI, so the routes that fire moments after
   a panel open don't re-ask the provider;
2. every PDF location **OpenAlex** lists for the paper's DOI, whichever
   provider built the graph.

One link was all there used to be, and a publisher link that answers with a
login page left a paper unreadable while a repository held a free copy.

The winner is cached for a month. "No copy downloaded" is cached for a day,
and only when every source answered: a provider outage shouldn't pin a miss.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging

from ...integrations import arxiv, openalex
from ...integrations import semantic_scholar as s2
from ...storage import cache
from ..graph import Provider
from .errors import PdfError
from .fetch import fetch_pdf

log = logging.getLogger(__name__)

# OA status changes about as slowly as citation data; a month matches the
# mined-content TTL so the whole pipeline expires together.
CACHE_TTL = 60 * 60 * 24 * 30
# A paper none of whose copies downloaded is asked about again the next day:
# a repository deposit, or a host that was briefly down, can turn up.
MISS_TTL = 60 * 60 * 24


def arxiv_pdf_url(arxiv_id: str) -> str:
    """The always-open-access PDF URL for an arXiv paper.

    Args:
        arxiv_id: A bare arXiv id (version suffix fine).

    Returns:
        The ``arxiv.org/pdf`` URL.
    """
    return f"https://arxiv.org/pdf/{arxiv_id}"


def _cache_key(node_id: str) -> str:
    """The cache key for one node's resolved OA-PDF URL.

    ``v2`` (v9.1.0) retires the single-link answers, whose month-long "no PDF"
    verdicts would otherwise hide the new candidates.

    Args:
        node_id: The paper's provider node id.

    Returns:
        The cache key.
    """
    return f"oa_pdf:v2:{node_id}"


def _miss_key(node_id: str) -> str:
    """The cache key recording that none of a node's candidates downloaded.

    Args:
        node_id: The paper's provider node id.

    Returns:
        The cache key.
    """
    return f"oa_pdf_miss:{node_id}"


def _hint_key(node_id: str) -> str:
    """The cache key for what the provider said about a node's PDF.

    Args:
        node_id: The paper's provider node id.

    Returns:
        The cache key.
    """
    return f"oa_pdf_hint:{node_id}"


def _text(value: object) -> str | None:
    """A non-empty string, or None.

    Args:
        value: Anything read back from a node or the cache.

    Returns:
        The string, or None for anything else (an empty string included).
    """
    return value if isinstance(value, str) and value else None


def prime(node_id: str, oa_pdf: str | None, doi: str | None = None) -> None:
    """Record what hydration learned about a node's PDF, as a side effect.

    Args:
        node_id: The paper's provider node id.
        oa_pdf: The provider's PDF URL, or None.
        doi: The paper's bare DOI, or None.

    Returns:
        None.
    """
    cache.set(_hint_key(node_id), {"url": oa_pdf, "doi": doi})


def _provider_answer(node_id: str, provider: Provider) -> tuple[str | None, str | None]:
    """The provider's PDF URL and DOI for a node, from the primed hint or a lookup.

    Args:
        node_id: The paper's provider node id.
        provider: Which backend to ask on a cache miss.

    Returns:
        ``(oa_pdf, doi)``, either of them None when unknown.

    Raises:
        s2.S2Error: When an S2 lookup fails.
        openalex.OpenAlexError: When an OpenAlex lookup fails.
    """
    hint = cache.get(_hint_key(node_id), CACHE_TTL)
    if isinstance(hint, dict):
        return _text(hint.get("url")), _text(hint.get("doi"))
    node = openalex.get_paper(node_id) if provider == "openalex" else s2.get_paper(node_id)
    oa_pdf, doi = _text((node or {}).get("oa_pdf")), _text((node or {}).get("doi"))
    prime(node_id, oa_pdf, doi)
    return oa_pdf, doi


def pdf_candidates(node_id: str, provider: Provider) -> tuple[list[str], bool]:
    """Every open-access PDF link known for a paper, in the order to try them.

    Args:
        node_id: The paper's provider node id (an S2 paperId/``CorpusId:``, or
            an S2-resolvable ``DOI:``/``ARXIV:``/``W…`` id from OpenAlex).
        provider: Which backend built the graph: its link goes first.

    Returns:
        ``(candidates, complete)``: the distinct URLs, the provider's first,
        then OpenAlex's locations; and whether every source answered (False
        when any lookup failed, so a miss mustn't be cached).
    """
    candidates: list[str] = []
    complete = True
    oa_pdf: str | None = None
    doi: str | None = None
    try:
        oa_pdf, doi = _provider_answer(node_id, provider)
    except (s2.S2Error, openalex.OpenAlexError) as exc:
        log.warning("OA-PDF resolution failed for %s (%s): %s", node_id, provider, exc)
        complete = False
    if oa_pdf:
        candidates.append(oa_pdf)
    if not doi and node_id[:4].upper() == "DOI:":
        doi = node_id[4:]
    if doi:
        try:
            candidates += openalex.pdf_urls_for_doi(doi)
        except openalex.OpenAlexError as exc:
            log.warning("OpenAlex PDF locations failed for %s: %s", doi, exc)
            complete = False
    return list(dict.fromkeys(candidates)), complete


def resolve_oa_pdf(node_id: str, provider: Provider) -> str | None:
    """The node's open-access PDF URL: the first candidate that downloads.

    Trying a candidate downloads it into the PDF cache, so the caller's own
    ``fetch_pdf`` of the answer is a cache hit.

    Args:
        node_id: The paper's provider node id (an S2 paperId, or an
            S2-resolvable ``DOI:``/``ARXIV:``/``W…`` id from OpenAlex).
        provider: Which backend built the graph — asked first, like every
            other hydration.

    Returns:
        The URL, or None when no candidate downloaded as a PDF (or there were
        none).
    """
    cached = cache.get(_cache_key(node_id), CACHE_TTL)
    if isinstance(cached, dict) and _text(cached.get("url")):
        return str(cached["url"])
    if cache.get(_miss_key(node_id), MISS_TTL) is not None:
        return None
    candidates, complete = pdf_candidates(node_id, provider)
    for url in candidates:
        try:
            fetch_pdf(url)
        except PdfError as exc:
            log.info("OA-PDF candidate for %s didn't download: %s", node_id, exc)
            continue
        cache.set(_cache_key(node_id), {"url": url})
        return url
    if complete:
        cache.set(_miss_key(node_id), {"tried": candidates})
    return None


def paper_pdf_url(ref: str, provider: Provider) -> str | None:
    """A paper's PDF URL, for the Reader's PDF view (v8.40.0).

    Args:
        ref: The paper's arXiv id, or its provider node id for a paper not on
            arXiv (the Reader sends ``arxiv_id ?? id``).
        provider: Who to ask first for a non-arXiv paper's open-access PDF.

    Returns:
        arXiv's PDF for an arXiv id (always open), else the first open-access
        copy that downloads, else None.
    """
    if arxiv.looks_arxiv(ref):
        return arxiv_pdf_url(ref)
    return resolve_oa_pdf(ref, provider)
