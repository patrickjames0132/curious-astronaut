"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Where a message is about (v9.0.0, the OnePager's "One assistant", stage
4b): the view the reader has open, no view at all (General: a search, a
question about the exploration), or another of the exploration's papers,
and which of its tools — its Citation Graph, its Knowledge Graph course,
its Reader. The answer becomes the question's tag, and the view it names
is the one whose context the answer gets, open or not.

The client asks only when it could matter: an exploration with no paper but
the one on screen has nowhere else to point (Patrick, 2026-10-26: no model
call on every message). The model is the summarizer's, the crew's cheapest,
and every failure answers "here": a question kept where it was asked costs
the reader a click on the tag's correction, where one sent elsewhere by
mistake costs an answer about the wrong paper.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic_ai import Agent

from ... import factory, streams
from .config import AGENT_ID

log = logging.getLogger(__name__)

#: A view a question can be asked from, beside a paper.
PlaceTool = Literal["graph", "knowledge", "reader"]

#: What each tool is, as the prompt and a screen's description say it.
TOOL_NAMES: dict[str, str] = {
    "graph": "its Citation Graph",
    "knowledge": "its Knowledge Graph course",
    "reader": "the Reader",
}


class PlaceRoute(BaseModel):
    """Where one message is about.

    ``place`` is ``here`` (the view on screen), ``general`` (no view),
    ``paper``: one of the exploration's papers, by its number in the list the
    router was shown, and the tool the question is for, or ``papers``: two or
    more of them at once (v9.0.0, a bridge question), by their numbers.
    """

    model_config = ConfigDict(extra="forbid")

    place: Literal["here", "general", "paper", "papers"]
    paper: int | None = None
    tool: PlaceTool | None = None
    papers: list[int] = []


#: The fallback, and the shape of every failure: where it was asked.
HERE = PlaceRoute(place="here")

SYSTEM_PROMPT = (
    "You decide what one message to a research assistant is about, and "
    "nothing else. The reader is exploring a set of papers. You are told "
    "where they are (a paper and the view of it they have open, or a chat "
    "with no paper open) and the exploration's papers, numbered. Return:\n"
    "- place 'here' when the message is about what they have open, or "
    "follows on from it, or could be. This is the default: when unsure, "
    "'here'.\n"
    "- place 'general' when it needs no paper's view: finding or searching "
    "for papers not in the list, a broad question about a field or about the "
    "exploration as a whole, small talk.\n"
    "- place 'paper' when it is plainly about ANOTHER paper in the list, named "
    "by title, nickname, author or year. Give its number as paper, and the "
    "view the question is for as tool: 'graph' for its citations, references, "
    "related or later work, lineage and influence; 'knowledge' for what to "
    "learn first, prerequisites, concepts behind it, its course; 'reader' for "
    "what the paper itself says: its sections, equations, figures, method, "
    "results.\n"
    "- place 'papers' when it compares, connects or traces an idea across "
    "TWO OR MORE papers in the list (the one open among them, or not): give "
    "all their numbers as papers.\n"
    "A paper the reader already has open is 'here', whatever its view, unless "
    "the message is about it together with another. Never invent a paper "
    "number."
)

# No model at construction: passed per run by `factory.model_for`.
agent: Agent[None, PlaceRoute] = Agent(output_type=PlaceRoute, instructions=[SYSTEM_PROMPT])

_MAX_CHARS = 600
"""How much of the message the router reads (as the other routers do)."""
_MAX_PAPERS = 60
"""How many of the exploration's papers it is shown."""


def _prompt(message: str, screen_paper: int | None, screen_tool: str | None, papers: list[str]) -> str:
    """Lay the message, where the reader is, and the papers out for the model.

    Args:
        message: The message.
        screen_paper: The open paper's number in ``papers``, or None in a chat.
        screen_tool: The open view's tool, or None.
        papers: The exploration's paper titles, numbered from 1 in this order.

    Returns:
        The prompt.
    """
    if screen_paper is None:
        where = "a chat, with no paper open"
    else:
        name = TOOL_NAMES.get(screen_tool or "", "its page")
        where = f"paper [{screen_paper}], on {name}"
    listed = "\n".join(f"[{number}] {title[:200]}" for number, title in enumerate(papers, start=1))
    return f"WHERE THE READER IS: {where}\n\nTHE PAPERS:\n{listed}\n\nTHE MESSAGE: {message[:_MAX_CHARS]}"


def route_place(
    message: str,
    papers: list[str],
    screen_paper: int | None = None,
    screen_tool: str | None = None,
) -> PlaceRoute:
    """Decide what a message is about: here, nowhere in particular, or another paper.

    Args:
        message: The message as typed. Blank stays here.
        papers: The exploration's paper titles, numbered from 1 in this order.
        screen_paper: The open paper's number, or None when no paper is open.
        screen_tool: The open view's tool (``graph`` / ``knowledge`` /
            ``reader``), or None.

    Returns:
        The place; never raises. A paper number out of range, the open paper
        itself, or a paper with no tool given is read as sensibly as it can
        be: out of range and the open view stay here, a missing tool is the
        Reader (what the paper says).
    """
    message = (message or "").strip()
    papers = papers[:_MAX_PAPERS]
    if not message or not papers:
        return HERE
    try:
        result = streams.run(
            agent.run(
                _prompt(message, screen_paper, screen_tool, papers),
                model=factory.model_for(AGENT_ID),
            )
        )
    except Exception:
        log.warning("message place routing failed, keeping it here", exc_info=True)
        return HERE
    route = result.output
    if route.place == "papers":
        named = list(dict.fromkeys(number for number in route.papers if 1 <= number <= len(papers)))
        if len(named) >= 2:
            return PlaceRoute(place="papers", papers=named)
        # One paper is a question about it, in what it says; none stays here.
        if not named:
            return HERE
        route = PlaceRoute(place="paper", paper=named[0], tool="reader")
    if route.place != "paper":
        return PlaceRoute(place=route.place)
    if route.paper is None or not 1 <= route.paper <= len(papers):
        return HERE
    tool = route.tool or "reader"
    if route.paper == screen_paper and tool == screen_tool:
        return HERE
    return PlaceRoute(place="paper", paper=route.paper, tool=tool)
