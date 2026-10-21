"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
A lesson's image tools: candidates come from the library (figures near the
passages that match the picture asked for), papers (the course paper's,
then searched papers' figures whose captions match best) and the web (behind
opaque handles); a key only ever reads pixels it is allowed to; images are
shrunk before the tutor sees them; a lesson written with images streams
the tutor's steps, sees the candidates' pixels, places one with its marker
and description, and keeps to its budgets; and a lesson is sent back until
it has searched and placed an image, its rejected draft never streamed.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import json
import struct

import pytest
from pydantic_ai import BinaryContent
from pydantic_ai.messages import ModelResponse, UserPromptPart
from pydantic_ai.models.function import DeltaToolCall, FunctionModel

from curious_astronaut.agents import events
from curious_astronaut.agents.orchestrators import tutor
from curious_astronaut.agents.orchestrators.tutor import images
from curious_astronaut.agents.orchestrators.tutor import main as tutor_main

CONCEPT = tutor.Step(title="Bellman equations", kind="concept")
AR5IV = "https://ar5iv.labs.arxiv.org/html/1312.5602/assets/x1.png"
PICTURES = tutor.Pictures(paper_ref="1312.5602", paper_title="DQN", provider="s2")


def _deps(**kwargs) -> images.LessonDeps:
    """A lesson's image run-state with defaults.

    Args:
        **kwargs: Fields to override.

    Returns:
        The run-state.
    """
    fields = {
        "subject": "Bellman equations",
        "paper_ref": "",
        "paper_title": "",
        "provider": "s2",
        "images_left": 3,
    }
    fields.update(kwargs)
    return images.LessonDeps(**fields)


@pytest.fixture(autouse=True)
def no_paper_search(monkeypatch):
    """No paper search reaches S2 or OpenAlex: every search looks in papers now.

    A test that wants hits sets its own.
    """
    monkeypatch.setattr(images.s2, "search_papers", lambda query, limit: [])
    monkeypatch.setattr(images.openalex, "search_papers", lambda query, limit: [])


@pytest.fixture
def library(monkeypatch):
    """A library of one book whose p.86 passage has figures on pp.85-87 and 120."""
    searched = []

    def search(query, top_k):
        searched.append(query)
        return [{"source_id": "sutton", "source_title": "Sutton & Barto", "page": 86}]

    manifest = {
        "floats": [
            {"kind": "figure", "page": 87, "caption": "Figure 3.5: Gridworld solutions."},
            {"kind": "table", "page": 86, "caption": "Table 3.1: Rewards."},
            {"kind": "figure", "page": 120, "caption": "Figure 4.2: Far away."},
            {"kind": "figure", "page": 86, "caption": "Figure 3.4: Backup diagrams for v* and q*."},
        ]
    }
    monkeypatch.setattr(images.sources, "search", search)
    monkeypatch.setattr(images.sources, "get_source_figures", lambda source_id: manifest)
    return searched


@pytest.fixture
def no_web(monkeypatch):
    """A web search that finds no pages, and no Wikipedia (never the network)."""

    async def scout(need):
        return images.web_scout.WebFindings(summary="", sources=[])

    monkeypatch.setattr(images.web_scout, "scout", scout)
    monkeypatch.setattr(images, "_wikipedia_candidates", lambda what, subject, pixels: [])


def _png(width: int, height: int) -> bytes:
    """A PNG header of this size.

    Args:
        width: Its width.
        height: Its height.

    Returns:
        The header bytes.
    """
    return b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + struct.pack(">II", width, height)


def test_library_figures_near_the_matching_passage(library):
    found = images._library_candidates("a backup diagram for the Bellman optimality equation")
    # The page's own figure first, then its neighbour; the table and the far
    # figure are left out.
    assert [candidate.key for candidate in found] == ["library:sutton:3", "library:sutton:0"]
    assert found[0].image == "/api/sources/sutton/figure/3"
    assert (found[0].credit, found[0].page) == ("Sutton & Barto", 86)
    assert found[0].link == "/api/sources/sutton/pdf#page=86"
    assert library == ["a backup diagram for the Bellman optimality equation"]


