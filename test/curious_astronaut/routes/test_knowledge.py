"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The knowledge network's routes: the paper's expansion sees its real
reference list (a lesson never fetches it), results are cached so a course is
never paid for twice (unless a breakdown is asked for fresh), a failed reference fetch degrades quietly, and bad
input is a 400. A lesson hears every item that needs it, and its closing
section can be rewritten alone (v8.23.0). A synthesis (v8.23.0) is named once per group, whatever order
its members come in, and its lesson streams and replays like any other.
A lesson is written with images (v8.24.0): its steps and images stream and
replay from the cache, a quick response is its own lesson without them (as
is every lesson with the knob at 0), and the web-image proxy serves only a
handle a search registered. A highlighted passage's concept (v8.25.0) is
named once and cached, empty when it names the lesson's own item.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import json

from curious_astronaut.agents import events
from curious_astronaut.agents.orchestrators import tutor
from curious_astronaut.routes import knowledge

ITEM = {"title": "Playing Atari", "kind": "paper", "paper_id": "dqn"}


def _frames(response) -> list[tuple[str, dict]]:
    """Parse an SSE response into (event, data) pairs."""
    frames = []
    for chunk in response.data.decode().strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in chunk.splitlines())
        frames.append((lines["event"], json.loads(lines["data"])))
    return frames


def test_expand_shows_the_paper_its_references_and_caches(client, monkeypatch):
    fetched = []
    seen = {}

    def neighbors(paper_id, relation, limit, provider):
        fetched.append((paper_id, relation, provider))
        return [{"node": {"id": "ql", "title": "Q-learning", "year": 1992, "extra": "dropped"}}]

    def expand(item, path, references, existing):
        seen["references"] = references
        return [tutor.Child(name="Q-learning", why="w")]

    monkeypatch.setattr(knowledge.traversal, "neighbors", neighbors)
    monkeypatch.setattr(knowledge.tutor, "expand", expand)
    body = {"item": ITEM, "path": [], "existing": [], "provider": "s2"}
    first = client.post("/api/knowledge/expand", json=body)
    assert first.status_code == 200
    assert first.json["children"] == [{"name": "Q-learning", "why": "w"}]
    assert fetched == [("dqn", "references", "s2")]
    # Trimmed to the fields the frontend uses.
    assert "extra" not in seen["references"][0]

    second = client.post("/api/knowledge/expand", json=body)
    assert second.json == first.json
    assert len(fetched) == 1  # served from the cache


def test_a_fresh_breakdown_skips_and_replaces_the_cache(client, monkeypatch):
    answers = iter([[tutor.Child(name="Q-learning", why="w")], [tutor.Child(name="MDPs", why="v")]])
    monkeypatch.setattr(knowledge.tutor, "expand", lambda *_args: next(answers))
    item = {"title": "Eigenvectors", "kind": "concept"}
    body = {"item": item, "path": []}
    assert client.post("/api/knowledge/expand", json=body).json["children"][0]["name"] == "Q-learning"
    # "Break it down again" asks the tutor once more, on purpose ...
    again = client.post("/api/knowledge/expand", json={**body, "fresh": True})
    assert again.json["children"][0]["name"] == "MDPs"
    # ... and the new breakdown is what the cache serves from then on.
    assert client.post("/api/knowledge/expand", json=body).json["children"][0]["name"] == "MDPs"


def test_a_failed_reference_fetch_still_expands(client, monkeypatch):
    def neighbors(*_args):
        raise RuntimeError("S2 down")

    seen = {}

    def expand(item, path, references, existing):
        seen["references"] = references
        return []

    monkeypatch.setattr(knowledge.traversal, "neighbors", neighbors)
    monkeypatch.setattr(knowledge.tutor, "expand", expand)
    response = client.post("/api/knowledge/expand", json={"item": ITEM, "path": []})
    assert response.status_code == 200
    assert seen["references"] == []


def test_a_concept_is_never_grounded_in_references(client, monkeypatch):
    def neighbors(*_args):
        raise AssertionError("a concept has no reference list")

    monkeypatch.setattr(knowledge.traversal, "neighbors", neighbors)
    monkeypatch.setattr(knowledge.tutor, "expand", lambda *_args: [])
    item = {"title": "Eigenvectors", "kind": "concept", "paper_id": "ignored"}
    assert client.post("/api/knowledge/expand", json={"item": item}).status_code == 200


