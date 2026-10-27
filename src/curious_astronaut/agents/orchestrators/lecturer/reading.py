"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The guided read (v8.50.0, the Reader card's last planned stage): a lecture
of the paper open in the Reader, beat by beat in the paper's own order, each
beat lighting the passage it teaches.

The graph lecture's sibling, sharing its model (the lecturer's entry in
Agent Settings) and its streaming (``main.streamed_beats``: a beat is sent
the moment the next begins, so the first is lit while the rest are still
being written). What differs is what a beat points at. A graph lecture's
beat names papers to glow; a guided read's names **a passage**: the paper's
exact words (``quote``, found in either of the Reader's views as an answer's
quotes are) and the label of an equation, figure or table it teaches
(``label``, "(3)", "Figure 2"), which both views light whole.

Its reading is the Reader Assistant's (``assistant.context.reading_context``):
the document or the PDF's pages, the section or page in view first. The
student's Knowledge Graph check-offs, when sent, tell it what to take
quickly.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
from typing import Iterator

from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent

from ....services.pdf.passages import SECTION_MARK
from ... import events, factory, prompts
from .config import AGENT_ID, READING_BEATS, READING_SKILLS, READING_SYSTEM_PROMPT
from .main import streamed_beats

log = logging.getLogger(__name__)

LABEL_CHARS = 24
"""The longest label kept: "Algorithm 12", "(14a)"; anything longer is prose."""


class ReadingBeat(BaseModel):
    """One beat of a guided read as the model emits it."""

    model_config = ConfigDict(extra="forbid")

    heading: str
    text: str
    quote: str | None = None
    label: str | None = None
    section: str | None = None


# No model at construction: passed per run by `factory.model_for`, as the
# graph lecture's is.
agent: Agent[None, list[ReadingBeat]] = Agent(
    output_type=list[ReadingBeat],
    instructions=[READING_SYSTEM_PROMPT, *(prompts.skill(name) for name in READING_SKILLS)],
)


def _prompt(reading: str, known: list[str], learning: list[str]) -> str:
    """The guided read's prompt: the paper, and the student.

    A whole paper always (Patrick, 2026-10-25: a lecture on one section was
    dropped; the button is the paper's, by its title).

    Args:
        reading: The paper laid out (``assistant.context.reading_context``).
        known: Concepts the student has checked off in its Knowledge Graph.
        learning: Concepts in its course they haven't.

    Returns:
        The prompt.
    """
    task = (
        "Guide the student through the WHOLE paper, from its opening to its "
        f"conclusion, in {READING_BEATS} beats, whatever section they are in now."
    )
    student = ""
    if known:
        student += (
            "\n\nThe student has checked these off as already known, so take them "
            "quickly, a clause rather than a lesson: " + "; ".join(known[:40]) + "."
        )
    if learning:
        student += (
            "\n\nThe paper's course says the student is still learning these, so "
            "slow down and explain them when the paper leans on them: "
            + "; ".join(learning[:40])
            + "."
        )
    return f"{task}{student}\n\n{reading}\n\nNow give the guided read."


def _label(raw: str | None) -> list[str]:
    """A beat's label as the Reader matches it, or none.

    Args:
        raw: The model's label: "(3)", "Figure 2", "Eq. (3)", "Table 1.".

    Returns:
        The label in a list, cleaned ("Eq. (3)" reads "(3)"), or empty.
    """
    label = (raw or "").strip().rstrip(".")
    if not label or len(label) > LABEL_CHARS:
        return []
    if "(" in label and label.endswith(")"):
        label = label[label.rindex("(") :]
    return [label]


def guided_read(
    reading: str,
    known: list[str] | None = None,
    learning: list[str] | None = None,
) -> Iterator[events.Beat]:
    """Stream a guided read of the paper open in the Reader as beats.

    Args:
        reading: The paper laid out for the model (``assistant.context.reading_context``).
        known: Concepts the student knows, from its Knowledge Graph.
        learning: Concepts they're still learning.

    Yields:
        One ``events.Beat`` per beat, each once it is complete, with its
        ``quote`` and ``labels`` and no papers. Beats with blank text are
        dropped.

    Raises:
        Exception: Model/stream failures propagate — the caller ends the
            event stream with ``Error``.
    """
    prompt = _prompt(reading, known or [], learning or [])
    model = factory.model_for(AGENT_ID)
    for beat in streamed_beats(agent, prompt, ReadingBeat, model):
        text = beat.text.strip()
        if not text:
            continue
        quote = (beat.quote or "").strip() or None
        section = (beat.section or "").strip()
        # A whole section rides as a label too ("§6 Conclusion", v8.50.0),
        # so both of the Reader's views light it as they light a figure's.
        labels = [f"{SECTION_MARK}{section[:80]}"] if section else _label(beat.label)
        yield events.Beat(
            heading=beat.heading.strip(),
            text=text,
            node_ids=[],
            quote=quote,
            labels=labels,
        )
