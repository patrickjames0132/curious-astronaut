"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Growing a built graph from the Citation Graph's own controls (v8.18.0), with no
agent involved: expanding any paper on it, and finding the citations among
the papers already on it.

``expand`` is the reader's twin of the researcher's ``expand_node``: one hop
of references or citations from a paper, merged onto the same graph. It keeps
v7.5.0's rule that the graph draws only edges somebody actually wrote, and it
is pure: ``hop_hits`` fetches the hop and ``expand`` decides what to add.

``hop_hits`` sizes a hop the way the build sizes the seed's neighbourhood
(v8.18.0's polish): **every reference**, since a reference list is short, and
**citers banded by the tau rule** over the paper's whole history, through
the build's own citation step (``build.s2_citations`` /
``build.openalex_citations``) and the reader's build shape. Until then a hop
took the researcher's ``expand_limit`` (8), and its citers came from one
newest-first page of S2's live endpoint, so they leaned recent; the
researcher's ``expand_node`` still does, being an agent's budgeted tool.

``links_between`` answers "which of these papers cite each other?". Until it
existed, a graph showed only the edges to its seed, plus whatever an expansion
had drawn. Each paper's reference list is cached on its own for a day, so a
graph that grows by a few papers re-asks the provider for those few only.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from ...config import config
from ...integrations import openalex
from ...integrations import semantic_scholar as s2
from ...storage import cache
from .build import Provider, openalex_citations, s2_citations
from .model import Edge, Node
from .shape import BuildShape

#: The two hops an expansion can take, as the route names them.
Hop = Literal["references", "citations"]

#: The most papers ``links_between`` reads in one request: it bounds a forged
#: request. An adaptive graph is a few hundred papers, well under it; a
#: user-sized build big enough to pass it gets the links among its first
#: ``MAX_LINK_IDS`` papers.
MAX_LINK_IDS = 2000


@dataclass
class Growth:
    """What one expansion adds: the new papers and every edge it found.

    Attributes:
        nodes: Papers not yet on the graph, most-cited first.
        edges: An edge for each new paper, plus one for each neighbour that
            was already on the graph: the citation is real even when both
            papers were.
    """

    nodes: list[Node]
    edges: list[Edge]


def hop_hits(
    node_id: str, hop: Hop, provider: Provider, shape: BuildShape, arxiv_id: str | None = None
) -> list[dict]:
    """One hop from a paper on the graph, sized like the seed's (day-cached).

    References: all of them. Citations: the tau-banded landmarks and latest
    citers, exactly as the build picks the seed's, so the reader's build
    shape governs both.

    Args:
        node_id: The paper's node id.
        hop: ``references`` or ``citations``.
        provider: The graph's provider.
        shape: The reader's build shape.
        arxiv_id: The paper's arXiv id, when it has one: the corpus resolves
            on it first (a ``CorpusId:`` node id resolves without it).

    Returns:
        ``[{"node", "influential"?}]`` entries; empty when the provider can't
        resolve the paper.

    Raises:
        s2.S2Error: When an S2 request fails after retries.
        openalex.OpenAlexError: When an OpenAlex request fails after retries.
    """
    cache_key = f"hop:v1:{provider}:{hop}:{node_id}{shape.cache_suffix()}"
    cached = cache.get(cache_key, config.graph.cache_ttl)
    if cached is not None:
        return list(cached)
    hits: list[dict]
    if provider == "openalex":
        work = openalex.resolve_seed_work(node_id)
        work_id = openalex.bare_work_id(work) if work else None
        if not work_id:
            return []
        if hop == "references":
            hits = openalex.references(work_id)
        else:
            landmark, latest = openalex_citations(work_id, shape)
            hits = landmark + latest
    elif hop == "references":
        hits = s2.references(node_id)
    else:
        landmark, latest, _source = s2_citations(
            {"id": node_id, "arxiv_id": arxiv_id}, node_id, shape
        )
        hits = landmark + latest
    cache.set(cache_key, hits)
    return hits


