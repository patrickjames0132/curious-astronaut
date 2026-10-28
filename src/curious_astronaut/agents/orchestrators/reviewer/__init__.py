"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The reviewer: the Criticisms card's themes — what later papers objected to
in a paper, quoted from the sentences in which they cite it.

* ``main``   — the judge and group ``Agent``s, their output models, the
  id verification, and the ``review`` entry point.
* ``config`` — the two borrowed agent ids, the two system prompts, and the
  batch sizes.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from .main import (
    Review,
    Sentence,
    Target,
    Theme,
    group_agent,
    judge_agent,
    review,
    verify,
)

__all__ = [
    "Review",
    "Sentence",
    "Target",
    "Theme",
    "group_agent",
    "judge_agent",
    "review",
    "verify",
]