def test_expand_failure_is_a_502(client, monkeypatch):
    def expand(*_args):
        raise RuntimeError("model down")

    monkeypatch.setattr(knowledge.tutor, "expand", expand)
    item = {"title": "Eigenvectors", "kind": "concept"}
    assert client.post("/api/knowledge/expand", json={"item": item}).status_code == 502


def test_malformed_bodies_are_rejected(client):
    assert client.post("/api/knowledge/expand", json={}).status_code == 400
    bad_kind = {"item": {"title": "X", "kind": "video"}}
    assert client.post("/api/knowledge/expand", json=bad_kind).status_code == 400
    bad_path = {"item": {"title": "X", "kind": "concept"}, "path": "nope"}
    assert client.post("/api/knowledge/lesson", json=bad_path).status_code == 400


def test_a_lesson_streams_without_references_and_replays_from_the_cache(client, monkeypatch):
    calls = []
    seen_needs = []

    def neighbors(paper_id, relation, limit, provider):
        raise AssertionError("a lesson must not fetch the reference list")

    def lesson(item, why, path, abstract, needed_by, pictures=None):
        calls.append(item.title)
        seen_needs.append([need.title for need in needed_by])
        yield events.Token(text="Q-learning ")
        yield events.Token(text="learns values.")

    monkeypatch.setattr(knowledge.traversal, "neighbors", neighbors)
    monkeypatch.setattr(knowledge.tutor, "lesson", lesson)
    body = {
        "item": {"title": "Q-learning", "kind": "concept"},
        "why": "w",
        "path": [],
        "needed_by": [
            {"title": "Playing Atari", "kind": "paper", "why": "DQN approximates Q."},
            {"title": "Experience replay", "kind": "concept", "why": "It replays Q targets."},
        ],
        "paper_id": "dqn",
    }
    first = _frames(client.post("/api/knowledge/lesson", json=body))
    assert first == [
        ("token", {"text": "Q-learning "}),
        ("token", {"text": "learns values."}),
        ("done", {}),
    ]
    again = _frames(client.post("/api/knowledge/lesson", json=body))
    assert again == [("token", {"text": "Q-learning learns values."}), ("done", {})]
    assert calls == ["Q-learning"]
    # After a "Break it down again", a lesson is asked for fresh: written
    # again, past the cache, and what the cache serves from then on.
    _frames(client.post("/api/knowledge/lesson", json={**body, "fresh": True}))
    assert calls == ["Q-learning", "Q-learning"]
    calls.pop()
    # Every item that needs it reaches the tutor, in a stable order.
    assert seen_needs[0] == ["Experience replay", "Playing Atari"]
    # The same set in another order is the same cached lesson.
    swapped = {**body, "needed_by": list(reversed(body["needed_by"]))}
    _frames(client.post("/api/knowledge/lesson", json=swapped))
    assert calls == ["Q-learning"]


def test_a_failed_lesson_is_not_cached(client, monkeypatch):
    def lesson(item, why, path, abstract, needed_by, pictures=None):
        yield events.Token(text="half a les")
        raise RuntimeError("stream dropped")

    monkeypatch.setattr(knowledge.tutor, "lesson", lesson)
    body = {"item": {"title": "Q-learning", "kind": "concept"}}
    frames = _frames(client.post("/api/knowledge/lesson", json=body))
    assert frames[-1][0] == "error"
    monkeypatch.setattr(
        knowledge.tutor, "lesson", lambda *_args: iter([events.Token(text="whole")])
    )
    frames = _frames(client.post("/api/knowledge/lesson", json=body))
    assert frames[0] == ("token", {"text": "whole"})


SYNTHESIS = {
    "members": [
        {"title": "Q-learning", "kind": "concept"},
        {"title": "Experience replay", "kind": "concept"},
    ],
    "toward": {"title": "Playing Atari", "kind": "paper"},
    "path": [],
    "paper_id": "dqn",
}


