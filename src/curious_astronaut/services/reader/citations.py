"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The Reader's citation cards (v8.43.0): each entry of a paper's bibliography
matched to the actual paper it names, from the provider's own reference list
for that paper (Semantic Scholar's, or OpenAlex's for an OpenAlex thread), so
a ``[12]`` in the text can show the paper and open it.

A bibliography entry is free text ("Bahdanau, Cho and Bengio. Neural machine
translation... CoRR, abs/1409.0473, 2014."), so the match is by evidence in
that text, strongest first (settled with Patrick, 2026-10-23):

1. **An arXiv id** written in the entry (``arXiv:1607.06450``,
   ``abs/1409.0473``) equal to a reference's.
2. **The reference's title** found whole in the entry, compared as lowercase
   words so punctuation, case and line breaks don't matter. Titles of fewer
   than three words aren't trusted on their own ("Adam", "Dropout" turn up in
   other entries' text).
3. **A long run of words shared** by the entry and a reference's title, five
   words or more, between what the first two tiers left. S2 sometimes files a
   title with its proceedings in front ("Proceedings of the Twenty-Third AAAI
   Conference ... (2008) Maximum Entropy Inverse Reinforcement Learning"),
   so the entry's title sits inside the reference's rather than the other way
   round (two of SAC's 36 entries).

An entry nothing matches stays unmatched: the card shows its text. On S2 the
matched papers are hydrated in one batch request, so a card has the authors,
venue and TL;DR without a request of its own; OpenAlex's reference nodes go
out as they come.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
import re
from typing import Any

from ...integrations import openalex
from ...integrations import semantic_scholar as s2
from ...integrations.arxiv import document
from ...storage import cache

log = logging.getLogger(__name__)

#: A day, as the graph snapshots: a reference list rarely changes.
CACHE_TTL = 60 * 60 * 24
#: An arXiv id as bibliographies write it: ``arXiv:1607.06450``,
#: ``arXiv 1607.06450v2``, ``abs/1409.0473``.
_ARXIV_ID = re.compile(r"(?:arxiv\s*[:/]?\s*|abs/)(\d{4}\.\d{4,5})", re.IGNORECASE)
#: A title shorter than this, in words, isn't matched on alone.
_MIN_TITLE_WORDS = 3
#: The shortest run of shared words the last tier trusts.
_MIN_SHARED_RUN = 5


def _words(text: str) -> str:
    """Text as lowercase words joined by single spaces, for comparing titles.

    Args:
        text: Any text.

    Returns:
        Its letters and digits, word by word, padded with a space each side so
        a whole-word ``in`` check can't match inside a word.
    """
    return " " + " ".join(re.findall(r"[a-z0-9]+", text.lower())) + " "


def _entry_text(entry: dict[str, Any]) -> str:
    """A bibliography entry's text, its links' targets included.

    Args:
        entry: ``{id, label, text}`` from the Reader's document, ``text`` as
            runs.

    Returns:
        The runs' text, with any link's address after it (an arXiv id can sit
        only in a link).
    """
    parts: list[str] = []
    for run in entry.get("text", []):
        parts.append(str(run.get("text", "")))
        if run.get("href"):
            parts.append(str(run["href"]))
    return " ".join(parts)


def _shared_run(first: list[str], second: list[str]) -> int:
    """The longest run of words two texts share, in words.

    Args:
        first: One text's words.
        second: The other's.

    Returns:
        The length of the longest common contiguous run.
    """
    best = 0
    previous = [0] * (len(second) + 1)
    for word in first:
        current = [0] * (len(second) + 1)
        for position, other in enumerate(second, start=1):
            if word == other:
                current[position] = previous[position - 1] + 1
                best = max(best, current[position])
        previous = current
    return best


def match(bibliography: list[dict[str, Any]], references: list[dict]) -> dict[str, dict]:
    """Match bibliography entries to reference papers.

    Args:
        bibliography: The document's entries, ``{id, label, text}``.
        references: The provider's reference nodes for the same paper.

    Returns:
        ``{entry id: node}`` for each entry matched; each reference is
        matched at most once, to the first entry that names it.
    """
    by_arxiv = {str(node["arxiv_id"]): node for node in references if node.get("arxiv_id")}
    titled = [
        (_words(str(node.get("title") or "")), node)
        for node in references
        if len(_words(str(node.get("title") or "")).split()) >= _MIN_TITLE_WORDS
    ]
    matched: dict[str, dict] = {}
    used: set[str] = set()
    for entry in bibliography:
        text = _entry_text(entry)
        node = next(
            (by_arxiv[found] for found in _ARXIV_ID.findall(text) if found in by_arxiv),
            None,
        )
        if node is None:
            words = _words(text)
            node = next((candidate for title, candidate in titled if title in words), None)
        if node is not None and str(node["id"]) not in used:
            matched[str(entry["id"])] = node
            used.add(str(node["id"]))
    # The last tier, between what's left: the longest shared run wins.
    for entry in bibliography:
        if str(entry["id"]) in matched:
            continue
        entry_words = _words(_entry_text(entry)).split()
        runs = [
            (_shared_run(entry_words, _words(str(node.get("title") or "")).split()), node)
            for node in references
            if str(node["id"]) not in used
        ]
        run, node = max(runs, key=lambda pair: pair[0], default=(0, None))
        if node is not None and run >= _MIN_SHARED_RUN:
            matched[str(entry["id"])] = node
            used.add(str(node["id"]))
    return matched


def _references(arxiv_id: str, provider: str) -> list[dict]:
    """The provider's reference list for a paper, as nodes.

    Args:
        arxiv_id: The paper's arXiv id.
        provider: ``s2`` or ``openalex``.

    Returns:
        Its reference nodes; empty when the provider doesn't know the paper.

    Raises:
        s2.S2Error: When an S2 request fails after retries.
        openalex.OpenAlexError: When an OpenAlex request fails after retries.
    """
    if provider == "openalex":
        work = openalex.resolve_seed_work(arxiv_id)
        work_id = openalex.bare_work_id(work) if work else None
        return [entry["node"] for entry in openalex.references(work_id)] if work_id else []
    return [entry["node"] for entry in s2.references(f"ARXIV:{arxiv_id}")]


def get_citations(arxiv_id: str, provider: str = "s2", *, refresh: bool = False) -> dict[str, dict]:
    """A paper's bibliography matched to the papers it names (cached).

    Args:
        arxiv_id: The paper's arXiv id.
        provider: ``s2`` or ``openalex``: whose papers to match to.
        refresh: When True, bypass the cache and match again.

    Returns:
        ``{bibliography entry id: node}``; empty when the paper has no
        bibliography in its render or the provider no references for it.

    Raises:
        s2.S2Error: When an S2 request fails after retries (not cached).
        openalex.OpenAlexError: When an OpenAlex request fails after retries
            (not cached).
    """
    key = f"readercites:v1:{provider}:{arxiv_id}"
    if not refresh:
        cached = cache.get(key, CACHE_TTL)
        if cached is not None:
            return dict(cached)
    bibliography = document.get_document(arxiv_id).get("bibliography", [])
    if not bibliography:
        return {}
    matched = match(bibliography, _references(arxiv_id, provider))
    if provider != "openalex" and matched:
        # One batch for the cards' detail: authors, venue, TL;DR.
        detail = s2.get_papers([str(node["id"]) for node in matched.values()])
        matched = {entry: detail.get(str(node["id"]), node) for entry, node in matched.items()}
    log.info("reader citations for %s (%s): %d of %d matched", arxiv_id, provider, len(matched), len(bibliography))
    cache.set(key, matched)
    return matched
