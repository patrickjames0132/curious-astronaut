"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Routing a Reader message (v8.50.0): a plain ask for a lecture on the paper
needs no model, the rest is the model's call, and any failure answers.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import pytest
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from curious_astronaut.agents.orchestrators import router
from curious_astronaut.agents.orchestrators.router import reading


async def explode(messages, info):
    raise AssertionError("the fast path should not call the model")


@pytest.mark.parametrize(
    "message",
    [
        "walk me through this paper",
        "Guide me through it.",
        "please lecture me",
        "give me a lecture on this paper",
        "can you give me a lecture?",
    ],
)
def test_a_plain_ask_needs_no_model(message):
    with reading.agent.override(model=FunctionModel(explode)):
        assert router.route_reading(message) == router.ReadingRoute(target="guide")


@pytest.mark.parametrize(
    "message", ["walk me through the softmax", "what is equation 3?", "walk me through this section"]
)
def test_the_rest_is_the_models_call(message):
    assert reading.obvious_reading(message) is None


def test_the_models_decision_is_passed_through_and_failure_answers():
    with reading.agent.override(model=TestModel(custom_output_args={"target": "guide"})):
        assert router.route_reading("teach me this paper step by step") == router.ReadingRoute(target="guide")
    with reading.agent.override(model=FunctionModel(explode)):
        assert router.route_reading("what does this mean?") == reading.ANSWER
    assert router.route_reading("   ") == reading.ANSWER