def test_a_synthesis_is_named_once_per_group(client, monkeypatch):
    calls = []

    def name_synthesis(members, toward, path):
        calls.append([member.title for member in members])
        return tutor.SynthesisName(name="Stable value learning", why="DQN needs both.")

    monkeypatch.setattr(knowledge.tutor, "name_synthesis", name_synthesis)
    first = client.post("/api/knowledge/synthesis", json=SYNTHESIS)
    assert first.get_json() == {"name": "Stable value learning", "why": "DQN needs both."}
    # The same group in the other order is the same synthesis: cached.
    swapped = {**SYNTHESIS, "members": list(reversed(SYNTHESIS["members"]))}
    assert client.post("/api/knowledge/synthesis", json=swapped).get_json()["name"] == (
        "Stable value learning"
    )
    assert len(calls) == 1


def test_a_synthesis_needs_two_members_and_a_target(client):
    lone = {**SYNTHESIS, "members": SYNTHESIS["members"][:1]}
    assert client.post("/api/knowledge/synthesis", json=lone).status_code == 400
    assert client.post("/api/knowledge/synthesis", json={**SYNTHESIS, "toward": {}}).status_code == 400
    nameless = {**SYNTHESIS, "name": ""}
    assert client.post("/api/knowledge/synthesis/lesson", json=nameless).status_code == 400


def test_a_failed_synthesis_name_is_a_502(client, monkeypatch):
    def name_synthesis(*_args):
        raise RuntimeError("model down")

    monkeypatch.setattr(knowledge.tutor, "name_synthesis", name_synthesis)
    assert client.post("/api/knowledge/synthesis", json=SYNTHESIS).status_code == 502


def test_a_synthesis_lesson_streams_and_replays_from_the_cache(client, monkeypatch):
    calls = []

    def synthesis_lesson(name, members, toward, path, pictures=None):
        calls.append(name)
        yield events.Token(text="Together, ")
        yield events.Token(text="they stabilise learning.")

    monkeypatch.setattr(knowledge.tutor, "synthesis_lesson", synthesis_lesson)
    body = {**SYNTHESIS, "name": "Stable value learning"}
    first = _frames(client.post("/api/knowledge/synthesis/lesson", json=body))
    assert [frame[0] for frame in first] == ["token", "token", "done"]
    again = _frames(client.post("/api/knowledge/synthesis/lesson", json=body))
    assert again == [
        ("token", {"text": "Together, they stabilise learning."}),
        ("done", {}),
    ]
    assert calls == ["Stable value learning"]


def test_a_fit_section_is_rewritten_once_per_change(client, monkeypatch):
    calls = []

    def fit_section(item, body, needed_by):
        calls.append([need.title for need in needed_by])
        return "It serves both."

    monkeypatch.setattr(knowledge.tutor, "fit_section", fit_section)
    body = {
        "item": {"title": "Q-learning", "kind": "concept"},
        "lesson": "Q-learning learns values.",
        "needed_by": [
            {"title": "Playing Atari", "kind": "paper", "why": "w"},
            {"title": "Experience replay", "kind": "concept", "why": "v"},
        ],
    }
    first = client.post("/api/knowledge/fit", json=body)
    assert first.json == {"text": "It serves both."}
    assert client.post("/api/knowledge/fit", json=body).json == first.json
    assert calls == [["Experience replay", "Playing Atari"]]
    # Nothing to fit into, or no lesson to draw on: refused.
    assert client.post("/api/knowledge/fit", json={**body, "needed_by": []}).status_code == 400
    assert client.post("/api/knowledge/fit", json={**body, "lesson": ""}).status_code == 400


def test_a_failed_fit_section_is_a_502(client, monkeypatch):
    def fit_section(*_args):
        raise RuntimeError("model down")

    monkeypatch.setattr(knowledge.tutor, "fit_section", fit_section)
    body = {
        "item": {"title": "Q-learning", "kind": "concept"},
        "lesson": "Q-learning learns values.",
        "needed_by": [{"title": "Playing Atari", "kind": "paper", "why": "w"}],
    }
    assert client.post("/api/knowledge/fit", json=body).status_code == 502


