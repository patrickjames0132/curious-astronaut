"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The Criticisms card's route: what the field objected to in a paper, quoted
from the later papers that raised it. Thin over ``services/reviews``, which
picks the source (the corpus's citing sentences, else S2 live), runs the
reviewer and caches the card.

One plain JSON request, not a stream: the card has nothing to show until
the themes are grouped (~20-30s the first time), and a cached card answers
at once.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request
from flask.typing import ResponseReturnValue

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
