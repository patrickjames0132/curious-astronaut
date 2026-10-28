"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The reviewer: what the field objected to in a paper, from the sentences in
which later papers cite it.

Two passes, prototyped 2026-10-24 (see ``README.md``):

1. **Judge.** The cheap model reads every sentence, in batches, and marks
   each a critique *of this paper* or not, with the weakness in a few words.
   About 4% are, measured on landmarks: most citations are background.
2. **Group.** The strong model merges the critiques into at most
   ``MAX_THEMES`` themes, citing sentence ids.

Then **code checks every id**: a theme keeps only ids that name a sentence
the judge called a critique, and a theme left with none is dropped. So a
quote on the card is always a real sentence from a real citing paper, word
for word; the models choose and group, they never write a quote.

Model failures propagate (the route answers 502); a verdict missing from a
batch counts as not a critique.

**Pins** (v8.54.0, ``place``): a third, separate call for the Reader's margin
notes, once a card exists. The strong model reads the paper's sections and
pins a criticism to the passage it is about, quoting it; code keeps a pin
only when its criticism and section exist and its quote is really in that
section's text, so a note always points at the paper's own words.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai import Agent

from ... import factory, streams
from ..tutor import PaperSection
from .config import (
    GROUP_AGENT_ID,
    GROUP_SYSTEM_PROMPT,
    JUDGE_AGENT_ID,
    JUDGE_BATCH,
    JUDGE_CONCURRENCY,
    JUDGE_SYSTEM_PROMPT,
    MAX_THEMES,
    PLACE_AGENT_ID,
    PLACE_CHARS,
    PLACE_MAX_PINS,
    PLACE_MIN_CHARS,
    PLACE_SYSTEM_PROMPT,
)

log = logging.getLogger(__name__)


class Target(BaseModel):
    """The paper under review, as the models are told about it."""

    model_config = ConfigDict(extra="forbid")

    title: str
    authors: str | None = None
    year: int | None = None


class Sentence(BaseModel):
    """One citing sentence, with the id the models refer to it by."""

    model_config = ConfigDict(extra="forbid")

    id: str
    text: str
    year: int | None = None


class Judgement(BaseModel):
    """One sentence's verdict (see ``JUDGE_SYSTEM_PROMPT``)."""

    model_config = ConfigDict(extra="forbid")

    id: str
    verdict: Literal["critique", "not_critique"]
    point: str = Field(default="", description="If a critique: the weakness, in <= 12 words.")


class Judgements(BaseModel):
    """The judge's structured output for one batch."""

    model_config = ConfigDict(extra="forbid")

    items: list[Judgement]


class Theme(BaseModel):
    """One grouped concern (see ``GROUP_SYSTEM_PROMPT``)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    summary: str
    sentence_ids: list[str]


class Themes(BaseModel):
    """The grouper's structured output."""

    model_config = ConfigDict(extra="forbid")

    themes: list[Theme]


class Review(BaseModel):
    """The reviewer's verified answer: themes whose ids all name critiques."""

    model_config = ConfigDict(extra="forbid")

    themes: list[Theme]
    critiques: int
    judged: int


class Pin(BaseModel):
    """Where in the paper one criticism applies (see ``PLACE_SYSTEM_PROMPT``)."""

    model_config = ConfigDict(extra="forbid")

    criticism: int
    section: str
    quote: str


class Pins(BaseModel):
    """The placer's structured output."""

    model_config = ConfigDict(extra="forbid")

    pins: list[Pin]


class Criticism(BaseModel):
    """One of a card's criticisms, as the placer is told about it."""

    model_config = ConfigDict(extra="forbid")

    number: int
    name: str
    summary: str


# No model at construction: each run passes `factory.model_for`, so a blank
# config can't stop the app booting and a settings edit needs no restart.
judge_agent: Agent[None, Judgements] = Agent(output_type=Judgements, instructions=[JUDGE_SYSTEM_PROMPT])
group_agent: Agent[None, Themes] = Agent(output_type=Themes, instructions=[GROUP_SYSTEM_PROMPT])
place_agent: Agent[None, Pins] = Agent(output_type=Pins, instructions=[PLACE_SYSTEM_PROMPT])


