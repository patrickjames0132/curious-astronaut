"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The tutor: children are concepts, cycles and duplicates are dropped, the
width knob caps the list, the real reference list reaches both prompts, and a
lesson streams as tokens that add up to the model's text, then resolves only
the citations it used, in range, to the real papers. A synthesis is named from
its concepts and target, and its lesson streams like any other. A highlighted
passage (v8.25.0) is named as one concept, never the item or its path.

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


def test_a_lesson_streams_its_text_and_cites_nothing():
    text = "Q-learning learns the value of each action.\n\n$$Q(s,a)$$"
    seen = {}

    async def record(messages, info):
        seen["prompt"] = messages[0].parts[-1].content
        raise RuntimeError("stop")
        yield ""  # pragma: no cover — makes this an async generator, as streaming needs

    needs = [tutor.Need(title="Experience replay", kind="concept", why="It replays targets.")]
    with tutor_main.lesson_agent.override(model=FunctionModel(stream_function=record)):
        try:
            list(tutor.lesson(DQN, "", [], "We present DQN.", needs))
        except RuntimeError:
            pass
    # No reference list reaches a lesson, so there is nothing to cite by number.
    assert "REFERENCES" not in seen["prompt"]
    assert "ABSTRACT: We present DQN." in seen["prompt"]
    # Every item that needs it is named, for the closing section.
    assert "NEEDED BY:\n- Experience replay (concept): It replays targets." in seen["prompt"]

    with tutor_main.lesson_agent.override(model=TestModel(custom_output_args={"text": text})):
        streamed = list(tutor.lesson(DQN, "", [], "We present DQN."))
    assert all(isinstance(event, events.Token) for event in streamed)
    assert "".join(event.text for event in streamed) == text


SYNTHESIS_MEMBERS = [
    tutor.Step(title="Q-learning", kind="concept"),
    tutor.Step(title="Experience replay", kind="concept"),
]


def test_a_synthesis_is_named_from_its_concepts_and_target():
    seen = {}

    def record(messages, info):
        seen["prompt"] = messages[0].parts[-1].content
        raise RuntimeError("stop after recording")

    with tutor_main.synthesis_name_agent.override(model=FunctionModel(record)):
        try:
            tutor.name_synthesis(SYNTHESIS_MEMBERS, DQN, [])
        except RuntimeError:
            pass
    assert "CONCEPTS:\n- Q-learning\n- Experience replay" in seen["prompt"]
    assert f"THEY BUILD TOWARD: {DQN.title} (paper)" in seen["prompt"]

    model = TestModel(custom_output_args={"name": " Stable value learning ", "why": "w"})
    with tutor_main.synthesis_name_agent.override(model=model):
        named = tutor.name_synthesis(SYNTHESIS_MEMBERS, DQN, [])
    assert named.name == "Stable value learning"


def test_a_synthesis_lesson_streams_its_text():
    text = "Replay decorrelates what Q-learning bootstraps from."
    model = TestModel(custom_output_args={"text": text})
    with tutor_main.synthesis_agent.override(model=model):
        streamed = list(tutor.synthesis_lesson("Stable value learning", SYNTHESIS_MEMBERS, DQN, []))
    assert all(isinstance(event, events.Token) for event in streamed)
    assert "".join(event.text for event in streamed) == text


def test_a_fit_section_is_written_from_the_lesson_and_what_needs_it():
    seen = {}

    def record(messages, info):
        seen["prompt"] = messages[0].parts[-1].content
        raise RuntimeError("stop after recording")

    needs = [
        tutor.Need(title="Playing Atari", kind="paper", why="DQN approximates Q."),
        tutor.Need(title="Experience replay", kind="concept", why="It replays targets."),
    ]
    with tutor_main.fit_agent.override(model=FunctionModel(record)):
        try:
            tutor.fit_section(DQN, "Q-learning learns values.", needs)
        except RuntimeError:
            pass
    assert "NEEDED BY:\n- Playing Atari (paper): DQN approximates Q." in seen["prompt"]
    assert "THE LESSON:\nQ-learning learns values." in seen["prompt"]

    with tutor_main.fit_agent.override(model=TestModel(custom_output_args={"text": " Both. "})):
        assert tutor.fit_section(DQN, "Q-learning learns values.", needs) == "Both."