LESSON_BODY = {
    "item": {"title": "Q-learning", "kind": "concept"},
    "why": "w",
    "path": [{"title": "Playing Atari", "kind": "paper"}],
    "paper_id": "s2id",
    "paper": {"id": "s2id", "arxiv_id": "1312.5602", "title": "Playing Atari"},
    "provider": "openalex",
}

PLACED = tutor.images.LessonImage(
    slot=1,
    image="/api/web_image/abc",
    caption="The Q table",
    label="Image",
    title="RL notes",
    link="https://notes.example",
    description="What to see.",
    origin="web",
)


def test_a_lesson_with_images_streams_its_steps_and_replays_them(client, monkeypatch):
    seen = []

    def lesson(item, why, path, abstract, needed_by, pictures=None):
        seen.append(pictures)
        yield tutor.images.Step(text="Searching the web for a Q table…")
        yield events.Token(text="Q-learning fills a table.\n\n<<FIG 1>>")
        yield PLACED

    monkeypatch.setattr(knowledge.tutor, "lesson", lesson)
    first = _frames(client.post("/api/knowledge/lesson", json=LESSON_BODY))
    image = PLACED.model_dump(exclude={"type"})
    assert first == [
        ("step", {"text": "Searching the web for a Q table…"}),
        ("token", {"text": "Q-learning fills a table.\n\n<<FIG 1>>"}),
        ("image", image),
        ("done", {}),
    ]
    # The arXiv id is the paper's reference when it has one.
    assert seen == [tutor.Pictures(paper_ref="1312.5602", paper_title="Playing Atari", provider="openalex")]
    again = _frames(client.post("/api/knowledge/lesson", json=LESSON_BODY))
    assert again == [
        ("token", {"text": "Q-learning fills a table.\n\n<<FIG 1>>"}),
        ("image", image),
        ("done", {}),
    ]
    assert len(seen) == 1


def test_a_quick_response_is_its_own_lesson_written_without_images(client, monkeypatch):
    seen = []

    def lesson(item, why, path, abstract, needed_by, pictures=None):
        seen.append(pictures)
        yield events.Token(text="Quick." if pictures is None else "With images.")

    monkeypatch.setattr(knowledge.tutor, "lesson", lesson)
    quick = _frames(client.post("/api/knowledge/lesson", json={**LESSON_BODY, "quick": True}))
    assert quick[0] == ("token", {"text": "Quick."})
    full = _frames(client.post("/api/knowledge/lesson", json=LESSON_BODY))
    assert full[0] == ("token", {"text": "With images."})
    assert seen == [None, seen[1]] and seen[1] is not None
    # With the knob at 0 every lesson is quick, and served from the quick copy.
    entry = knowledge.factory.agent_entry("tutor")
    monkeypatch.setitem(entry.extras, "images", 0)
    off = _frames(client.post("/api/knowledge/lesson", json=LESSON_BODY))
    assert off[0] == ("token", {"text": "Quick."})
    assert len(seen) == 2


def test_a_synthesis_lesson_is_written_with_images_too(client, monkeypatch):
    seen = []

    def synthesis_lesson(name, members, toward, path, pictures=None):
        seen.append(pictures)
        yield events.Token(text="Together.")
        yield PLACED

    monkeypatch.setattr(knowledge.tutor, "synthesis_lesson", synthesis_lesson)
    body = {**SYNTHESIS, "name": "Deep Q", "paper": LESSON_BODY["paper"], "provider": "s2"}
    frames = _frames(client.post("/api/knowledge/synthesis/lesson", json=body))
    assert [kind for kind, _ in frames] == ["token", "image", "done"]
    assert seen[0].paper_ref == "1312.5602"


def test_the_web_image_proxy_serves_only_registered_handles(client, monkeypatch):
    assert client.get("/api/web_image/0123456789abcdef").status_code == 404
    knowledge.cache.set("webimg:abc", {"url": "https://notes.example/loop.png"})
    monkeypatch.setattr(
        knowledge.tutor.images, "_read_image", lambda url: (b"png-bytes", "image/png")
    )
    response = client.get("/api/web_image/abc")
    assert response.status_code == 200
    assert (response.mimetype, response.data) == ("image/png", b"png-bytes")
    # An image that is gone, or no longer an image, is a 404.
    monkeypatch.setattr(knowledge.tutor.images, "_read_image", lambda url: None)
    assert client.get("/api/web_image/abc").status_code == 404