def test_without_ar5iv_the_course_paper_figures_come_from_its_pdf(monkeypatch):
    monkeypatch.setattr(images.arxiv, "get_figures", lambda ref: {"figures": []})
    monkeypatch.setattr(
        images.pdf_service,
        "get_pdf_floats",
        lambda url: {
            "token": "tok",
            "floats": [
                {"kind": "figure", "page": 2, "caption": "Figure 1"},
                {"kind": "algorithm", "page": 3, "caption": "Algorithm 1"},
            ],
        },
    )
    found = images._course_paper_candidates("1312.5602", "s2", "DQN")
    assert [(candidate.key, candidate.image, candidate.link) for candidate in found] == [
        ("pdf:tok:0", "/api/pdf_figure/tok/0", "https://arxiv.org/pdf/1312.5602#page=2")
    ]


def test_searched_papers_give_their_best_matching_figures(monkeypatch):
    hits = [
        {"node": {"title": "No arXiv", "arxiv_id": None}},
        {"node": {"title": "Dueling DQN", "arxiv_id": "1511.06581"}},
        {"node": {"title": "No render", "arxiv_id": "0000.00000"}},
    ]
    searched = []
    monkeypatch.setattr(
        images.s2, "search_papers", lambda query, limit: searched.append(query) or hits
    )
    renders = {
        "1511.06581": [
            {"image": AR5IV + "?a", "caption": "Figure 1: Atari scores."},
            {"image": AR5IV + "?b", "caption": "Figure 2: The dueling backup diagram."},
            {"image": AR5IV + "?c", "caption": "Figure 3: A backup of values."},
        ],
        "0000.00000": [],
    }
    monkeypatch.setattr(images.arxiv, "get_figures", lambda ref: {"figures": renders[ref]})
    found = images._searched_paper_candidates("a backup diagram", "Bellman equations", "s2")
    # Searched on the subject; the picture asked for only ranks the figures.
    assert searched == ["Bellman equations"]
    # Best caption match first, two per paper, only papers with a render.
    assert [candidate.caption for candidate in found] == [
        "Figure 2: The dueling backup diagram.",
        "Figure 3: A backup of values.",
    ]
    assert found[0].credit == "Dueling DQN"
    assert found[0].link == "https://arxiv.org/abs/1511.06581"

    def boom(query, limit):
        raise RuntimeError("429")

    monkeypatch.setattr(images.s2, "search_papers", boom)
    assert images._searched_paper_candidates("a backup diagram", "Bellman equations", "s2") == []


def test_web_images_are_known_by_opaque_handles(monkeypatch):
    needs = []

    async def scout(need):
        needs.append(need)
        source = images.web_scout.WebSource
        return images.web_scout.WebFindings(
            summary="", sources=[source(title="t", url="https://notes.example/mdp", note="n")]
        )

    page = (
        "<title>MDP notes</title><p>The backup.</p>"
        '<figure><img src="backup.png"><figcaption>The backup</figcaption></figure>'
        '<img src="small.png" alt="Too small">'
    )
    bodies = {
        "https://notes.example/mdp": (page.encode(), "text/html", "https://notes.example/mdp"),
        "https://notes.example/backup.png": (_png(800, 600), "image/png", ""),
        "https://notes.example/small.png": (_png(120, 90), "image/png", ""),
    }
    monkeypatch.setattr(images.web_scout, "scout", scout)
    monkeypatch.setattr(images.web, "safe_get", lambda url, **_kwargs: bodies[url])
    pixels = {}
    (online,) = images._web_candidates("a backup diagram", "Bellman equations", pixels)
    # The browser and the model never see the URL.
    assert online.key.startswith("web:") and "notes.example" not in online.key
    assert online.image == f"/api/web_image/{online.key[4:]}"
    assert images.web_image_url(online.key[4:]) == "https://notes.example/backup.png"
    assert (online.caption, online.credit, online.link) == (
        "The backup",
        "MDP notes",
        "https://notes.example/mdp",
    )
    assert pixels == {online.key: (_png(800, 600), "image/png")}  # not downloaded twice
    assert "a backup diagram" in needs[0] and "Bellman equations" in needs[0]