def _target_line(target: Target) -> str:
    """How the target is named in both prompts.

    Args:
        target: The paper under review.

    Returns:
        ``TARGET: <title> (<first author> et al., <year>)``, as much of the
        byline as is known. The byline matters: sentences cite by author-year
        as often as by number.
    """
    first_author = (target.authors or "").split(",")[0].strip()
    byline = ", ".join(part for part in (f"{first_author} et al." if first_author else "",
                                         str(target.year) if target.year else "") if part)
    return f"TARGET: {target.title}" + (f" ({byline})" if byline else "")


async def _judge(target: Target, sentences: list[Sentence]) -> list[Judgement]:
    """The judge pass: every sentence, in concurrent batches.

    Args:
        target: The paper under review.
        sentences: Every citing sentence.

    Returns:
        The verdicts the model returned for ids it was given (others are
        dropped, so a verdict can't invent a sentence).
    """
    model = factory.model_for(JUDGE_AGENT_ID)
    gate = asyncio.Semaphore(JUDGE_CONCURRENCY)
    header = _target_line(target) + "\n\n"

    async def one_batch(batch: list[Sentence]) -> list[Judgement]:
        """Judge one batch.

        Args:
            batch: Its sentences.

        Returns:
            The verdicts for this batch's ids.
        """
        prompt = header + "\n".join(f"[{sentence.id}] {sentence.text}" for sentence in batch)
        async with gate:
            result = await judge_agent.run(prompt, model=model)
        given = {sentence.id for sentence in batch}
        return [item for item in result.output.items if item.id in given]

    batches = [sentences[start : start + JUDGE_BATCH] for start in range(0, len(sentences), JUDGE_BATCH)]
    results = await asyncio.gather(*(one_batch(batch) for batch in batches))
    return [item for batch in results for item in batch]


async def _group(target: Target, critiques: list[tuple[Sentence, str]]) -> Themes:
    """The grouping pass over the judged critiques.

    Args:
        target: The paper under review.
        critiques: Each critique sentence with the judge's one-line point.

    Returns:
        The model's themes, unverified.
    """
    prompt = _target_line(target) + "\n\n" + "\n".join(
        f"[{sentence.id}] ({sentence.year or 'n.d.'}) {sentence.text}  -- point: {point}"
        for sentence, point in critiques
    )
    result = await group_agent.run(prompt, model=factory.model_for(GROUP_AGENT_ID))
    return result.output


def verify(themes: Themes, critique_ids: set[str]) -> list[Theme]:
    """Keep only what the sentences support: real critique ids, non-empty themes.

    Args:
        themes: The grouper's output.
        critique_ids: The ids the judge called critiques.

    Returns:
        At most ``MAX_THEMES`` themes, each listing only ids in
        ``critique_ids`` (deduplicated, in the model's order); a theme left
        with none is dropped, and its loss logged.
    """
    verified = []
    for theme in themes.themes:
        ids = list(dict.fromkeys(sid for sid in theme.sentence_ids if sid in critique_ids))
        dropped = [sid for sid in theme.sentence_ids if sid not in critique_ids]
        if dropped:
            log.warning("reviewer: theme %r cited ids that aren't critiques: %s", theme.name, dropped)
        if ids:
            verified.append(Theme(name=theme.name, summary=theme.summary, sentence_ids=ids))
    return verified[:MAX_THEMES]


async def _review(target: Target, sentences: list[Sentence]) -> Review:
    """Both passes and the verification, on the agent loop.

    Args:
        target: The paper under review.
        sentences: Every citing sentence.

    Returns:
        The verified review.
    """
    verdicts = await _judge(target, sentences)
    by_id = {sentence.id: sentence for sentence in sentences}
    critiques = [(by_id[item.id], item.point) for item in verdicts if item.verdict == "critique"]
    if not critiques:
        return Review(themes=[], critiques=0, judged=len(sentences))
    themes = await _group(target, critiques)
    return Review(
        themes=verify(themes, {sentence.id for sentence, _point in critiques}),
        critiques=len(critiques),
        judged=len(sentences),
    )