PHRASE = {
    "phrase": "the Bellman backup",
    "item": {"title": "Q-learning", "kind": "concept"},
    "path": [{"title": "Playing Atari", "kind": "paper"}],
    "existing": ["MDPs"],
}


def test_a_phrase_is_named_once_and_cached(client, monkeypatch):
    calls = []

    def name_phrase(phrase, item, path, existing):
        calls.append((phrase, item.title, [step.title for step in path], existing))
        return tutor.Child(name="Bellman equations", why="Its update.")

    monkeypatch.setattr(knowledge.tutor, "name_phrase", name_phrase)
    first = client.post("/api/knowledge/phrase", json=PHRASE)
    assert first.get_json() == {"child": {"name": "Bellman equations", "why": "Its update."}}
    assert client.post("/api/knowledge/phrase", json=PHRASE).get_json() == first.get_json()
    assert calls == [("the Bellman backup", "Q-learning", ["Playing Atari"], ["MDPs"])]


def test_a_phrase_naming_its_own_lesson_comes_back_empty(client, monkeypatch):
    monkeypatch.setattr(knowledge.tutor, "name_phrase", lambda *_args: None)
    assert client.post("/api/knowledge/phrase", json=PHRASE).get_json() == {"child": None}


def test_a_phrase_needs_text_and_an_item(client, monkeypatch):
    monkeypatch.setattr(knowledge.tutor, "name_phrase", lambda *_args: None)
    assert client.post("/api/knowledge/phrase", json={**PHRASE, "phrase": "  "}).status_code == 400
    assert client.post("/api/knowledge/phrase", json={**PHRASE, "item": {}}).status_code == 400


def test_a_failed_phrase_is_a_502(client, monkeypatch):
    def name_phrase(*_args):
        raise RuntimeError("model down")

    monkeypatch.setattr(knowledge.tutor, "name_phrase", name_phrase)
    assert client.post("/api/knowledge/phrase", json=PHRASE).status_code == 502


def _section(section_id, level, number, title, text):
    """A Reader document section with one paragraph."""
    return {
        "id": section_id,
        "level": level,
        "number": number,
        "title": [{"kind": "text", "text": title}],
        "blocks": [{"kind": "paragraph", "inlines": [{"kind": "text", "text": text}]}],
    }


ATTENTION_DOC = {
    "available": True,
    "sections": [
        _section("S3.SS1", 2, "3.1", "Encoder and Decoder Stacks", "Two sub-layers."),
        # A paragraph heading: its text belongs to 3.1.
        _section("S3.SS1.SSS0.Px1", 4, "", "Encoder:", "We employ a residual connection, then layer normalization."),
        _section("S5.SS4", 2, "5.4", "Regularization", "Label smoothing."),
    ],
}


def test_concepts_are_placed_once_per_course_and_cached(client, monkeypatch):
    """The Reader's margin notes (v8.44.0)."""
    calls = []
    monkeypatch.setattr(knowledge.arxiv, "get_document", lambda paper: ATTENTION_DOC)

    def place(sections, concepts):
        calls.append(([(section.id, section.text) for section in sections], concepts))
        return {"Layer normalization": ["S3.SS1"], "Label smoothing": ["S5.SS4"], "Residual connections": ["S3.SS1"]}

    monkeypatch.setattr(knowledge.tutor, "place", place)
    body = {"paper": "1706.03762v7", "concepts": ["Residual connections", "Layer normalization", "Label smoothing"]}
    first = client.post("/api/knowledge/place", json=body)
    # By section, each list in the course's order.
    assert first.get_json() == {
        "sections": {"S3.SS1": ["Residual connections", "Layer normalization"], "S5.SS4": ["Label smoothing"]}
    }
    assert client.post("/api/knowledge/place", json=body).get_json() == first.get_json()
    assert len(calls) == 1
    sections, concepts = calls[0]
    # The paragraph heading's text folded into its subsection.
    assert sections[0][0] == "S3.SS1"
    assert "residual connection, then layer normalization" in sections[0][1]
    assert [section_id for section_id, _text in sections] == ["S3.SS1", "S5.SS4"]
    assert concepts == body["concepts"]


