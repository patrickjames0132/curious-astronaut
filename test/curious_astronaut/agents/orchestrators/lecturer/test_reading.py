"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The guided read (v8.50.0): beats that name the passage they teach (its
words and label, never papers), a prompt shaped by the scope and the
student's Knowledge Graph, and model failures that reach the caller.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import pytest
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from curious_astronaut.agents.orchestrators import lecturer
from curious_astronaut.agents.orchestrators.lecturer import reading

READING = "THE PAPER BEING READ: 'Attention'\n\nTHE SECTION THEY ARE READING: 3.2 Attention"


def test_beats_name_their_passage_and_no_papers():
    model = TestModel(
        custom_output_args=[
            {"heading": "Queries", "text": "A query asks.", "quote": "mapping a query", "label": None},
            {"heading": "The equation", "text": "Read it as steps.", "quote": None, "label": "Eq. (1)"},
            {"heading": "Blank", "text": "  ", "quote": "x", "label": None},
            {"heading": "Figure", "text": "See it.", "quote": " ", "label": "Figure 2."},
            {"heading": "In sum", "text": "It ends.", "quote": "x", "label": "(9)", "section": " 6 Conclusion"},
        ]
    )
    with reading.agent.override(model=model):
        beats = list(lecturer.guided_read(READING))
    assert [beat.heading for beat in beats] == ["Queries", "The equation", "Figure", "In sum"]
    assert [beat.quote for beat in beats] == ["mapping a query", None, None, "x"]
    # A whole section rides as a "§" label, ahead of any other.
    assert [beat.labels for beat in beats] == [[], ["(1)"], ["Figure 2"], ["§6 Conclusion"]]
    assert all(beat.node_ids == [] for beat in beats)


def test_a_label_too_long_to_be_one_is_dropped():
    assert reading._label("The whole of the second experiment") == []
    assert reading._label(None) == []
    assert reading._label("Table 1") == ["Table 1"]


def test_the_prompt_asks_for_the_whole_paper_and_says_what_the_student_knows():
    seen: dict = {}

    async def record(messages, info):
        seen["prompt"] = messages[-1].parts[-1].content
        raise RuntimeError("stop after recording")
        yield  # unreachable — marks this as the async generator streaming needs

    with reading.agent.override(model=FunctionModel(stream_function=record)):
        with pytest.raises(RuntimeError):
            list(lecturer.guided_read(READING, known=["Softmax"], learning=["Dot products"]))
    prompt = seen["prompt"]
    assert "WHOLE paper" in prompt and "8 to 14 beats" in prompt
    assert "already known" in prompt and "Softmax" in prompt
    assert "still learning" in prompt and "Dot products" in prompt
    with reading.agent.override(model=FunctionModel(stream_function=record)):
        with pytest.raises(RuntimeError):
            list(lecturer.guided_read(READING))
    assert "already known" not in seen["prompt"]