def expand(
    origin_id: str, hop: Hop, hits: list[dict], known_ids: set[str], limit: int | None = None
) -> Growth:
    """Decide what one hop from a paper adds to the graph.

    ``hits`` arrive most-cited first. The ones already on the graph cost
    nothing and are always linked, and up to ``limit`` new papers join them,
    so a paper whose top references are mostly on the graph already still
    brings in ``limit`` new ones rather than a handful.

    Args:
        origin_id: The paper being expanded.
        hop: ``references`` (papers it cites) or ``citations`` (papers citing it).
        hits: The hop's ``[{"node", "influential"?}]`` entries, most-cited first.
        known_ids: Every paper id on the graph now.
        limit: The most new papers to add; None adds every one (the Expand
            buttons, whose hop is already sized by ``hop_hits``).

    Returns:
        The new papers and the edges.
    """
    rel_tag: Literal["reference", "citation"] = "reference" if hop == "references" else "citation"
    nodes: list[Node] = []
    edges: list[Edge] = []
    added: set[str] = set()
    for hit in hits:
        neighbor = hit["node"]
        neighbor_id = neighbor["id"]
        if neighbor_id == origin_id or neighbor_id in added:
            continue
        is_new = neighbor_id not in known_ids
        if is_new and limit is not None and len(nodes) >= limit:
            continue
        # Same direction rule as build_graph and expand_node: an edge points
        # from the citing paper to the cited one.
        influential = hit.get("influential", False)
        if rel_tag == "reference":
            edges.append(Edge(source=origin_id, target=neighbor_id, type="reference",
                              influential=influential))
        else:
            edges.append(Edge(source=neighbor_id, target=origin_id, type="citation",
                              influential=influential))
        if is_new:
            added.add(neighbor_id)
            nodes.append(Node(**neighbor, rels=[rel_tag], is_seed=False))
    return Growth(nodes=nodes, edges=edges)


def _reference_cache_key(provider: Provider, node_id: str) -> str:
    """The cache key for one paper's reference list.

    Args:
        provider: The graph's provider.
        node_id: The paper's node id.

    Returns:
        The key.
    """
    return f"refs:v2:{provider}:{node_id}"


def _references(node_ids: list[str], provider: Provider) -> dict[str, tuple[str, list[str]]]:
    """Each paper's identity key and the keys it cites, from cache or the provider.

    The key is what reference lists name papers by: the node id itself on S2,
    the OpenAlex work id on OpenAlex. A paper the provider can't resolve is
    cached as ``None`` too, so it isn't asked about again every time the
    graph grows.

    Args:
        node_ids: The papers.
        provider: The graph's provider.

    Returns:
        A map of node id to ``(key, cited keys)`` for the papers that resolved.

    Raises:
        s2.S2Error: When an S2 batch request fails after retries.
        openalex.OpenAlexError: When an OpenAlex request fails after retries.
    """
    out: dict[str, tuple[str, list[str]]] = {}
    missing: list[str] = []
    for node_id in node_ids:
        cached = cache.get(_reference_cache_key(provider, node_id), config.graph.cache_ttl)
        if cached is None:
            missing.append(node_id)
        elif cached.get("key"):
            out[node_id] = (cached["key"], cached["cites"])
    if not missing:
        return out
    if provider == "openalex":
        fetched = openalex.reference_keys(missing)
    else:
        fetched = {node_id: (node_id, cited) for node_id, cited in s2.reference_ids(missing).items()}
    for node_id in missing:
        key, cited = fetched.get(node_id, (None, []))
        cache.set(_reference_cache_key(provider, node_id), {"key": key, "cites": cited})
        if key:
            out[node_id] = (key, cited)
    return out


def links_between(node_ids: list[str], provider: Provider) -> list[tuple[str, str]]:
    """The citations among a set of papers: every pair where one cites the other.

    Args:
        node_ids: The papers on the graph (at most ``MAX_LINK_IDS`` are read).
        provider: The graph's provider.

    Returns:
        ``(citing, cited)`` node-id pairs, deduplicated.

    Raises:
        s2.S2Error: When an S2 batch request fails after retries.
        openalex.OpenAlexError: When an OpenAlex request fails after retries.
    """
    unique = list(dict.fromkeys(node_id for node_id in node_ids if node_id))[:MAX_LINK_IDS]
    references = _references(unique, provider)
    by_key = {key: node_id for node_id, (key, _) in references.items()}
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for node_id, (_, cited) in references.items():
        for cited_key in cited:
            target = by_key.get(cited_key)
            pair = (node_id, target) if target else None
            if pair and target != node_id and pair not in seen:
                seen.add(pair)
                pairs.append(pair)
    return pairs
