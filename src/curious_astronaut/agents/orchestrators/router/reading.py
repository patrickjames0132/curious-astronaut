"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Where a message to the Reader Assistant goes (v8.50.0): a lecture of the
paper (``lecturer.guided_read``), or an answer (the researcher).

The Citation Graph's chat has the same decision (``main.route``), with
scopes that only mean something on a graph. The Reader's is smaller: a
lecture is always of the whole paper. Patrick asked for both ways in: the
**Give Lecture** button by the paper's title, and asking in the chat.

As with the graph's router, a message that plainly asks is routed without a
model call (``obvious_reading``), only those whose wording cannot be wrong;
everything else goes to the summarizer's model, the crew's cheapest, and
any failure answers instead.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent

from ... import factory, streams
from .config import AGENT_ID

log = logging.getLogger(__name__)


class ReadingRoute(BaseModel):
    """Where one Reader message goes."""

    model_config = ConfigDict(extra="forbid")

    target: Literal["guide", "answer"]


#: The fallback, and the shape of every failure: answer the question.
ANSWER = ReadingRoute(target="answer")

OBVIOUS_GUIDE = re.compile(
    r"""^\s*(?:can\s+you\s+|could\s+you\s+|please\s+|now\s+)*
        (?:
            guide\s+me(?:\s+through)?
          | walk\s+me\s+through
          | lecture\s+(?:me|us)(?:\s+on)?
          | give\s+(?:me|us)\s+(?:a|the)\s+(?:guided\s+read|lecture|tour|walkthrough)(?:\s+of)?
        )
        \s*(?P<rest>.*?)[\s.!?]*$""",
    re.IGNORECASE | re.VERBOSE | re.DOTALL,
)
"""Messages that plainly ask to be guided through what's open."""

WHOLE = re.compile(
    r"^(?:(?:on\s+|of\s+)?(?:this|the|it|the\s+whole|the\s+entire)\s*(?:paper)?|)$", re.IGNORECASE
)
"""What may follow the ask for it to mean the paper, beyond doubt."""

SYSTEM_PROMPT = (
    "You route one message to a research-paper reader's assistant, and decide "
    "nothing else. The student has a paper open and is reading one section of "
    "it. Their message goes to either:\n"
    "- the GUIDE, which gives a lecture on the whole paper: a step-by-step "
    "walk through it, lighting each passage as it goes. For 'walk me through "
    "this paper', 'lecture me on this', 'give me a lecture', 'teach me this "
    "paper step by step', 'give me a tour'.\n"
    "- the ASSISTANT, which answers a question about the paper. For anything "
    "with an answer: 'what does equation 3 mean', 'why do they scale by root "
    "d', 'explain this passage', 'summarise the results', and every follow-up "
    "to something already said.\n\n"
    "Return one field, target: 'guide' or 'answer'. When unsure, 'answer'. A "
    "question about one part of the paper ('walk me through equation 3') is "
    "an answer: the lecture is only ever of the whole paper."
)

# No model at construction: passed per run by `factory.model_for`.
agent: Agent[None, ReadingRoute] = Agent(output_type=ReadingRoute, instructions=[SYSTEM_PROMPT])

_MAX_CHARS = 600
"""How much of the message the router reads (as the graph's does)."""


def obvious_reading(message: str) -> ReadingRoute | None:
    """Route a message that plainly asks for a lecture, without a model.

    Args:
        message: The student's message.

    Returns:
        The route when the message asks for a lecture on the paper in so
        many words, else None ("ask the model").
    """
    match = OBVIOUS_GUIDE.match(message or "")
    if match is None:
        return None
    return ReadingRoute(target="guide") if WHOLE.match(match.group("rest").strip()) else None


def route_reading(message: str) -> ReadingRoute:
    """Decide whether a Reader message wants a lecture on the paper.

    Args:
        message: The student's message. Blank answers.

    Returns:
        The route; never raises, as an unroutable message is an answered one.
    """
    message = (message or "").strip()
    if not message:
        return ANSWER
    obvious = obvious_reading(message)
    if obvious is not None:
        return obvious
    try:
        result = streams.run(agent.run(message[:_MAX_CHARS], model=factory.model_for(AGENT_ID)))
    except Exception:
        log.warning("reader message routing failed, answering instead", exc_info=True)
        return ANSWER
    return result.output
