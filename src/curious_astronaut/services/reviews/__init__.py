"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The Criticisms card: what the field objected to in a paper, each concern
quoted from the later paper that raised it.

The sentences come from Semantic Scholar's citation contexts, the sentence
in which a citing paper cites this one. **Which citers matters more than how
many**: the field's real responses come from its most-cited citers, a ranking
only the offline corpus can serve (its contexts table, ``corpus/contexts.py``).
So:

* **corpus** (preferred) — the :data:`CITERS` most-cited citers that have a
  sentence, ranked across all history.
* **live** (fallback, for a paper the corpus can't serve) — one page of S2's
  newest ~1,000 citers, ranked locally. For a busy paper that's the recent
  conversation, not the field's verdict, and the payload says which it is so
  the card can say so too.

Every sentence of every chosen citer goes to the reviewer
(``agents/orchestrators/reviewer``), which judges, groups and verifies; this
module numbers the sentences, maps the verified ids back to the real
sentences and citing papers, and caches the card.

**Cached for** :data:`CACHE_SECONDS`. A paper's critiques settle slowly, but
not never: the corpus refreshes weekly, and a new paper gathers citers fast.
A **live** card is a stopgap, so it's kept for :data:`LIVE_CACHE_SECONDS`
only, and never once the corpus can answer for the paper: a card gathered
while the corpus was off (or its contexts table half-built) would otherwise
quote this week's 4-citation papers for a month.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
import re
from typing import Any, Literal

from ...agents.orchestrators import reviewer
from ...integrations import semantic_scholar as s2
from ...integrations.semantic_scholar.corpus import source as corpus_source
from ...storage import cache

log = logging.getLogger(__name__)

#: How many citers' sentences are judged. The prototype's: the top 200 by
#: citation count held every theme the field is known for on Attention and
#: DDPM, at ~20-30s a paper.
CITERS = 200

#: How long a card is cached: a month, so a weekly corpus refresh or a young
#: paper's new citers reach it without the card being rebuilt on every open.
CACHE_SECONDS = 30 * 24 * 3600

#: How long a live card is cached: a day, like a graph snapshot. S2's newest
#: citers change daily, and the corpus may come to serve the paper.
LIVE_CACHE_SECONDS = 24 * 3600

#: Bump when the payload's shape or the reviewer's prompts change.
_CACHE_VERSION = "v1"

Source = Literal["corpus", "live"]

_S2_PAPER_ID = re.compile(r"^[0-9a-f]{40}$")
_DOI_URL = re.compile(r"^https?://(?:dx\.)?doi\.org/(.+)$", re.IGNORECASE)


def s2_ref(paper: dict) -> str | None:
    """An id Semantic Scholar accepts for this paper, from any provider's node.

    Args:
        paper: A graph node (S2 or OpenAlex).

    Returns:
        ``arXiv:<id>``, ``CorpusId:<n>``, ``DOI:<doi>`` or a raw S2 paperId,
        in that order of preference; None when the node has none of them (an
        OpenAlex-only paper with no arXiv id or DOI).
    """
    if paper.get("arxiv_id"):
        return f"arXiv:{paper['arxiv_id']}"
    node_id = str(paper.get("id") or "")
    if node_id.lower().startswith("corpusid:") or _S2_PAPER_ID.match(node_id):
        return node_id
    doi = _DOI_URL.match(str(paper.get("url") or ""))
    return f"DOI:{doi.group(1)}" if doi else None


def _citers(paper: dict) -> tuple[Source, list[dict]] | None:
    """The chosen citers and their sentences, from the corpus or else live.

    Args:
        paper: The paper's graph node.

    Returns:
        ``(source, [{"node", "sentences"}])``, most-cited citer first; None
        when neither source can find the paper.

    Raises:
        s2.S2Error: When the live fetch fails.
    """
    ref = s2_ref(paper)
    if ref is None:
        return None
    from_corpus = corpus_source.citing_sentences(paper, ref, limit=CITERS)
    if from_corpus is not None:
        return "corpus", from_corpus
    try:
        return "live", s2.citing_sentences(ref, limit=CITERS)
    except s2.S2Error as error:
        if error.status == 404:
            return None
        raise


def _byline(paper: dict) -> reviewer.Target:
    """The paper as the reviewer is told about it.

    Args:
        paper: The paper's graph node.

    Returns:
        Its title, authors and year.
    """
    year = paper.get("year")
    return reviewer.Target(
        title=str(paper.get("title") or "(untitled)"),
        authors=paper.get("authors") or None,
        year=year if isinstance(year, int) else None,
    )


def _citer_card(node: dict) -> dict:
    """What the card shows of a citing paper (and opens it by).

    Args:
        node: The citer's graph node.

    Returns:
        A trimmed node: id, arXiv id, title, year, authors, citation count, url.
    """
    fields = ("id", "arxiv_id", "title", "year", "authors", "citation_count", "url")
    return {field: node.get(field) for field in fields}


def build(paper: dict) -> dict[str, Any]:
    """The Criticisms card for one paper, uncached.

    Args:
        paper: The paper's graph node.

    Returns:
        ``{source, citers, sentences, critiques, themes}``. ``source`` is
        ``"corpus"``, ``"live"`` or None (the paper couldn't be found); each
        theme is ``{name, summary, papers, quotes: [{text, paper}]}``, its
        quotes ordered by the citing paper's citation count and ``papers``
        the number of distinct papers raising it. No themes is an answer, not
        a failure: the counts say how much was read.

    Raises:
        s2.S2Error: When the live fetch fails.
        Exception: Model failures propagate from the reviewer.
    """
    found = _citers(paper)
    if found is None:
        return {"source": None, "citers": 0, "sentences": 0, "critiques": 0, "themes": []}
    source, citers = found
    sentences: list[reviewer.Sentence] = []
    owners: dict[str, dict] = {}
    for entry in citers:
        for text in entry["sentences"]:
            sentence_id = f"s{len(sentences)}"
            sentences.append(
                reviewer.Sentence(id=sentence_id, text=text, year=entry["node"].get("year"))
            )
            owners[sentence_id] = entry["node"]
    texts = {sentence.id: sentence.text for sentence in sentences}
    result = reviewer.review(_byline(paper), sentences)
    themes = []
    for theme in result.themes:
        ranked = sorted(
            theme.sentence_ids,
            key=lambda sid: owners[sid].get("citation_count") or 0,
            reverse=True,
        )
        quotes: list[dict[str, Any]] = [
            {"text": texts[sid], "paper": _citer_card(owners[sid])} for sid in ranked
        ]
        themes.append({
            "name": theme.name,
            "summary": theme.summary,
            "papers": len({quote["paper"]["id"] for quote in quotes}),
            "quotes": quotes,
        })
    return {
        "source": source,
        "citers": len(citers),
        "sentences": result.judged,
        "critiques": result.critiques,
        "themes": themes,
    }


def cache_key(paper: dict) -> str | None:
    """The card's cache key, or None when the paper has no S2 id to key it by.

    Args:
        paper: The paper's graph node.

    Returns:
        ``reviews:<version>:<S2 ref>``.
    """
    ref = s2_ref(paper)
    return f"reviews:{_CACHE_VERSION}:{ref}" if ref else None


def _stale_live(paper: dict, key: str) -> bool:
    """Whether a cached live card should be gathered again.

    Args:
        paper: The paper's graph node.
        key: Its cache key.

    Returns:
        True when the card is older than :data:`LIVE_CACHE_SECONDS`, or the
        corpus can now answer for the paper (one ~1s query).
    """
    if cache.get(key, max_age=LIVE_CACHE_SECONDS) is None:
        return True
    ref = s2_ref(paper)
    return ref is not None and corpus_source.citing_sentences(paper, ref, limit=1) is not None


def peer_reviews(paper: dict, *, fresh: bool = False) -> dict[str, Any]:
    """The Criticisms card for one paper, from the cache when it's there.

    Args:
        paper: The paper's graph node.
        fresh: Skip the cached card and replace it.

    Returns:
        The card (see :func:`build`).

    Raises:
        s2.S2Error: When the live fetch fails.
        Exception: Model failures propagate from the reviewer.
    """
    key = cache_key(paper)
    if key is not None and not fresh:
        cached = cache.get(key, max_age=CACHE_SECONDS)
        if isinstance(cached, dict) and (
            cached.get("source") != "live" or not _stale_live(paper, key)
        ):
            return cached
    card = build(paper)
    if key is not None:
        cache.set(key, card)
    return card
