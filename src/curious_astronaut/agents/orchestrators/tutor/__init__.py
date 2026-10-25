"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The tutor — the knowledge network's agent: breaks a paper or concept into
its prerequisites, and teaches each one as a lesson.

* ``main``   — the ``Agent``s, their output models, ``expand`` and
  ``name_phrase`` (v8.25.0, a highlighted passage's concept), the
  streamed ``lesson``, and a synthesis's ``name_synthesis`` and streamed
  ``synthesis_lesson`` (v8.23.0), and ``fit_section``, which rewrites
  only a lesson's closing "How it fits in" section (v8.23.0), and
  ``place`` (v8.44.0), which finds where in the paper each concept is
  needed, for the Reader's margin notes.
* ``images`` — a lesson's image tools (v8.24.0): ``find_images`` and
  ``show_image``, which a lesson written with images carries, and
  ``image_bytes`` / ``web_image_url``, which serve what they found.
* ``config`` — the agent id, the prompts, and the skill list.

The entry points are re-exported here — callers use ``tutor.expand(...)``
and ``tutor.lesson(...)`` without reaching into submodules.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from . import images
from .main import (
    Child,
    Lesson,
    LessonEvent,
    Need,
    PaperSection,
    Pictures,
    Prerequisite,
    Prerequisites,
    Step,
    SynthesisName,
    expand,
    fit_section,
    lesson,
    name_phrase,
    name_synthesis,
    place,
    synthesis_lesson,
)

__all__ = [
    "Child",
    "Lesson",
    "LessonEvent",
    "Need",
    "PaperSection",
    "Pictures",
    "Prerequisite",
    "Prerequisites",
    "Step",
    "SynthesisName",
    "expand",
    "fit_section",
    "images",
    "lesson",
    "name_phrase",
    "name_synthesis",
    "place",
    "synthesis_lesson",
]
