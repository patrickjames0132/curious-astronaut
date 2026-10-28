"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The screen → tools table: what the assistant may do in each view.

A question is asked *from* somewhere — a chat with no view open, a paper's
Citation Graph, its Knowledge Graph course, its Reader — and where it is
asked decides which workflows can run and whether the researcher may search
the literature. Until v9.0.0 that knowledge was spread over four routes as
a ``paper_search=False`` here and a missing endpoint there; this table is the
one place it is written down, and ``main.run`` refuses anything it doesn't
list.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, get_args

#: Where a question is asked from. ``general`` is a chat with no view open.
ViewKind = Literal["general", "citations", "knowledge", "reader"]
#: What a question can set running: an answer (the researcher), a lecture
#: over the graph (the lecturer), or a guided read of the paper in the Reader.
Workflow = Literal["answer", "lecture", "guide"]

VIEW_KINDS: tuple[ViewKind, ...] = get_args(ViewKind)


@dataclass(frozen=True)
class Capabilities:
    """What one view lets the assistant do.

    Attributes:
        workflows: The workflows a question here may run; ``answer`` always.
        paper_search: Whether the researcher may search the literature. Only
            with no view open: a view is its own map, and finding papers is
            the general chat's job (v8.28.0). The bar's paper filters bound
            that search, so they are read only where it runs.
    """

    workflows: tuple[Workflow, ...]
    paper_search: bool


CAPABILITIES: dict[ViewKind, Capabilities] = {
    "general": Capabilities(workflows=("answer",), paper_search=True),
    "citations": Capabilities(workflows=("answer", "lecture"), paper_search=False),
    "knowledge": Capabilities(workflows=("answer",), paper_search=False),
    "reader": Capabilities(workflows=("answer", "guide"), paper_search=False),
}


def view_kind(raw: object) -> ViewKind | None:
    """Read the kind off a request's ``view``.

    Args:
        raw: The request's ``view`` object.

    Returns:
        Its kind, or None when it has none this table knows.
    """
    kind = raw.get("kind") if isinstance(raw, dict) else None
    for known in VIEW_KINDS:
        if kind == known:
            return known
    return None