def review(target: Target, sentences: list[Sentence]) -> Review:
    """What the field objected to in ``target``, from the sentences citing it.

    Args:
        target: The paper under review.
        sentences: Every citing sentence to judge, each with a unique id.

    Returns:
        The verified review; no themes when no sentence is a critique (and no
        model call at all when there are no sentences).

    Raises:
        Exception: Model failures propagate; the route answers 502.
    """
    if not sentences:
        return Review(themes=[], critiques=0, judged=0)
    return streams.run(_review(target, sentences))


def comparable(text: str) -> str:
    """Text reduced to what a quote check reads: lowercase letters and digits.

    The frontend finds a quote the same way (``reader/passages.ts``), so a
    pin this keeps is one the Reader can find.

    Args:
        text: Any text.

    Returns:
        Its letters and digits, lowercased; ligatures spelled out.
    """
    spelled = text.replace("ﬁ", "fi").replace("ﬂ", "fl").replace("ﬀ", "ff").replace("ﬃ", "ffi").replace("ﬄ", "ffl")
    return "".join(char for char in spelled.lower() if char.isalnum())


def verify_pins(pins: Pins, criticisms: list[Criticism], sections: list[PaperSection]) -> list[Pin]:
    """Keep only pins that point at the paper's own words.

    Args:
        pins: The placer's output.
        criticisms: The card's criticisms, by number.
        sections: The sections it was shown.

    Returns:
        Pins whose criticism and section exist and whose quote is in that
        section's text (compared as :func:`comparable`), at most
        ``PLACE_MAX_PINS`` a criticism and one per passage, in the paper's
        order; each one dropped is logged.
    """
    numbers = {criticism.number for criticism in criticisms}
    texts = {section.id: comparable(section.heading + " " + section.text) for section in sections}
    order = {section.id: index for index, section in enumerate(sections)}
    kept: list[Pin] = []
    per_criticism: dict[int, int] = {}
    seen: set[tuple[int, str]] = set()
    for pin in pins.pins:
        quote = " ".join(pin.quote.split())
        wanted = comparable(quote)
        if pin.criticism not in numbers or pin.section not in texts or len(wanted) < 12:
            log.info("reviewer: dropped pin %s in %r", pin.criticism, pin.section)
            continue
        if wanted not in texts[pin.section]:
            log.info("reviewer: pin %s quotes text not in %r: %r", pin.criticism, pin.section, quote)
            continue
        if (pin.criticism, wanted) in seen or per_criticism.get(pin.criticism, 0) >= PLACE_MAX_PINS:
            continue
        seen.add((pin.criticism, wanted))
        per_criticism[pin.criticism] = per_criticism.get(pin.criticism, 0) + 1
        kept.append(Pin(criticism=pin.criticism, section=pin.section, quote=quote))
    return sorted(kept, key=lambda pin: (order[pin.section], pin.criticism))


def place(criticisms: list[Criticism], sections: list[PaperSection]) -> list[Pin]:
    """Pin a card's criticisms to the passages of the paper they are about.

    One structured call over the paper's sections, each cut to its share of
    ``PLACE_CHARS`` so a long paper still fits, then :func:`verify_pins`.

    Args:
        criticisms: The card's criticisms, numbered as the card numbers them.
        sections: The paper's sections, in order.

    Returns:
        The verified pins; none (and no model call) without criticisms or
        sections. A criticism with nothing in the paper to point at has none.

    Raises:
        Exception: Model failures propagate; the route answers 502.
    """
    if not criticisms or not sections:
        return []
    share = max(PLACE_MIN_CHARS, PLACE_CHARS // len(sections))
    parts = ["THE PAPER'S SECTIONS:\n"]
    for section in sections:
        text = section.text[:share] + (" …" if len(section.text) > share else "")
        parts.append(f"\n[{section.id}] {section.heading}\n{text}\n")
    parts.append("\nTHE CRITICISMS:\n")
    parts.extend(f"{criticism.number}. {criticism.name}: {criticism.summary}\n" for criticism in criticisms)
    result = streams.run(place_agent.run("".join(parts), model=factory.model_for(PLACE_AGENT_ID)))
    return verify_pins(result.output, criticisms, sections)
