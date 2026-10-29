"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The Criticisms card's route: what the field objected to in a paper, quoted
from the later papers that raised it. Thin over ``services/reviews``, which
picks the source (the corpus's citing sentences, else S2 live), runs the
reviewer and caches the card.

One plain JSON request, not a stream: the card has nothing to show until
the themes are grouped (~20-30s the first time), and a cached card answers
at once. ``/api/reviews/notes`` (v8.54.0) pins a card already gathered to the
paper, for the Reader's margin notes.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
from typing import Literal

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue

from ..integrations import arxiv
from ..integrations import semantic_scholar as s2
from ..services import reviews

log = logging.getLogger(__name__)

bp = Blueprint("reviews", __name__)

#: The node fields the service reads; anything else in the body is ignored.
_PAPER_FIELDS = ("id", "arxiv_id", "title", "authors", "year", "url")


@bp.post("/api/reviews")
def api_reviews() -> ResponseReturnValue:
    """The Criticisms card for one paper.

    Body:
        ``{paper: {id, arxiv_id?, title, authors?, year?, url?}, fresh?}``,
        the thread's paper as the card home holds it. ``fresh`` skips the
        cached card and replaces it.

    Returns:
        The card (``services.reviews.build``): ``{source, citers, sentences,
        critiques, themes}``. HTTP 400 for a body with no paper id, 502 when
        Semantic Scholar or the model fails.
    """
    payload = request.get_json(silent=True) or {}
    raw = payload.get("paper")
    if not isinstance(raw, dict) or not raw.get("id"):
        return jsonify({"error": "paper.id is required"}), 400
    paper = {field: raw.get(field) for field in _PAPER_FIELDS}
    try:
        card = reviews.peer_reviews(paper, fresh=payload.get("fresh") is True)
    except s2.S2Error:
        log.warning("criticisms: S2 failed for %s", paper["id"], exc_info=True)
        return jsonify({"error": "Semantic Scholar didn't answer — try again in a moment."}), 502
    except Exception:
        log.exception("criticisms failed for %s", paper["id"])
        return jsonify({"error": "The reviews couldn't be gathered — try again."}), 502
    return jsonify(card)


@bp.post("/api/reviews/notes")
def api_review_notes() -> ResponseReturnValue:
    """The Reader's criticism notes (v8.54.0): the paper's card, pinned to it.

    Only a card already gathered (``services.reviews.cached``): the Reader
    never starts a gather. The pins are cached with the card.

    Body:
        ``{paper: {id, arxiv_id?, title, …}, document, source?: "text" |
        "pdf", provider?}``: the thread's paper (the card's key), and what
        the Reader reads, an arXiv id or for the PDF a provider id too.

    Returns:
        ``{card, pins: [{criticism, section, quote}]}``; ``card`` is null and
        ``pins`` empty when no card has been gathered. HTTP 400 for a
        malformed body, 502 when the model fails.
    """
    payload = request.get_json(silent=True) or {}
    raw = payload.get("paper")
    raw_document = str(payload.get("document") or "").strip()
    document = arxiv.extract_id(raw_document) or raw_document
    source: Literal["text", "pdf"] = "pdf" if payload.get("source") == "pdf" else "text"
    provider: Literal["s2", "openalex"] = "openalex" if payload.get("provider") == "openalex" else "s2"
    if (
        not isinstance(raw, dict)
        or not raw.get("id")
        or not document
        or (source == "text" and not arxiv.looks_arxiv(document))
    ):
        return jsonify({"error": "paper.id and document are required"}), 400
    paper = {field: raw.get(field) for field in _PAPER_FIELDS}
    try:
        return jsonify(reviews.notes(paper, document, source, provider))
    except Exception:
        log.exception("criticism notes failed for %s", paper["id"])
        return jsonify({"error": "The criticisms couldn't be placed in the paper — try again."}), 502
