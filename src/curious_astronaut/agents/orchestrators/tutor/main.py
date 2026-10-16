"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The tutor: the agent behind the knowledge network (Phase 5b), a short course
on what a reader needs to know before a paper makes sense.

Two jobs, one agent id (and so one configured model):

* ``expand`` breaks one item of the course into the **concepts** it needs.
  One structured call, returned whole: the frontend shows a turning ring on
  the node and then the new nodes at once.
* ``lesson`` teaches one item, streamed as ``Token`` events the way the
  researcher streams an answer.
* ``name_synthesis`` and ``synthesis_lesson`` (v8.23.0) serve a **synthesis**: an optional
  node the reader (or, later, the tutor) makes from several concepts, which
  names what they become together and teaches how they combine toward the
  item they build toward. Syntheses sit beside the course, never in its
  teaching order, so nothing here touches ``expand``.
* ``fit_section`` (v8.23.0) rewrites only a lesson's closing "How it fits
  in" section (``FIT_HEADING``), when the items needing its subject have
  changed since it was written; the rest of the lesson stays as it is.

**The graph holds ideas; papers live in the lessons** (Patrick, 2026-10-09).
The graph started with paper nodes too, grounded in the reference list.
They were dropped because a paper bundles several ideas and so sits at a
different level from "Bellman equations", and the reader needs the ideas.
The real reference list still grounds the course where it matters most:
the expansion of the paper sees it, to judge which ideas the paper actually
builds on, so the course is tied to the literature rather than to whatever
a term suggests. **Lessons no longer cite** (Patrick, v8.17.0). From v8.14.0
they cited the reference list by number (``[3]``), resolved server-side to
the real papers; it was grounded, but it read oddly ("bare numbers read as
footnotes", and every lesson cited the *root* paper's list however deep it
sat). A suggestions section of vetted resources is the planned replacement
(the OnePager's "Verified resources").

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
from typing import Iterator, Literal

from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent
from pydantic_ai.messages import PartDeltaEvent, PartStartEvent, ToolCallPart, ToolCallPartDelta
from pydantic_ai.run import AgentRunResultEvent

from ... import events, factory, prompts, streams
from .config import (
    AGENT_ID,
    EXPAND_PROMPT,
    FIT_PROMPT,
    LESSON_PROMPT,
    SKILLS,
    SYNTHESIS_NAME_PROMPT,
    SYNTHESIS_PROMPT,
)

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


class Need(BaseModel):
    """An item that needs a lesson's subject, and why (v8.23.0)."""

    model_config = ConfigDict(extra="forbid")

    title: str
    kind: Kind
    why: str


class SynthesisName(BaseModel):
    """A synthesis's name and what it gives the item it builds toward."""

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
synthesis_name_agent: Agent[None, SynthesisName] = Agent(
    output_type=SynthesisName,
    instructions=[SYNTHESIS_NAME_PROMPT],
)
synthesis_agent: Agent[None, Lesson] = Agent(
    output_type=Lesson,
    instructions=[SYNTHESIS_PROMPT, *(prompts.skill(name) for name in SKILLS)],
)
fit_agent: Agent[None, Lesson] = Agent(
    output_type=Lesson,
    instructions=[FIT_PROMPT, *(prompts.skill(name) for name in SKILLS)],
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
    result = streams.run(expand_agent.run("".join(parts), model=factory.model_for(AGENT_ID)))

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


def _needs_block(needed_by: list[Need]) -> str:
    """The items that need a subject, each with why, as a prompt block.

    Args:
        needed_by: Those items.

    Returns:
        The block, or '' for none.
    """
    if not needed_by:
        return ""
    lines = "\n".join(f"- {need.title} ({need.kind}): {need.why}" for need in needed_by)
    return f"NEEDED BY:\n{lines}\n\n"


def lesson(
    item: Step,
    why: str,
    path: list[Step],
    abstract: str,
    needed_by: list[Need] | None = None,
) -> Iterator[events.Event]:
    """Teach one course item, streamed.

    Args:
        item: The subject of the lesson.
        why: What the item above it needs it for ('' at the root).
        path: The course path above it, root first.
        abstract: The paper's abstract when the item is the paper ('' otherwise).
        needed_by: Every item that needs it, each with why (v8.23.0), for the
            closing "How it fits in" section.

    Yields:
        ``Token`` events carrying the lesson's Markdown as it is written. The
        caller wraps this in
        ``streams.terminated`` for the closing ``Done``/``Error``.

    Raises:
        RuntimeError: When the run ends without a lesson.
    """
    words = factory.agent_entry(AGENT_ID).extras["lesson_words"]
    parts = [f"SUBJECT: {item.title} ({item.kind})\n\n", _path_block(path)]
    if why:
        parts.append(f"WHY THE COURSE NEEDS IT: {why}\n\n")
    parts.append(_needs_block(needed_by or []))
    if abstract:
        parts.append(f"ABSTRACT: {abstract}\n\n")
    parts.append(f"Aim for about {words} words.")

    yield from _stream_text(lesson_agent, "".join(parts))


def _stream_text(agent: Agent[None, Lesson], prompt: str) -> Iterator[events.Event]:
    """Run a lesson-shaped agent and stream its ``text`` field as it is written.

    The output arrives as a tool call's JSON arguments; the text so far is
    read out of the partial JSON (``streams.partial_text``) and emitted as it
    grows.

    Args:
        agent: The lesson or synthesis agent.
        prompt: The run's user prompt.

    Yields:
        ``Token`` events carrying the Markdown as it is written.

    Raises:
        RuntimeError: When the run ends without a result.
    """
    output_part: int | None = None
    args_buffer = ""
    emitted = ""
    final: Lesson | None = None
    for event in streams.drive(agent, prompt, model=factory.model_for(AGENT_ID)):
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


def _members_block(members: list[Step]) -> str:
    """A synthesis's concepts as a prompt block.

    Args:
        members: The concepts synthesized.

    Returns:
        The block.
    """
    return "CONCEPTS:\n" + "\n".join(f"- {member.title}" for member in members) + "\n\n"


def name_synthesis(members: list[Step], toward: Step, path: list[Step]) -> SynthesisName:
    """Name what several concepts become together, toward one item.

    Args:
        members: The concepts synthesized (two or more).
        toward: The item they build toward (the paper, or a concept).
        path: The course path above ``toward``, root first.

    Returns:
        The synthesis's name and what it gives ``toward``.

    Raises:
        Exception: Model failures propagate; the route answers 502.
    """
    prompt = (
        _members_block(members)
        + f"THEY BUILD TOWARD: {toward.title} ({toward.kind})\n\n"
        + _path_block(path)
    )
    result = streams.run(synthesis_name_agent.run(prompt, model=factory.model_for(AGENT_ID)))
    return SynthesisName(name=result.output.name.strip(), why=result.output.why.strip())


def synthesis_lesson(
    name: str, members: list[Step], toward: Step, path: list[Step]
) -> Iterator[events.Event]:
    """Teach how a synthesis's concepts come together, streamed.

    Args:
        name: The synthesis's name.
        members: The concepts it synthesizes.
        toward: The item they build toward.
        path: The course path above ``toward``, root first.

    Yields:
        ``Token`` events carrying the lesson's Markdown as it is written; the
        caller wraps this in ``streams.terminated``.
    """
    words = factory.agent_entry(AGENT_ID).extras["lesson_words"]
    prompt = (
        f"SYNTHESIS: {name}\n\n"
        + _members_block(members)
        + f"THEY BUILD TOWARD: {toward.title} ({toward.kind})\n\n"
        + _path_block(path)
        + f"Aim for about {words} words."
    )
    yield from _stream_text(synthesis_agent, prompt)


def fit_section(item: Step, body: str, needed_by: list[Need]) -> str:
    """Rewrite a lesson's closing "How it fits in" section for the items that
    need its subject now (v8.23.0): one call, returned whole, since the
    section is a few sentences.

    Args:
        item: The lesson's subject.
        body: The lesson without its closing section.
        needed_by: The items that need the subject now, each with why.

    Returns:
        The section's body, without its heading.

    Raises:
        Exception: Model failures propagate; the route answers 502.
    """
    prompt = (
        f"SUBJECT: {item.title} ({item.kind})\n\n"
        + _needs_block(needed_by)
        + f"THE LESSON:\n{body}"
    )
    result = streams.run(fit_agent.run(prompt, model=factory.model_for(AGENT_ID)))
    return result.output.text.strip()
