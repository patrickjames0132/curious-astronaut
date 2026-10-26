"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The reviewer (agents/orchestrators/reviewer): the judge pass's batches, the
grouping, and the id verification that keeps every quote a real critique.
Scripted models only; no network.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import re

from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from curious_astronaut.agents.orchestrators import reviewer
from curious_astronaut.agents.orchestrators.reviewer import main as reviewer_main

TARGET = reviewer.Target(title="Attention Is All You Need", authors="Vaswani, Shazeer", year=2017)


def sentences(count: int) -> list[reviewer.Sentence]:
    """``count`` sentences; every fifth one names a weakness."""
    return [
        reviewer.Sentence(
            id=f"s{index}",
            text=f"Sentence {index}: " + ("its cost is quadratic [1]." if index % 5 == 0 else "we use [1]."),
            year=2020,
        )
        for index in range(count)
    ]


def answer(info, args: dict) -> ModelResponse:
    """A model response that returns ``args`` as the agent's structured output."""
    return ModelResponse(parts=[ToolCallPart(tool_name=info.output_tools[0].name, args=args)])


def scripted_judge(prompts: list[str]) -> FunctionModel:
    """A judge calling a sentence a critique when it says "quadratic"; records prompts."""

    def judge(messages, info):
        prompt = messages[0].parts[-1].content
        prompts.append(prompt)
        items = [
            {"id": sid, "verdict": "critique" if "quadratic" in text else "not_critique",
             "point": "quadratic cost" if "quadratic" in text else ""}
            for sid, text in re.findall(r"^\[(s\d+)\] (.*)$", prompt, flags=re.MULTILINE)
        ]
        # An id it wasn't given, which must not survive.
        items.append({"id": "s999", "verdict": "critique", "point": "invented"})
        return answer(info, {"items": items})

    return FunctionModel(judge)


def test_review_judges_in_batches_groups_and_verifies_every_id():
    judge_prompts: list[str] = []
    group_prompts: list[str] = []

    def group(messages, info):
        group_prompts.append(messages[0].parts[-1].content)
        return answer(info, {"themes": [
            # s1 isn't a critique and s0 is listed twice: only s0, s5 remain.
            {"name": "Quadratic cost", "summary": "Cost grows with length.",
             "sentence_ids": ["s0", "s1", "s5", "s0"]},
            # Nothing it cites is a critique: dropped whole.
            {"name": "Invented", "summary": "Not supported.", "sentence_ids": ["s2", "s999"]},
        ]})

    with (
        reviewer_main.judge_agent.override(model=scripted_judge(judge_prompts)),
        reviewer_main.group_agent.override(model=FunctionModel(group)),
    ):
        result = reviewer.review(TARGET, sentences(85))

    assert len(judge_prompts) == 3  # 85 sentences in batches of 40
    assert judge_prompts[0].startswith("TARGET: Attention Is All You Need (Vaswani et al., 2017)")
    assert result.judged == 85
    assert result.critiques == 17  # s0, s5, …, s80; never the invented s999
    assert [theme.name for theme in result.themes] == ["Quadratic cost"]
    assert result.themes[0].sentence_ids == ["s0", "s5"]
    assert "[s0] (2020) Sentence 0: its cost is quadratic [1].  -- point: quadratic cost" in group_prompts[0]
    assert "s1]" not in group_prompts[0]  # only critiques reach the grouper


def test_no_critiques_means_no_grouping_call():
    def no_group(messages, info):
        raise AssertionError("grouped nothing")

    def judge_none(messages, info):
        prompt = messages[0].parts[-1].content
        ids = re.findall(r"^\[(s\d+)\]", prompt, flags=re.MULTILINE)
        return answer(info, {"items": [{"id": sid, "verdict": "not_critique"} for sid in ids]})

    with (
        reviewer_main.judge_agent.override(model=FunctionModel(judge_none)),
        reviewer_main.group_agent.override(model=FunctionModel(no_group)),
    ):
        result = reviewer.review(TARGET, sentences(3))
    assert (result.themes, result.critiques, result.judged) == ([], 0, 3)


def test_no_sentences_means_no_model_call_at_all():
    def never(messages, info):
        raise AssertionError("called a model with nothing to judge")

    with reviewer_main.judge_agent.override(model=FunctionModel(never)):
        result = reviewer.review(TARGET, [])
    assert (result.themes, result.critiques, result.judged) == ([], 0, 0)


def test_the_byline_is_as_much_as_is_known():
    assert reviewer_main._target_line(reviewer.Target(title="DQN")) == "TARGET: DQN"
    assert reviewer_main._target_line(reviewer.Target(title="DQN", year=2013)) == "TARGET: DQN (2013)"
