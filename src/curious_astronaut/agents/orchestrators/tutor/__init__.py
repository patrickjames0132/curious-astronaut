"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The tutor — the knowledge network's agent: breaks a paper or concept into
its prerequisites, and teaches each one as a lesson.

* ``main``   — the two ``Agent``s, their output models, ``expand`` and the
  streamed ``lesson``.
* ``config`` — the agent id, the two prompts, and the skill list.

The entry points are re-exported here — callers use ``tutor.expand(...)``
and ``tutor.lesson(...)`` without reaching into submodules.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from .main import (
    Child,
    Lesson,
    Prerequisite,
    Prerequisites,
    Step,
    expand,
    lesson,
)

__all__ = [
    "Child",
    "Lesson",
    "Prerequisite",
    "Prerequisites",
    "Step",
    "expand",
    "lesson",
]
