"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The Reader card's backend services. The document itself is parsed in
``integrations/arxiv/document.py`` and the PDF served by ``services/pdf``;
this package holds what joins the paper to the rest of the app: its
bibliography matched to the papers it names (``citations``), for the
citation cards.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from .citations import get_citations, match

__all__ = ["get_citations", "match"]
