"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The tutor — the knowledge network's agent: breaks a paper or concept into
its prerequisites, and teaches each one as a lesson.

* ``main``   — the ``Agent``s, their output models, ``expand``, the
  streamed ``lesson``, and a synthesis's ``name_synthesis`` and streamed
  ``synthesis_lesson`` (v8.23.0), and ``fit_section``, which rewrites
  only a lesson's closing "How it fits in" section (v8.23.0).
* ``config`` — the agent id, the prompts, and the skill list.

The entry points are re-exported here — callers use ``tutor.expand(...)``
and ``tutor.lesson(...)`` without reaching into submodules.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from .main import (
    Child,
    Lesson,
    Need,
    Prerequisite,
    Prerequisites,
    Step,
    SynthesisName,
    expand,
    fit_section,
    lesson,
    name_synthesis,
    synthesis_lesson,
)

__all__ = [
    "Child",
    "Lesson",
    "Need",
    "Prerequisite",
    "Prerequisites",
    "Step",
    "SynthesisName",
    "expand",
    "fit_section",
    "lesson",
    "name_synthesis",
    "synthesis_lesson",
]