def test_placing_needs_an_arxiv_paper_and_concepts(client, monkeypatch):
    monkeypatch.setattr(knowledge.tutor, "place", lambda *_args: {})
    assert client.post("/api/knowledge/place", json={"paper": "abc123", "concepts": ["x"]}).status_code == 400
    assert client.post("/api/knowledge/place", json={"paper": "1706.03762"}).status_code == 400
    assert client.post("/api/knowledge/place", json={"paper": "1706.03762", "concepts": []}).get_json() == {
        "sections": {}
    }


def test_placing_degrades_without_text_and_fails_loudly_on_the_model(client, monkeypatch):
    monkeypatch.setattr(knowledge.arxiv, "get_document", lambda paper: {"available": False, "sections": []})
    body = {"paper": "1412.6980", "concepts": ["Momentum"]}
    assert client.post("/api/knowledge/place", json=body).get_json() == {"sections": {}}

    monkeypatch.setattr(knowledge.arxiv, "get_document", lambda paper: ATTENTION_DOC)

    def place(*_args):
        raise RuntimeError("model down")

    monkeypatch.setattr(knowledge.tutor, "place", place)
    assert client.post("/api/knowledge/place", json=body).status_code == 502


def test_a_pdf_only_paper_is_placed_in_its_pdfs_contents(client, monkeypatch):
    """The PDF view of a paper with no text (v8.44.0): sections are the PDF's
    contents entries, each with the pages it spans, the reference list left out."""
    asked = []
    monkeypatch.setattr(
        knowledge.pdf_service, "paper_pdf_url", lambda ref, provider: asked.append((ref, provider)) or "https://x/p.pdf"
    )
    entries = [
        {"title": "1 Introduction", "level": 1, "page": 1},
        {"title": "2 Algorithm", "level": 1, "page": 1},
        {"title": "3 Bias correction", "level": 1, "page": 2},
        {"title": "References", "level": 1, "page": 4},
        {"title": "A Appendix", "level": 1, "page": 5},
    ]
    monkeypatch.setattr(knowledge.pdf_service, "get_pdf_contents", lambda url: {"source": "headings", "entries": entries})
    pages = ["page one", "page two", "page three", "page four", "page five"]
    monkeypatch.setattr(knowledge.pdf_service, "get_pdf_pages", lambda url: {"available": True, "pages": pages})
    seen = []

    def place(sections, concepts):
        seen.extend((section.id, section.heading, section.text) for section in sections)
        return {"Momentum": ["pdf:1"]}

    monkeypatch.setattr(knowledge.tutor, "place", place)
    body = {"paper": "abc123", "concepts": ["Momentum"], "source": "pdf", "provider": "openalex"}
    assert client.post("/api/knowledge/place", json=body).get_json() == {"sections": {"pdf:1": ["Momentum"]}}
    # A provider id is fine for a PDF; the provider finds its open-access copy.
    assert asked == [("abc123", "openalex")]
    assert seen == [
        # The next entry starts on the same page: this page alone.
        ("pdf:0", "1 Introduction", "page one"),
        ("pdf:1", "2 Algorithm", "page one"),
        # Up to the next entry's page (the reference list's, still a boundary).
        ("pdf:2", "3 Bias correction", "page two\n\npage three"),
        # References skipped; the ids still count the contents as listed.
        ("pdf:4", "A Appendix", "page five"),
    ]


def test_a_pdf_placement_without_the_pdf_extra_is_empty(client, monkeypatch):
    monkeypatch.setattr(knowledge.pdf_service, "paper_pdf_url", lambda ref, provider: "https://x/p.pdf")

    def missing(url):
        raise knowledge.optional.MissingExtra("pdf", "fitz")

    monkeypatch.setattr(knowledge.pdf_service, "get_pdf_contents", missing)
    body = {"paper": "1412.6980", "concepts": ["Momentum"], "source": "pdf"}
    assert client.post("/api/knowledge/place", json=body).get_json() == {"sections": {}}
