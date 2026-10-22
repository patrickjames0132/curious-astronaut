"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Which papers on a graph are surveys — the one place ``Node.is_survey`` is
resolved, whatever provider or source a paper came from.

A survey is the field's own overview of a period, so the graph colours it
apart and lets the reader narrow to the surveys alone. The flag is
**provider-neutral by design**: the graph, the filter chip and the agents'
scoping read only ``is_survey``, never where it came from, so replacing the
source behind it is a change to this module and nothing else.

The source today is **Semantic Scholar's ``Review`` publication type**, the
one signal that held up on a real graph (2026-10-22: all 50 of the most-cited
titled surveys citing "Attention Is All You Need", plus surveys whose titles
don't say so; OpenAlex's own ``type`` marked 4 of the 50). Papers fetched
live from S2 carry it already (``publicationTypes`` rides
``NEIGHBOR_FIELDS``) and OpenAlex's rare ``review`` is trusted as a yes. Every
paper still unknown after that — a corpus-built citer (the corpus doesn't
ingest the field), or any OpenAlex paper not typed ``review`` — is looked up
in **one** S2 batch call. An OpenAlex node id is ``DOI:``/``ARXIV:`` precisely
so S2 can resolve it, which is what makes the one lookup cover both
providers.

The lookup is **best-effort**: a failure logs and leaves those papers
unknown (drawn as not surveys) rather than failing the graph they belong to.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable

from ...integrations import semantic_scholar as s2
from .model import Node

log = logging.getLogger(__name__)

#: The only fields the lookup needs: ``paperId`` so S2's node normalizer keeps
#: the row, and the publication types that carry the flag.
_LOOKUP_FIELDS = "paperId,publicationTypes"

#: Node ids S2 can resolve: a corpus id, a bare hex paperId, or the ``DOI:`` /
#: ``ARXIV:`` prefixes OpenAlex nodes wear. A bare OpenAlex ``W…`` id is the one
#: kind it can't, and is left unknown rather than sent to fail.
_S2_RESOLVABLE_RE = re.compile(r"CorpusId:\d+|[0-9a-f]{40}|DOI:.+|ARXIV:.+")


def lookup_review_flags(node_ids: list[str]) -> dict[str, bool]:
    """Ask S2 which of these papers are reviews, in one batch request.

    Split out of :func:`flag_surveys` so the test suite can stub the network
    half alone (``conftest._isolate`` does, for every test).

    Args:
        node_ids: S2-resolvable node ids.

    Returns:
        A map of node id to its review flag, for the ids S2 resolved.

    Raises:
        s2.S2Error: When the batch request fails after retries.
    """
    papers = s2.get_papers(node_ids, fields=_LOOKUP_FIELDS)
    return {
        node_id: bool(paper.get("is_survey"))
        for node_id, paper in papers.items()
        if paper.get("is_survey") is not None
    }


def flag_surveys(nodes: Iterable[Node]) -> None:
    """Resolve ``is_survey`` on every node whose provider left it unknown.

    Mutates the nodes in place. Nodes that already know (True or False) are
    untouched; the rest are looked up together, so a whole graph costs one
    request at most and a graph that already knows costs none.

    Args:
        nodes: The graph's nodes (or an expansion's new ones).
    """
    unknown = [
        node
        for node in nodes
        if node.is_survey is None and _S2_RESOLVABLE_RE.fullmatch(node.id)
    ]
    if not unknown:
        return
    try:
        flags = lookup_review_flags([node.id for node in unknown])
    except s2.S2Error as exc:
        log.warning("survey lookup failed for %d papers: %s", len(unknown), exc)
        return
    for node in unknown:
        node.is_survey = flags.get(node.id)