def test_a_key_only_reads_what_it_may(monkeypatch):
    monkeypatch.setattr(images.arxiv, "fetch_image", lambda url: (b"gif", "image/gif"))
    monkeypatch.setattr(images.pdf_service, "render_figure", lambda token, index: b"png")
    monkeypatch.setattr(images.sources, "render_source_figure", lambda source, index: b"lib")
    assert images.image_bytes(f"ar5iv:{AR5IV}") == (b"gif", "image/gif")
    assert images.image_bytes("pdf:tok:0") == (b"png", "image/png")
    assert images.image_bytes("library:sutton:3") == (b"lib", "image/png")
    for unsafe in (
        "ar5iv:http://169.254.169.254/latest",
        "https://example.com/x.png",
        "file:/etc/passwd",
        "web:0123456789abcdef",  # a handle no search registered
    ):
        with pytest.raises(ValueError):
            images.image_bytes(unsafe)


def test_a_large_image_is_shrunk_before_the_tutor_sees_it():
    fitz = pytest.importorskip("fitz")
    pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 2000, 1000), False)
    pixmap.clear_with(200)
    data, media_type = images.shrink(pixmap.tobytes("png"), "image/png")
    assert media_type == "image/png"
    assert images.web.image_size(data) == (images.SHRINK_SIDE, images.SHRINK_SIDE // 2)
    # A small one, or one that can't be read, goes as it is.
    small = _png(300, 200)
    assert images.shrink(small, "image/png") == (small, "image/png")


def _turns(messages) -> int:
    """How many responses the model has given so far in a run.

    Args:
        messages: The run's messages.

    Returns:
        The count.
    """
    return sum(isinstance(message, ModelResponse) for message in messages)


def test_a_lesson_with_images_searches_looks_places_and_streams(library, no_web, monkeypatch):
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    monkeypatch.setattr(images.arxiv, "get_figures", lambda ref: {"figures": []})
    monkeypatch.setattr(images.pdf_service, "get_pdf_floats", lambda url: {"floats": []})
    monkeypatch.setattr(images.s2, "search_papers", lambda query, limit: [])
    seen = {}
    text = "The Bellman equation backs values up.\n\n<<FIG 1>>\n\nIt recurses."

    async def script(messages, info):
        turn = _turns(messages)
        if turn == 0:
            seen["prompt"] = messages[0].parts[-1].content
            arguments = {"what": "a backup diagram", "lead": True}
            yield {0: DeltaToolCall(name="find_images", json_args=json.dumps(arguments))}
        elif turn == 1:
            seen["shown"] = [
                item
                for part in messages[-1].parts
                if isinstance(part, UserPromptPart) and not isinstance(part.content, str)
                for item in part.content
            ]
            arguments = {"number": 1, "description": " The backup, drawn. "}
            yield {0: DeltaToolCall(name="show_image", json_args=json.dumps(arguments))}
        else:
            yield {0: DeltaToolCall(name="final_result", json_args=json.dumps({"text": text}))}

    model = FunctionModel(stream_function=script)
    with tutor_main.illustrated_lesson_agent.override(model=model):
        streamed = list(tutor.lesson(CONCEPT, "Q-learning needs it.", [], "", pictures=PICTURES))
    assert "IMAGES." not in seen["prompt"]  # the tools' guidance is in the instructions
    assert seen["prompt"].endswith("Show at least 2 and at most 3 images.")
    # The tutor looked at the pixels themselves, numbered with their words.
    pictures = [item for item in seen["shown"] if isinstance(item, BinaryContent)]
    words = [item for item in seen["shown"] if isinstance(item, str)]
    assert len(pictures) == 2
    assert words[0].startswith(
        "[1] From the reader's library: Sutton & Barto, p.86. Caption: Figure 3.4:"
    )
    steps = [event.text for event in streamed if isinstance(event, images.Step)]
    assert steps == [
        "Searching your library, papers and the web for a backup diagram…",
        "Looking at 2 images…",
        "Placing an image from Sutton & Barto…",
    ]
    (placed,) = [event for event in streamed if isinstance(event, images.LessonImage)]
    assert (placed.slot, placed.label, placed.caption) == (
        1,
        "Figure 3.4",
        "Backup diagrams for v* and q*.",
    )
    # One description per image: a captioned one keeps its own caption.
    assert (placed.title, placed.description, placed.origin) == (
        "Sutton & Barto, p. 86",
        "",
        "library",
    )
    assert "".join(event.text for event in streamed if isinstance(event, events.Token)) == text


def test_without_pictures_or_with_none_allowed_a_lesson_has_no_tools(monkeypatch):
    calls = []

    async def plain(messages, info):
        calls.append([tool.name for tool in info.function_tools])
        yield {0: DeltaToolCall(name="final_result", json_args='{"text": "Plain."}')}

    with tutor_main.lesson_agent.override(model=FunctionModel(stream_function=plain)):
        list(tutor.lesson(CONCEPT, "", [], ""))  # a quick response
        entry = tutor_main.factory.agent_entry("tutor")
        monkeypatch.setitem(entry.extras, "images", 0)
        list(tutor.lesson(CONCEPT, "", [], "", pictures=PICTURES))  # images off
    assert calls == [[], []]


class _Context:
    """A stand-in for the tools' run context: only ``deps`` is read."""

    def __init__(self, deps: images.LessonDeps) -> None:
        """Hold the run-state.

        Args:
            deps: The lesson's image run-state.
        """
        self.deps = deps


def test_the_tools_keep_to_their_budgets(library, no_web, monkeypatch):
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    deps = _deps(images_left=1, searches_left=1)
    context = _Context(deps)
    assert images.find_images(context, "  ") == "Say what picture you want."
    first = images.find_images(context, "a backup diagram")
    assert isinstance(first, images.ToolReturn)
    assert images.find_images(context, "more").startswith("No image searches left")
    assert images.show_image(context, 9, "d").startswith("No image 9")
    assert images.show_image(context, 1, "d").startswith("Placed. Put the marker <<FIG 1>>")
    assert images.show_image(context, 1, "d") == (
        "Image 1 is already placed: its marker is <<FIG 1>>."
    )
    assert images.show_image(context, 2, "d").startswith("No images left")


def test_a_search_never_offers_the_same_image_twice(library, no_web, monkeypatch):
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    deps = _deps()
    context = _Context(deps)
    images.find_images(context, "a backup diagram")
    again = images.find_images(context, "a backup diagram")
    assert again == "No usable images of a backup diagram in the library, papers or on the web."
    assert [step.text for step in deps.drain()] == [
        "Looking at 2 images…",
        "No images of a backup diagram found",
    ]


def test_a_lesson_is_sent_back_until_it_has_searched_and_placed_an_image(library, no_web, monkeypatch):
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    deps = _deps()
    context = _Context(deps)
    lesson = tutor.Lesson(text="A lesson.")
    # Never looked: sent to search.
    with pytest.raises(images.ModelRetry, match="Search before you write"):
        images.must_show_an_image(context, lesson)
    # Looked (for its lead image first), placed nothing, can search again:
    # sent to place one.
    images.find_images(context, "a backup diagram", lead=True)
    with pytest.raises(images.ModelRetry, match="Every lesson shows at least 1 image; this one shows 0"):
        images.must_show_an_image(context, lesson)
    # Placed one: kept.
    images.show_image(context, 1, "The backup.")
    assert images.must_show_an_image(context, lesson) is lesson


def test_a_lesson_is_sent_back_until_it_shows_its_fewest_images(library, no_web, monkeypatch):
    """v8.32.0: with one image required, every lesson placed exactly one (the
    lead or a paragraph's) and stopped; ``least`` asks for more, short of
    the cap, and gives way once nothing is left to place."""
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    deps = _deps(least=2, searches_left=1)
    context = _Context(deps)
    lesson = tutor.Lesson(text="A lesson.")
    images.find_images(context, "the Bellman backup diagram", lead=True)
    images.show_image(context, 1, "The backup.", lead=True)
    with pytest.raises(images.ModelRetry, match="at least 2 images; this one shows 1"):
        images.must_show_an_image(context, lesson)
    images.show_image(context, 2, "Another.")
    assert images.must_show_an_image(context, lesson) is lesson
    # Searches spent and every candidate placed: kept with fewer.
    short = _Context(_deps(least=3, searches_left=1))
    images.find_images(short, "the Bellman backup diagram", lead=True)
    images.show_image(short, 1, "The backup.")
    images.show_image(short, 2, "Another.")
    assert images.must_show_an_image(short, lesson) is lesson
    # At the cap: kept, whatever the floor.
    capped = _Context(_deps(least=3, images_left=1))
    images.find_images(capped, "the Bellman backup diagram", lead=True)
    images.show_image(capped, 1, "The backup.")
    assert images.must_show_an_image(capped, lesson) is lesson
    # 0 leaves it to the tutor: not even the lead search is demanded.
    assert images.must_show_an_image(_Context(_deps(least=0)), lesson) is lesson


def test_a_lesson_searches_for_its_lead_image_first(library, no_web, monkeypatch):
    """v8.32.0: a lesson that placed a side idea's picture but never looked
    for one of its own subject is sent to look, while it has a search left;
    once it has looked, it is kept whether or not a lead was placed."""
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    deps = _deps()
    context = _Context(deps)
    lesson = tutor.Lesson(text="A lesson.")
    images.find_images(context, "a plot of discounting")
    images.show_image(context, 1, "Discounting.")
    with pytest.raises(images.ModelRetry, match="first for the subject itself"):
        images.must_show_an_image(context, lesson)
    images.find_images(context, "the Bellman backup diagram", lead=True)
    assert images.must_show_an_image(context, lesson) is lesson
    # Out of searches, the lead search isn't demanded.
    spent = _Context(_deps(searches_left=0))
    spent.deps.images.append(deps.images[0])
    assert images.must_show_an_image(spent, lesson) is lesson


def test_a_lead_image_is_marked_and_opens_the_lesson(library, no_web, monkeypatch):
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    deps = _deps()
    context = _Context(deps)
    images.find_images(context, "the Bellman backup diagram", lead=True)
    answer = images.show_image(context, 1, "The backup.", lead=True)
    assert "first line" in answer
    assert deps.images[0].lead is True and deps.lead_slot == 1
    # One lead per lesson: a second is placed like any other.
    answer = images.show_image(context, 2, "Another.", lead=True)
    assert "right after the" in answer
    assert deps.images[1].lead is False


def test_a_lesson_without_an_image_is_kept_when_none_can_be_had(monkeypatch):
    lesson = tutor.Lesson(text="A lesson.")
    # Every search came back empty: nothing to place.
    empty = _Context(_deps(searches_left=0))
    assert images.must_show_an_image(empty, lesson) is lesson
    # A model that won't comply is sent back at most NUDGES times.
    stubborn = _Context(_deps())
    for _ in range(images.NUDGES):
        with pytest.raises(images.ModelRetry):
            images.must_show_an_image(stubborn, lesson)
    assert images.must_show_an_image(stubborn, lesson) is lesson


def test_a_lesson_that_never_searched_is_sent_back_and_only_the_kept_draft_streams(
    library, no_web, monkeypatch
):
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    final = "Values back up.\n\n<<FIG 1>>"

    async def script(messages, info):
        turn = _turns(messages)
        if turn == 0:
            yield {0: DeltaToolCall(name="final_result", json_args='{"text": "From memory."}')}
        elif turn == 1:
            arguments = {"what": "a backup diagram", "lead": True}
            yield {0: DeltaToolCall(name="find_images", json_args=json.dumps(arguments))}
        elif turn == 2:
            yield {0: DeltaToolCall(name="show_image", json_args='{"number": 1, "description": "d"}')}
        else:
            yield {0: DeltaToolCall(name="final_result", json_args=json.dumps({"text": final}))}

    model = FunctionModel(stream_function=script)
    with tutor_main.illustrated_lesson_agent.override(model=model):
        streamed = list(tutor.lesson(CONCEPT, "", [], "", pictures=PICTURES))
    tokens = [event.text for event in streamed if isinstance(event, events.Token)]
    # The draft sent back never reached the stream; the kept one streamed.
    assert tokens == [final]


def test_an_image_without_a_real_caption_gets_the_tutors_description(monkeypatch):
    deps = _deps()
    deps.candidates.append(
        images.Candidate(key="web:h", origin="web", image="/w", caption="maze_one_path", credit="BAIR")
    )
    context = _Context(deps)
    images.show_image(context, 1, " A maze with one path. ")
    (placed,) = deps.images
    # A file name is no caption: the tutor's words stand in for one.
    assert (placed.caption, placed.description, placed.label) == ("", "A maze with one path.", "Image")


def test_wikipedia_figures_come_from_the_subjects_article(monkeypatch):
    article = (
        '<figure><img src="//thumb.wikimedia.org/a/250px-KL.svg.png?utm_content=thumbnail" '
        'srcset="//thumb.wikimedia.org/a/500px-KL.svg.png 2x">'
        "<figcaption>Two distributions to illustrate relative entropy</figcaption></figure>"
        '<figure><img src="//thumb.wikimedia.org/a/250px-Kullback.jpg">'
        "<figcaption>Solomon Kullback</figcaption></figure>"
    )
    fetched = []

    def get(url, **_kwargs):
        fetched.append(url)
        if "list=search" in url:
            return json.dumps({"query": {"search": [{"title": "Kullback–Leibler divergence"}]}}).encode(), "application/json", url
        if "/page/html/" in url:
            return article.encode(), "text/html", url
        return _png(500, 400), "image/png", url

    monkeypatch.setattr(images.web, "safe_get", get)
    found = images._wikipedia_candidates("two distributions relative entropy", "Kullback–Leibler divergence", {})
    # The figure matching the picture asked for first; the larger 2x size, and
    # a "thumbnail" in the query string no longer marks it as page furniture.
    assert found[0].caption == "Two distributions to illustrate relative entropy"
    assert found[0].credit == "Wikipedia: Kullback–Leibler divergence"
    assert found[0].link == "https://en.wikipedia.org/wiki/Kullback%E2%80%93Leibler_divergence"
    assert "https://thumb.wikimedia.org/a/500px-KL.svg.png" in fetched


def test_the_course_papers_figures_are_offered_only_in_its_own_lesson(monkeypatch):
    monkeypatch.setattr(images, "_library_candidates", lambda what: [])
    monkeypatch.setattr(images, "_searched_paper_candidates", lambda what, subject, provider: [])
    monkeypatch.setattr(images, "_web_candidates", lambda what, subject, pixels: [])
    own = images.Candidate(key="ar5iv:x", origin="paper", image="/x", caption="Results", credit="DQN")
    monkeypatch.setattr(images, "_course_paper_candidates", lambda ref, provider, title: [own])
    concept = _deps(paper_ref="1312.5602", paper_title="DQN")
    assert images._gather(concept, "a backup diagram") == []
    paper = _deps(paper_ref="1312.5602", paper_title="DQN", paper_lesson=True)
    assert images._gather(paper, "the architecture") == [own]


def _named(origin: images.Origin, count: int) -> list[images.Candidate]:
    """Some candidates from one source.

    Args:
        origin: Their source.
        count: How many.

    Returns:
        The candidates, keyed by source and number.
    """
    return [
        images.Candidate(key=f"{origin}:{index}", origin=origin, image="/x", caption="", credit=origin)
        for index in range(count)
    ]


def test_every_search_looks_everywhere_and_no_source_outranks_another(monkeypatch):
    monkeypatch.setattr(images, "_library_candidates", lambda what: _named("library", 1))
    monkeypatch.setattr(images, "_searched_paper_candidates", lambda what, subject, provider: _named("paper", 4))
    monkeypatch.setattr(images, "_web_candidates", lambda what, subject, pixels: _named("web", 9))
    found = images._gather(_deps(), "a backup diagram")
    keys = [candidate.key for candidate in found]
    # Interleaved, one from each in turn; the library's unused share goes to the
    # others in turn, so the eight are 1 + 3 + 4 rather than the web's alone.
    assert keys == [
        "library:0", "paper:0", "web:0",
        "paper:1", "web:1",
        "paper:2", "web:2",
        "web:3",
    ]


def test_the_search_budget_is_the_tutors_knob(library, no_web, monkeypatch):
    monkeypatch.setattr(images, "image_bytes", lambda key: (_png(300, 200), "image/png"))
    entry = tutor_main.factory.agent_entry("tutor")
    monkeypatch.setitem(entry.extras, "image_searches", 2)
    deps = tutor_main._image_deps("Bellman equations", PICTURES)
    assert (deps.searches, deps.searches_left) == (2, 2)