def test_a_phrase_is_named_as_the_one_concept_it_is_about():
    """A lesson's Expand (v8.25.0): one concept, with why the item needs it."""
    item = tutor.Step(title="Q-learning", kind="concept")
    model = TestModel(custom_output_args={"name": " Bellman equations ", "why": "Its update."})
    with tutor_main.phrase_agent.override(model=model):
        child = tutor.name_phrase("the Bellman backup", item, [DQN], ["Bellman equations"])
    assert child == tutor.Child(name="Bellman equations", why="Its update.")


def test_a_phrase_naming_the_item_or_its_path_is_none():
    item = tutor.Step(title="Q-learning", kind="concept")
    for name in ("q-learning", "Playing Atari with Deep Reinforcement Learning"):
        model = TestModel(custom_output_args={"name": name, "why": "w"})
        with tutor_main.phrase_agent.override(model=model):
            assert tutor.name_phrase("this", item, [DQN], []) is None


def test_the_phrase_prompt_carries_the_passage_and_the_course():
    seen = {}

    def record(messages, info):
        seen["prompt"] = messages[0].parts[-1].content
        raise RuntimeError("stop after recording")

    item = tutor.Step(title="Q-learning", kind="concept")
    with tutor_main.phrase_agent.override(model=FunctionModel(record)):
        try:
            tutor.name_phrase("off-policy updates", item, [DQN], ["MDPs"])
        except RuntimeError:
            pass
    assert "PASSAGE: off-policy updates" in seen["prompt"]
    assert "LESSON SUBJECT: Q-learning (concept)" in seen["prompt"]
    assert "ALREADY IN THE COURSE:\nMDPs" in seen["prompt"]


SECTIONS = [
    tutor.PaperSection(id="S3.SS1", heading="3.1 Encoder and Decoder Stacks", text="A residual connection..."),
    tutor.PaperSection(id="S3.SS2.SSS1", heading="3.2.1 Scaled Dot-Product Attention", text="softmax(QK^T)V"),
    tutor.PaperSection(id="S5.SS4", heading="5.4 Regularization", text="Label smoothing..."),
]


def test_concepts_are_placed_in_real_sections_in_the_papers_order():
    """The Reader's notes (v8.44.0): names matched back to the course's
    spelling, unknown names and ids dropped, sections in the paper's order."""
    model = TestModel(
        custom_output_args={
            "placements": [
                {"concept": "softmax function", "sections": ["S3.SS2.SSS1"]},
                {"concept": "Residual connections", "sections": ["S5.SS4", "S9", "S3.SS1"]},
                {"concept": "Something invented", "sections": ["S3.SS1"]},
                {"concept": "Beam search", "sections": []},
            ]
        }
    )
    with tutor_main.place_agent.override(model=model):
        placed = tutor.place(SECTIONS, ["Softmax function", "Residual connections", "Beam search"])
    assert placed == {
        "Softmax function": ["S3.SS2.SSS1"],
        "Residual connections": ["S3.SS1", "S5.SS4"],
    }


def test_the_place_prompt_carries_the_sections_and_the_course():
    seen = {}

    def record(messages, info):
        seen["prompt"] = messages[0].parts[-1].content
        raise RuntimeError("stop after recording")

    with tutor_main.place_agent.override(model=FunctionModel(record)):
        try:
            tutor.place(SECTIONS, ["Softmax function"])
        except RuntimeError:
            pass
    assert "[S3.SS2.SSS1] 3.2.1 Scaled Dot-Product Attention\nsoftmax(QK^T)V" in seen["prompt"]
    assert "THE COURSE'S CONCEPTS:\nSoftmax function" in seen["prompt"]
    # Nothing to place, or nowhere to place it: no call at all.
    assert tutor.place([], ["Softmax function"]) == {}
    assert tutor.place(SECTIONS, []) == {}
