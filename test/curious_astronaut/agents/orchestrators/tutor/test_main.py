"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The tutor: children are concepts, cycles and duplicates are dropped, the
width knob caps the list, the real reference list reaches both prompts, and a
lesson streams as tokens that add up to the model's text, then resolves only
the citations it used, in range, to the real papers.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from curious_astronaut.agents import events
from curious_astronaut.agents.orchestrators import tutor
from curious_astronaut.agents.orchestrators.tutor import main as tutor_main

DQN = tutor.Step(title="Playing Atari with Deep Reinforcement Learning", kind="paper")
REFERENCES = [
    {"id": "td", "title": "Learning to predict by the methods of temporal differences", "year": 1988},
    {"id": "ql", "title": "Q-learning", "year": 1992},
]


def _listing(items: list[dict]) -> TestModel:
    """A model that 'lists' these prerequisites.

    Args:
        items: The ``Prerequisite`` dicts to return.

    Returns:
        The test model.
    """
    return TestModel(custom_output_args={"items": items})


def test_children_are_concepts_with_their_reasons():
    model = _listing(
        [
            {"name": " Temporal-difference learning ", "why": "DQN bootstraps."},
            {"name": "Markov decision processes", "why": "The setting."},
        ]
    )
    with tutor_main.expand_agent.override(model=model):
        children = tutor.expand(DQN, [], REFERENCES, [])
    assert [(child.name, child.why) for child in children] == [
        ("Temporal-difference learning", "DQN bootstraps."),
        ("Markov decision processes", "The setting."),
    ]


def test_the_item_its_path_and_repeats_are_dropped():
    path = [DQN, tutor.Step(title="Q-learning", kind="concept")]
    item = tutor.Step(title="Bellman equations", kind="concept")
    model = _listing(
        [
            {"name": "bellman  EQUATIONS", "why": "itself"},
            {"name": "Q-learning", "why": "an ancestor"},
            {"name": "Dynamic programming", "why": "kept"},
            {"name": "dynamic programming", "why": "a repeat"},
        ]
    )
    with tutor_main.expand_agent.override(model=model):
        children = tutor.expand(item, path, [], [])
    assert [child.name for child in children] == ["Dynamic programming"]


def test_the_children_knob_caps_the_list(monkeypatch):
    entry = tutor_main.factory.agent_entry("tutor")
    monkeypatch.setitem(entry.extras, "children", 2)
    model = _listing(
        [{"name": f"Concept {index}", "why": "w"} for index in range(5)]
    )
    with tutor_main.expand_agent.override(model=model):
        children = tutor.expand(DQN, [], [], [])
    assert len(children) == 2


def test_the_prompt_numbers_references_and_names_the_course_so_far():
    seen = {}

    def record(messages, info):
        seen["prompt"] = messages[0].parts[-1].content
        raise RuntimeError("stop after recording")

    with tutor_main.expand_agent.override(model=FunctionModel(record)):
        try:
            tutor.expand(DQN, [], REFERENCES, ["Q-learning"])
        except RuntimeError:
            pass
    assert "[2] Q-learning (1992)" in seen["prompt"]
    assert "ALREADY IN THE COURSE:\nQ-learning" in seen["prompt"]


def test_a_lesson_streams_then_resolves_only_the_citations_it_used():
    text = "Q-learning [2] learns the value of each action [2, 9].\n\n$$Q(s,a)$$"
    refs = [{**REFERENCES[0], "url": "u1"}, {**REFERENCES[1], "url": "u2"}]
    seen = {}

    async def record(messages, info):
        seen["prompt"] = messages[0].parts[-1].content
        raise RuntimeError("stop")
        yield ""  # pragma: no cover — makes this an async generator, as streaming needs

    with tutor_main.lesson_agent.override(model=FunctionModel(stream_function=record)):
        try:
            list(tutor.lesson(DQN, "", [], "We present DQN.", refs, "s2"))
        except RuntimeError:
            pass
    assert "[2] Q-learning (1992)" in seen["prompt"]

    with tutor_main.lesson_agent.override(model=TestModel(custom_output_args={"text": text})):
        streamed = list(tutor.lesson(DQN, "", [], "We present DQN.", refs, "s2"))
    tokens = [event for event in streamed if isinstance(event, events.Token)]
    assert "".join(event.text for event in tokens) == text
    cited = streamed[-1]
    assert isinstance(cited, events.PaperRefs)
    # [9] is not on the list, so it resolves to nothing.
    assert list(cited.refs) == ["2"]
    assert cited.refs["2"].node_id == "ql"
    assert cited.refs["2"].url == "u2"
    assert cited.refs["2"].provider == "s2"


def test_a_lesson_with_no_citations_sends_no_refs():
    with tutor_main.lesson_agent.override(model=TestModel(custom_output_args={"text": "Plain."})):
        streamed = list(tutor.lesson(DQN, "", [], "", REFERENCES, "openalex"))
    assert not any(isinstance(event, events.PaperRefs) for event in streamed)
