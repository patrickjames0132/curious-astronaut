"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The tutor: the agent behind the knowledge network (Phase 5b), a short course
on what a reader needs to know before a paper makes sense.

Two jobs, one agent id (and so one configured model):

* ``expand`` breaks one item of the course into the **concepts** it needs.
  One structured call, returned whole: the frontend shows a turning ring on
  the node and then the new nodes at once.
* ``lesson`` teaches one item, streamed as ``Token`` events the way the
  researcher streams an answer, then a ``PaperRefs`` event for the papers it
  cited.

**The graph holds ideas; papers live in the lessons** (Patrick, 2026-10-09).
The graph started with paper nodes too, grounded in the reference list.
They were dropped because a paper bundles several ideas and so sits at a
different level from "Bellman equations", and the reader needs the ideas.
The real reference list still grounds the course in two places. The
expansion of the paper sees it, to judge which ideas the paper builds on.
Every lesson sees it, numbered, and may cite a paper **only by its number**.
``PaperRefs`` resolves the numbers the text actually used, in range, so a
paper the provider doesn't know can never appear as a citation. This keeps
the course tied to the actual literature, which is what sets it apart from
expand-a-term tools (see the OnePager's Phase 5).

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
import re
from typing import Iterator, Literal

from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent
from pydantic_ai.messages import PartDeltaEvent, PartStartEvent, ToolCallPart, ToolCallPartDelta
from pydantic_ai.run import AgentRunResultEvent

from ... import events, factory, prompts, streams
from .config import AGENT_ID, EXPAND_PROMPT, LESSON_PROMPT, SKILLS

log = logging.getLogger(__name__)

Kind = Literal["paper", "concept"]


class Step(BaseModel):
    """One item of the course as the tutor is told about it: a title and its kind."""

    model_config = ConfigDict(extra="forbid")

    title: str
    kind: Kind


class Prerequisite(BaseModel):
    """One prerequisite concept as the model lists it (see ``EXPAND_PROMPT``)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    why: str


class Prerequisites(BaseModel):
    """The expansion's structured output."""

    model_config = ConfigDict(extra="forbid")

    items: list[Prerequisite]


class Child(BaseModel):
    """A prerequisite concept after cleaning (no cycles, no repeats, capped)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    why: str


class Lesson(BaseModel):
    """The lesson's structured output — a typed field so no preamble leaks in."""

    model_config = ConfigDict(extra="forbid")

    text: str


# No model at construction: `factory.model_for` supplies it per run.
expand_agent: Agent[None, Prerequisites] = Agent(
    output_type=Prerequisites,
    instructions=[EXPAND_PROMPT],
)
lesson_agent: Agent[None, Lesson] = Agent(
    output_type=Lesson,
    instructions=[LESSON_PROMPT, *(prompts.skill(name) for name in SKILLS)],
)


def _path_block(path: list[Step]) -> str:
    """The course path from the paper down to (not including) the item.

    Args:
        path: Root first.

    Returns:
        The prompt block, or an empty string at the root.
    """
    if not path:
        return ""
    lines = [f"{depth}. {step.title} ({step.kind})" for depth, step in enumerate(path, 1)]
    return "PATH FROM THE PAPER DOWN TO THIS ITEM:\n" + "\n".join(lines) + "\n\n"


def _references_block(references: list[dict]) -> str:
    """The paper's reference list, numbered from 1, as a prompt block.

    Args:
        references: Reference nodes (``title``, ``year``, …).

    Returns:
        The block, or an empty string when there are none.
    """
    if not references:
        return ""
    numbered = [
        f"[{index}] {ref.get('title') or '(untitled)'}"
        + (f" ({ref['year']})" if ref.get("year") else "")
        for index, ref in enumerate(references, 1)
    ]
    return "REFERENCES:\n" + "\n".join(numbered) + "\n\n"


_MARKER = re.compile(r"\[(\d+(?:[\s,]+\d+)*)\]")
"""A ``[3]`` or ``[3, 7]`` citation marker — the same shape the researcher's
prose uses and the frontend's ``remarkCite`` renders."""


def cited_references(
    text: str, references: list[dict], provider: str
) -> dict[str, events.PaperRef]:
    """Resolve the markers a lesson actually used to the real papers.

    Args:
        text: The finished lesson.
        references: The numbered list the lesson was shown.
        provider: The backend the reference ids belong to.

    Returns:
        ``{"3": PaperRef, ...}`` for in-range markers only — a number the
        list doesn't hold resolves to nothing and renders as plain text.
    """
    refs: dict[str, events.PaperRef] = {}
    for match in _MARKER.finditer(text):
        for token in re.split(r"[\s,]+", match.group(1)):
            index = int(token)
            if 1 <= index <= len(references) and token not in refs:
                paper = references[index - 1]
                refs[token] = events.PaperRef(
                    node_id=str(paper.get("id") or ""),
                    title=str(paper.get("title") or ""),
                    url=str(paper.get("url") or ""),
                    provider="openalex" if provider == "openalex" else "s2",
                )
    return refs


def _key(name: str) -> str:
    """Compare names the way the course's concept identity does: case- and space-blind.

    Args:
        name: A title or concept name.

    Returns:
        The comparison key.
    """
    return " ".join(name.casefold().split())


def expand(
    item: Step, path: list[Step], references: list[dict], existing: list[str]
) -> list[Child]:
    """Break one course item into the concepts it needs.

    Args:
        item: The item being broken down.
        path: The course path above it, root first (empty for the paper itself).
        references: The paper's reference list, when the item is the paper —
            context for which ideas it builds on, never nodes of their own.
        existing: Names already in the course, so a repeat reuses its name.

    Returns:
        At most ``children`` concepts, most essential first.

    Raises:
        Exception: Model failures propagate; the route answers 502.
    """
    limit = factory.agent_entry(AGENT_ID).extras["children"]
    parts = [f"ITEM: {item.title} ({item.kind})\n\n", _path_block(path)]
    parts.append(_references_block(references))
    if existing:
        parts.append("ALREADY IN THE COURSE:\n" + "\n".join(existing) + "\n\n")
    parts.append(f"List at most {limit} prerequisites.")
    result = expand_agent.run_sync("".join(parts), model=factory.model_for(AGENT_ID))

    # Never the item itself or anything above it: that would be a cycle.
    banned = {_key(item.title), *(_key(step.title) for step in path)}
    children: list[Child] = []
    for listed in result.output.items:
        name = listed.name.strip()
        if not name or _key(name) in banned:
            continue
        banned.add(_key(name))
        children.append(Child(name=name, why=listed.why))
        if len(children) >= limit:
            break
    return children


def lesson(
    item: Step,
    why: str,
    path: list[Step],
    abstract: str,
    references: list[dict],
    provider: str,
) -> Iterator[events.Event]:
    """Teach one course item, streamed.

    Args:
        item: The subject of the lesson.
        why: What the item above it needs it for ('' at the root).
        path: The course path above it, root first.
        abstract: The paper's abstract when the item is the paper ('' otherwise).
        references: The paper's real reference list — the only papers the
            lesson may cite, by number.
        provider: The backend the references' ids belong to.

    Yields:
        ``Token`` events carrying the lesson's Markdown as it is written, then
        one ``PaperRefs`` when it cited anything. The caller wraps this in
        ``streams.terminated`` for the closing ``Done``/``Error``.

    Raises:
        RuntimeError: When the run ends without a lesson.
    """
    words = factory.agent_entry(AGENT_ID).extras["lesson_words"]
    parts = [f"SUBJECT: {item.title} ({item.kind})\n\n", _path_block(path)]
    if why:
        parts.append(f"WHY THE COURSE NEEDS IT: {why}\n\n")
    if abstract:
        parts.append(f"ABSTRACT: {abstract}\n\n")
    parts.append(_references_block(references))
    parts.append(f"Aim for about {words} words.")

    output_part: int | None = None
    args_buffer = ""
    emitted = ""
    final: Lesson | None = None
    for event in streams.drive(lesson_agent, "".join(parts), model=factory.model_for(AGENT_ID)):
        grew = False
        if isinstance(event, PartStartEvent) and isinstance(event.part, ToolCallPart):
            if event.part.tool_name == streams.OUTPUT_TOOL:
                output_part = event.index
                args = event.part.args
                args_buffer = args if isinstance(args, str) else ""
                grew = True
        elif (
            isinstance(event, PartDeltaEvent)
            and event.index == output_part
            and isinstance(event.delta, ToolCallPartDelta)
            and isinstance(event.delta.args_delta, str)
        ):
            args_buffer += event.delta.args_delta
            grew = True
        elif isinstance(event, AgentRunResultEvent):
            final = event.result.output
        if grew:
            grown = streams.partial_text(args_buffer)
            if len(grown) > len(emitted):
                yield events.Token(text=grown[len(emitted) :])
                emitted = grown
    if final is None:  # pragma: no cover — the run raises before this
        raise RuntimeError("tutor lesson ended without a result")
    remainder = final.text[len(emitted) :]
    if remainder:
        yield events.Token(text=remainder)
    refs = cited_references(final.text, references, provider)
    if refs:
        yield events.PaperRefs(refs=refs)
