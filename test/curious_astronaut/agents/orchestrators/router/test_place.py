"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
What a message is about (v9.0.0, stage 4b): the model's call, read as
sensibly as it can be, and every failure keeps the question where it was
asked.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import pytest
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from curious_astronaut.agents.orchestrators import router
from curious_astronaut.agents.orchestrators.router import place

PAPERS = ["Attention Is All You Need", "Playing Atari with Deep RL", "Soft Actor-Critic"]


async def explode(messages, info):
    raise AssertionError("no model should be called")


def decide(output: dict, screen_paper: int | None = 1, screen_tool: str | None = "reader"):
    """Route a message with the model's output fixed.

    Args:
        output: What the model returns.
        screen_paper: The open paper's number.
        screen_tool: The open view.

    Returns:
        The route.
    """
    with place.agent.override(model=TestModel(custom_output_args=output)):
        return router.route_place("what about the Atari paper?", PAPERS, screen_paper, screen_tool)


def test_another_paper_is_its_number_and_tool():
    assert decide({"place": "paper", "paper": 2, "tool": "graph"}) == router.PlaceRoute(
        place="paper", paper=2, tool="graph"
    )


def test_here_and_general_drop_anything_else_the_model_said():
    assert decide({"place": "general", "paper": 2, "tool": "graph"}) == router.PlaceRoute(place="general")
    assert decide({"place": "here", "paper": 3}) == router.HERE


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        # A number it was never shown: kept here.
        ({"place": "paper", "paper": 9, "tool": "graph"}, router.HERE),
        ({"place": "paper", "tool": "graph"}, router.HERE),
        # The paper and view already open: here.
        ({"place": "paper", "paper": 1, "tool": "reader"}, router.HERE),
        # No tool: what the paper says, the Reader.
        ({"place": "paper", "paper": 3}, router.PlaceRoute(place="paper", paper=3, tool="reader")),
    ],
)
def test_a_loose_answer_is_read_sensibly(output, expected):
    assert decide(output) == expected


def test_every_failure_keeps_it_here():
    with place.agent.override(model=FunctionModel(explode)):
        assert router.route_place("anything", PAPERS) == router.HERE
        assert router.route_place("   ", PAPERS) == router.HERE
        assert router.route_place("anything", []) == router.HERE


def test_the_prompt_says_where_the_reader_is():
    prompt = place._prompt("what next?", 2, "graph", PAPERS)
    assert "WHERE THE READER IS: paper [2], on its Citation Graph" in prompt
    assert "[3] Soft Actor-Critic" in prompt
    assert "a chat, with no paper open" in place._prompt("hi", None, None, PAPERS)
