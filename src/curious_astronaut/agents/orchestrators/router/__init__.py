"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The router: which assistant a typed message goes to, and over which papers.

One decision, exposed as one function. ``route(message)`` returns a
:class:`MessageRoute` — the lecturer or the researcher, plus the framing and
scope a lecture would use — and it always returns one, so a caller has no
failure branch to write. ``resolve_papers(message, papers)`` is the rarer
second call, turning a message that *named* papers into their ids.

* ``main``   — the classifier agent, the ``MessageRoute`` output model, the
  no-model ``obvious_route`` fast path, ``route`` over the two, and the
  ``resolve_papers`` name resolver with its ``RoutePaper`` input shape.
* ``config`` — the system prompts, the obvious-lecture pattern, and the
  borrowed agent id.
* ``reading`` — the Reader's decision: a guided read or an answer.
* ``place``   — what a message is about (v9.0.0): the view it was typed in,
  no view (General), or another of the exploration's papers and its tool.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from .main import (
    ANSWER,
    MessageRoute,
    RoutePaper,
    Scope,
    Target,
    agent,
    obvious_route,
    resolve_agent,
    resolve_papers,
    route,
)
from .place import HERE, PlaceRoute, route_place
from .reading import ReadingRoute, route_reading

__all__ = [
    "ANSWER",
    "HERE",
    "PlaceRoute",
    "route_place",
    "ReadingRoute",
    "route_reading",
    "MessageRoute",
    "RoutePaper",
    "Scope",
    "Target",
    "agent",
    "obvious_route",
    "resolve_agent",
    "resolve_papers",
    "route",
]
