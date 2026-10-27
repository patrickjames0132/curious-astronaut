"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The assistant: one front door to the crew, keyed by the view a question is
asked from (v8.53.0).

* ``views``   — the screen → tools table: which workflows each view offers,
  and whether the researcher may search the literature there.
* ``context`` — what each view lends the model: the paper being read, a
  highlight pictured, a course laid out, the other chats, the history.
* ``main``    — ``route(message, kind)`` and ``run(request)``.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from .main import AssistantRoute, RequestError, route, run
from .views import CAPABILITIES, VIEW_KINDS, Capabilities, ViewKind, Workflow, view_kind

__all__ = [
    "CAPABILITIES",
    "VIEW_KINDS",
    "AssistantRoute",
    "Capabilities",
    "RequestError",
    "ViewKind",
    "Workflow",
    "route",
    "run",
    "view_kind",
]
