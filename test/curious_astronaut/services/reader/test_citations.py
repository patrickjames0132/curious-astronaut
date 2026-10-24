"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
citations: a Reader document's bibliography matched to the papers it names
(v8.43.0), on entries shaped like Attention's and SAC's real ones, with the
providers stubbed (no network).

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from curious_astronaut.services.reader import citations


def _entry(entry_id, *texts):
    """A bibliography entry as the Reader's document has it: text runs."""
    return {"id": entry_id, "label": entry_id, "text": [{"kind": "text", "text": text} for text in texts]}


def _node(node_id, title, arxiv_id=None):
    """A provider's reference node, as far as matching reads it."""
    return {"id": node_id, "title": title, "arxiv_id": arxiv_id}


ATTENTION = [
    # Attention's bib1: the id rides in "arXiv:", the title too.
    _entry(
        "bib.bib1",
        "Jimmy Lei Ba, Jamie Ryan Kiros, and Geoffrey E Hinton. Layer normalization. ",
        "arXiv preprint arXiv:1607.06450",
        ", 2016.",
    ),
    # bib2: CoRR's "abs/" form.
    _entry(
        "bib.bib2",
        "Dzmitry Bahdanau, Kyunghyun Cho, and Yoshua Bengio. Neural machine translation by jointly ",
        "learning to align and translate. ",
        "CoRR",
        ", abs/1409.0473, 2014.",
    ),
    # bib30: no id, the title alone.
    _entry(
        "bib.bib30",
        "Nitish Srivastava, Geoffrey E Hinton, Alex Krizhevsky, Ilya Sutskever, and Ruslan Salakhutdinov. ",
        "Dropout: a simple way to prevent neural networks from overfitting. ",
        "Journal of Machine Learning Research",
        ", 15(1):1929–1958, 2014.",
    ),
]


def test_matches_by_arxiv_id_then_by_title():
    references = [
        _node("ln", "Layer Normalization", "1607.06450"),
        _node("nmt", "A different title S2 gave it", "1409.0473"),
        _node("dropout", "Dropout: a simple way to prevent neural networks from overfitting"),
    ]
    matched = citations.match(ATTENTION, references)
    assert {entry: node["id"] for entry, node in matched.items()} == {
        "bib.bib1": "ln",
        "bib.bib2": "nmt",
        "bib.bib30": "dropout",
    }


def test_a_short_title_is_not_trusted_alone():
    # "Adam" appears in plenty of entries that aren't Adam.
    bibliography = [_entry("bib.bib9", "Someone. We trained with Adam as the optimizer. ", "NeurIPS, 2019.")]
    assert citations.match(bibliography, [_node("adam", "Adam")]) == {}


def test_a_title_s2_filed_behind_its_proceedings_matches_by_a_long_shared_run():
    # Two of SAC's entries: S2 puts the proceedings in front of the title.
    bibliography = [
        _entry(
            "bib.bib36",
            "Ziebart, B. D., Maas, A. L., Bagnell, J. A., and Dey, A. K. ",
            "Maximum entropy inverse reinforcement learning. In ",
            "AAAI Conference on Artificial Intelligence (AAAI)",
            ", pp. 1433–1438, 2008.",
        ),
        # Four shared words ("deep reinforcement learning with") aren't enough.
        _entry("bib.bib7", "Lillicrap, T. Continuous control with deep reinforcement learning with care. ", "2015."),
    ]
    references = [
        _node(
            "maxent",
            "Proceedings of the Twenty-Third AAAI Conference on Artificial Intelligence (2008) "
            "Maximum Entropy Inverse Reinforcement Learning",
        ),
        _node("ddqn", "Deep Reinforcement Learning with Double Q-Learning"),
    ]
    matched = citations.match(bibliography, references)
    assert {entry: node["id"] for entry, node in matched.items()} == {"bib.bib36": "maxent"}


def test_a_reference_matches_one_entry_at_most():
    bibliography = [
        _entry("bib.bib1", "A. Author. Layer normalization. arXiv:1607.06450, 2016."),
        _entry("bib.bib2", "A. Author. Layer normalization (journal version). arXiv:1607.06450, 2017."),
    ]
    matched = citations.match(bibliography, [_node("ln", "Layer Normalization", "1607.06450")])
    assert list(matched) == ["bib.bib1"]


def test_get_citations_matches_s2_hydrates_in_one_batch_and_caches(monkeypatch):
    calls = {"references": 0, "batch": []}
    monkeypatch.setattr(citations.document, "get_document", lambda ref: {"bibliography": ATTENTION})

    def references(paper_id):
        calls["references"] += 1
        assert paper_id == "ARXIV:1706.03762"
        return [{"node": _node("ln", "Layer Normalization", "1607.06450"), "influential": False}]

    def get_papers(ids):
        calls["batch"].append(ids)
        return {"ln": {**_node("ln", "Layer Normalization", "1607.06450"), "authors": "J. Ba et al."}}

    monkeypatch.setattr(citations.s2, "references", references)
    monkeypatch.setattr(citations.s2, "get_papers", get_papers)
    found = citations.get_citations("1706.03762")
    assert found == {"bib.bib1": {"id": "ln", "title": "Layer Normalization", "arxiv_id": "1607.06450", "authors": "J. Ba et al."}}
    assert calls["batch"] == [["ln"]]
    # Cached: no second trip to the provider.
    assert citations.get_citations("1706.03762") == found
    assert calls["references"] == 1


def test_get_citations_on_openalex_uses_its_reference_list(monkeypatch):
    monkeypatch.setattr(citations.document, "get_document", lambda ref: {"bibliography": ATTENTION})
    monkeypatch.setattr(citations.openalex, "resolve_seed_work", lambda ref: {"id": "https://openalex.org/W1"})
    monkeypatch.setattr(citations.openalex, "bare_work_id", lambda work: "W1")
    monkeypatch.setattr(
        citations.openalex,
        "references",
        lambda work_id: [{"node": _node("W9", "Layer Normalization", "1607.06450")}] if work_id == "W1" else [],
    )

    def no_s2(*args):
        raise AssertionError("an OpenAlex thread never asks S2")

    monkeypatch.setattr(citations.s2, "get_papers", no_s2)
    monkeypatch.setattr(citations.s2, "references", no_s2)
    assert citations.get_citations("1706.03762", "openalex") == {"bib.bib1": _node("W9", "Layer Normalization", "1607.06450")}


def test_no_bibliography_asks_no_provider(monkeypatch):
    monkeypatch.setattr(citations.document, "get_document", lambda ref: {"available": False, "bibliography": []})

    def no_call(*args):
        raise AssertionError("nothing to match")

    monkeypatch.setattr(citations.s2, "references", no_call)
    assert citations.get_citations("1412.6980") == {}
