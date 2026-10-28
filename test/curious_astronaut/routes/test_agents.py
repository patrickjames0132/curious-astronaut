"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The assistant's routes (v9.0.0): one endpoint for every view, typed-input
validation at the door, uniform event->SSE serialization, and what each view
lends the model. The context blocks' own bounds are tested beside them, in
``agents/orchestrators/assistant/test_context.py``.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import json

import pytest

from curious_astronaut.agents import events
from curious_astronaut.agents.orchestrators.assistant import context as assistant_context
from curious_astronaut.agents.orchestrators.assistant import main as assistant_main
from curious_astronaut.config import config

SEED = {
    "id": "seed01", "arxiv_id": "1312.5602", "title": "Playing Atari",
    "abstract": None, "tldr": None, "year": 2013, "month": None,
    "pub_date": None, "citation_count": 10000, "authors": None,
    "url": "https://example.org/seed01", "rels": ["seed"], "is_seed": True,
    # force-graph simulation baggage the route must tolerate:
    "x": 12.5, "vy": -0.3, "index": 0,
}
NODES = [SEED, {**SEED, "id": "node02", "title": "Q-learning", "is_seed": False}]


def patch_agents(monkeypatch, fake):
    """Swap both agents the assistant runs, so one fake serves either workflow.

    Args:
        monkeypatch: The test's monkeypatch fixture.
        fake: A generator taking keyword arguments, standing in for either.
    """
    monkeypatch.setattr(assistant_main.researcher, "answer", fake)
    monkeypatch.setattr(assistant_main.lecturer, "lecture", fake)


def citations(**view) -> dict:
    """A Citation Graph view over the test graph."""
    return {"kind": "citations", "seed": SEED, "nodes": NODES, **view}


def lecture(client, **view):
    """Ask for a lecture over the test graph."""
    return client.post("/api/assistant", json={"workflow": "lecture", "view": citations(**view)})


def frames(response) -> list[tuple[str, dict]]:
    parsed = []
    for chunk in response.data.decode().strip().split("\n\n"):
        event_line, data_line = chunk.split("\n")
        parsed.append(
            (event_line.removeprefix("event: "), json.loads(data_line.removeprefix("data: ")))
        )
    return parsed


def test_lecture_types_the_payload_and_relays_by_event_type(client, monkeypatch):
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Beat(heading="Roots", text="It began.", node_ids=["node02"])

    patch_agents(monkeypatch, fake_run)
    response = lecture(client)
    assert frames(response) == [
        ("beat", {"heading": "Roots", "text": "It began.", "node_ids": ["node02"],
                  "graph_refs": {}, "figure": None, "quote": None, "labels": []}),
        ("done", {}),
    ]
    # The route delivered typed Nodes, sim baggage stripped, annotations kept.
    typed_seed = seen["kwargs"]["seed"]
    assert typed_seed.id == "seed01" and typed_seed.is_seed is True
    assert not hasattr(typed_seed, "x")


def test_lecture_passes_the_scope_through_untouched(client, monkeypatch):
    """The v7.17.0 contract. The reader's scope IS the lecture's subject, so
    the route hands the node list to the lecturer exactly as it arrived — no
    relation filtering, and no `mode` deciding a different set. It used to
    also parse an `edges` list, which existed only so a mode could rebuild its
    own slice of the graph; nothing needs it now."""
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Beat(heading="Roots", text="It began.", node_ids=[])

    patch_agents(monkeypatch, fake_run)
    lecture(client).data
    assert [node.id for node in seen["kwargs"]["nodes"]] == [node["id"] for node in NODES]
    assert seen["kwargs"]["target"] is None
    assert "mode" not in seen["kwargs"] and "edges" not in seen["kwargs"]


def test_lecture_passes_the_readers_framing_through(client, monkeypatch):
    """Framing is the reader's one remaining choice about a lecture — the scope
    already says which papers — so it has to reach the lecturer."""
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Beat(heading="Themes", text="It began.", node_ids=[])

    patch_agents(monkeypatch, fake_run)
    lecture(client, framing="history").data
    assert seen["kwargs"]["framing"] == "history"


def test_lecture_defaults_to_a_summary_and_never_400s_on_a_bad_framing(client, monkeypatch):
    """A framing is a preference, so an unknown one falls back rather than
    refusing the lecture — and the fallback is `summary`, because a
    chronological arc is a strong claim to make about an arbitrary selection."""
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Beat(heading="Themes", text="It began.", node_ids=[])

    patch_agents(monkeypatch, fake_run)
    for body in ({}, {"framing": "opera"}, {"framing": None}, {"framing": 7}):
        response = lecture(client, **body)
        assert response.status_code == 200
        assert seen["kwargs"]["framing"] == "summary"


def test_lecture_input_validation(client):
    assert lecture(client, nodes=[]).status_code == 400
    broken = {**SEED}
    del broken["url"]  # a required core field
    assert lecture(client, nodes=[broken]).status_code == 400
    assert lecture(client, bridge=broken).status_code == 400


def test_ask_streams_without_server_history(client, monkeypatch):
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Token(text="As the figure shows.\n<<FIG 1>>\nSo it works.")
        yield events.Cited(node_ids=["seed01"])

    patch_agents(monkeypatch, fake_run)
    body = {"question": "why?", "view": citations(), "source_ids": ["s1", 42, ""]}
    response = client.post("/api/assistant", json=body)
    assert [name for name, _ in frames(response)] == ["token", "cited", "done"]
    assert seen["kwargs"]["source_ids"] == ["s1"]  # non-strings dropped
    assert seen["kwargs"]["history"] == []
    body["history"] = [{"role": "assistant", "content": "Lecture: the earlier approach"}]
    client.post("/api/assistant", json=body).data
    assert seen["kwargs"]["history"] == body["history"]
    body.pop("history")
    client.post("/api/assistant", json=body).data
    assert seen["kwargs"]["history"] == []


def test_the_citation_graph_assistant_runs_without_paper_search(client, monkeypatch):
    """v8.28.0: the Citation Graph view turns the researcher's paper scout
    off, and with it the bar's paper filters, which only ever bound that scout."""
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Token(text="From the graph.")

    patch_agents(monkeypatch, fake_run)
    client.post(
        "/api/assistant", json={"question": "why?", "view": citations(year_from=2020)}
    ).data
    assert seen["kwargs"]["paper_search"] is False
    assert "year_from" not in seen["kwargs"]


@pytest.mark.parametrize(
    "view",
    [
        citations(),
        {"kind": "general"},
        {"kind": "knowledge", "course": {"paper": "Atari", "items": [{"title": "Q-learning", "kind": "concept"}]}},
    ],
)
def test_every_answer_carries_a_quick_response(client, monkeypatch, view):
    """v8.30.0: ⚡ Quick response on every chat bar sends `quick: true`; only
    a literal true counts, so anything else leaves the tools on."""
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Token(text="Now.")

    patch_agents(monkeypatch, fake_run)
    client.post("/api/assistant", json={"question": "why?", "quick": True, "view": view}).data
    assert seen["kwargs"]["quick"] is True
    client.post("/api/assistant", json={"question": "why?", "quick": "yes", "view": view}).data
    assert seen["kwargs"]["quick"] is False


@pytest.mark.parametrize(
    "view",
    [
        citations(),
        {"kind": "general"},
        {"kind": "knowledge", "course": {"paper": "Atari", "items": [{"title": "Q-learning", "kind": "concept"}]}},
    ],
)
def test_every_answer_carries_the_chat_bars_model_pick(client, monkeypatch, view):
    """v8.33.0: the chat bar's model picker sends `model`; only a
    "provider:model" naming a known vendor reaches the researcher, and anything
    else falls back to the configured model (None) instead of failing."""
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Token(text="Hi.")

    patch_agents(monkeypatch, fake_run)
    sent = {"question": "why?", "view": view}
    client.post("/api/assistant", json={**sent, "model": "openai:gpt-test"}).data
    assert seen["kwargs"]["model"] == "openai:gpt-test"
    for junk in ("gpt-test", "nobody:gpt-test", "openai:", 7):
        client.post("/api/assistant", json={**sent, "model": junk}).data
        assert seen["kwargs"]["model"] is None
    client.post("/api/assistant", json=sent).data
    assert seen["kwargs"]["model"] is None


def test_an_empty_scope_survives_the_wire_as_an_empty_list(client, monkeypatch):
    """"No sources selected" and "no scope at all" are opposite instructions
    that both look falsy, and only the list/None distinction tells them apart.

    This is what the source picker's None button is worth: with the picker now
    shown at a *single* source (v7.2.0), unticking it is a reader's only way to
    ask a question without their one uploaded book in play. If `[]` collapsed
    to `None` anywhere along the wire it would mean the exact opposite —
    search everything."""
    seen = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.Token(text="Answering without your library.")

    patch_agents(monkeypatch, fake_run)
    client.post("/api/assistant", json={"question": "why?", "view": citations(), "source_ids": []})
    assert seen["kwargs"]["source_ids"] == []  # NOT None — that would search everything


def test_failed_answers_do_not_poison_history(client, monkeypatch):
    def fake_run(**kwargs):
        yield events.Token(text="starting...")
        raise RuntimeError("Semantic Scholar is unavailable — try again.")

    patch_agents(monkeypatch, fake_run)
    response = client.post("/api/assistant", json={"question": "why?", "view": citations()})
    assert frames(response)[-1] == (
        "error", {"message": "Semantic Scholar is unavailable — try again."}
    )


def test_every_view_receives_client_lecture_history(client, monkeypatch):
    seen = []

    def fake_run(**kwargs):
        seen.append(kwargs["history"])
        yield events.Token(text="ok")

    patch_agents(monkeypatch, fake_run)
    history = [{"role": "user", "content": "/lecture"},
               {"role": "assistant", "content": "Early methods\nThey abandoned that approach."}]
    for view in (citations(), {"kind": "general"}):
        client.post("/api/assistant", json={"question": "why?", "view": view, "history": history}).data
    assert seen == [history, history]


def test_the_general_view_runs_the_researcher_without_a_graph(client, monkeypatch):
    """The general chat is the same agent as the Citation Graph's, just
    seedless — with paper search on, and no embedder probe or refusal."""
    seen: dict = {}

    def fake_run(**kwargs):
        seen["kwargs"] = kwargs
        yield events.SourceSearchTrace(ok=True, query="anything", found=0)
        yield events.Token(text="Nothing in your library covers that.")

    patch_agents(monkeypatch, fake_run)
    response = client.post(
        "/api/assistant",
        json={"question": "anything", "view": {"kind": "general", "year_from": "2020", "fields": ["nope"]}},
    )
    assert response.status_code == 200  # no embedder probe, no 400 refusal
    assert frames(response)[0][0] == "trace"
    # No seed and no nodes — that absence IS the graph-free mode.
    assert "seed" not in seen["kwargs"] and "nodes" not in seen["kwargs"]
    assert seen["kwargs"]["paper_search"] is True
    # The bar's filters ride on the general view, where the scout runs.
    assert seen["kwargs"]["year_from"] == 2020 and seen["kwargs"]["fields"] == []

    question_missing = client.post("/api/assistant", json={"view": {"kind": "general"}})
    assert question_missing.status_code == 400


def test_the_general_view_runs_on_the_requested_provider(client, monkeypatch):
    """The graph-free chat has no graph to inherit a backend from, so the
    dropdown's choice has to ride on the request — until v6.14.0 it didn't, and
    a chat under OpenAlex quietly searched Semantic Scholar instead."""
    seen: dict = {}

    def fake_run(**kwargs):
        seen.update(kwargs)
        yield events.Token(text="ok")

    patch_agents(monkeypatch, fake_run)
    general = {"kind": "general"}
    client.post("/api/assistant", json={"question": "q", "view": general, "provider": "openalex"}).data
    assert seen["provider"] == "openalex"
    # Junk degrades to the configured default rather than erroring, same as
    # every other provider-keyed route.
    client.post("/api/assistant", json={"question": "q", "view": general, "provider": "nonsense"}).data
    assert seen["provider"] == config.providers.default_provider


class TestRouteEndpoint:
    """``POST /api/assistant/route``: the decision before the stream.

    It sits in front of every message the reader sends, so what these pin is
    mostly that it cannot fail: a bad body, a dead model or a nonsense payload
    all have to come back as a usable decision, because 500-ing here would
    break asking questions in order to protect a routing nicety.
    """

    def test_it_returns_the_routers_decision_as_json(self, client, monkeypatch):
        from curious_astronaut.agents.orchestrators import router

        monkeypatch.setattr(
            router,
            "route",
            lambda message: router.MessageRoute(
                target="lecture", framing="history", scope="references"
            ),
        )
        response = client.post(
            "/api/assistant/route",
            json={"message": "lecture me on the references", "view": {"kind": "citations"}},
        )
        assert response.status_code == 200
        assert response.get_json() == {
            "workflow": "lecture",
            "framing": "history",
            "scope": "references",
            "year_from": None,
            "year_to": None,
        }

    def test_the_message_reaches_the_router_verbatim(self, client, monkeypatch):
        from curious_astronaut.agents.orchestrators import router

        seen: list[str] = []

        def capture(message):
            seen.append(message)
            return router.ANSWER

        monkeypatch.setattr(router, "route", capture)
        client.post(
            "/api/assistant/route",
            json={"message": "  @DQN what is this?  ", "view": {"kind": "citations"}},
        )
        # Untrimmed: `@` mentions and leading space are the router's to read,
        # and the fast path anchors on the start of the message.
        assert seen == ["  @DQN what is this?  "]

    @pytest.mark.parametrize(
        "body", [{}, {"message": None}, {"message": 42}, {"message": ["a list"]}, None]
    )
    def test_a_malformed_body_answers_instead_of_400ing(self, client, body):
        # No model is reachable in tests, so this also covers the dead-model
        # path: either way the reader gets a route they can act on.
        response = client.post(
            "/api/assistant/route", json={**body, "view": {"kind": "citations"}} if body else body
        )
        assert response.status_code == 200
        assert response.get_json() == {
            "workflow": "answer",
            "framing": "summary",
            "scope": "screen",
            "year_from": None,
            "year_to": None,
        }


class TestRoutePapersEndpoint:
    """``POST /api/assistant/route/papers``: the named-scope resolver, JSON like its
    sibling and just as unable to fail — an empty ``ids`` is both "nothing
    matched" and every failure, since the client handles the first anyway.
    """

    def test_it_passes_well_formed_papers_and_skips_the_rest(self, client, monkeypatch):
        from curious_astronaut.agents.orchestrators import router

        seen: list[tuple[str, list[str]]] = []

        def capture(message, papers):
            seen.append((message, [paper.id for paper in papers]))
            return ["p2"]

        monkeypatch.setattr(router, "resolve_papers", capture)
        response = client.post(
            "/api/assistant/route/papers",
            json={
                "message": "lecture me on the BERT paper",
                "papers": [
                    {"id": "p1", "title": "One", "year": 2019, "authors": "A, B"},
                    {"title": "no id"},
                    "not a dict",
                    # Force-graph baggage on a node is ignored, not refused.
                    {"id": "p2", "title": "BERT", "x": 1.5, "vy": 0},
                ],
            },
        )
        assert response.status_code == 200
        assert response.get_json() == {"ids": ["p2"]}
        assert seen == [("lecture me on the BERT paper", ["p1", "p2"])]

    @pytest.mark.parametrize(
        "body", [{}, {"message": "x"}, {"message": "x", "papers": "nope"}, {"papers": []}, None]
    )
    def test_a_malformed_body_matches_nothing_instead_of_400ing(self, client, body):
        response = client.post("/api/assistant/route/papers", json=body)
        assert response.status_code == 200
        assert response.get_json() == {"ids": []}


COURSE = {
    "paper": "Playing Atari",
    "open": "Q-learning",
    "items": [
        {"title": "Playing Atari", "kind": "paper",
         "needs": [{"title": "Q-learning", "why": "DQN learns Q."}]},
        {"title": "Q-learning", "kind": "concept", "lesson": "Q-learning learns values."},
        {"title": "MDPs", "kind": "concept", "known": True, "lesson": "An MDP is" + " x" * 2000},
        {"title": "Value learning", "kind": "synthesis", "members": ["Q-learning", "MDPs"],
         "toward": "Playing Atari"},
    ],
}


def test_the_knowledge_view_runs_the_researcher_over_the_course(client, monkeypatch):
    """The Knowledge Graph's assistant (v8.25.0): the graph-free researcher,
    handed the course laid out, with history and sibling chats as for the
    others."""
    seen: dict = {}

    def fake_run(**kwargs):
        seen.update(kwargs)
        yield events.Token(text="ok")

    patch_agents(monkeypatch, fake_run)
    history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
    response = client.post(
        "/api/assistant",
        json={"question": "what next?", "view": {"kind": "knowledge", "course": COURSE}, "history": history},
    )
    assert frames(response) == [("token", {"text": "ok"}), ("done", {})]
    assert "seed" not in seen and "nodes" not in seen
    assert seen["history"] == history
    assert seen["paper_search"] is False  # v8.28.0: no paper search over a course
    course = seen["course"]
    assert "- MDPs (concept) [checked off as known]" in course
    assert "needs Q-learning: DQN learns Q." in course
    assert "combines Q-learning, MDPs toward Playing Atari" in course
    assert "THE LESSON THE STUDENT HAS OPEN: Q-learning\nQ-learning learns values." in course
    # Other lessons are excerpts.
    assert "## MDPs" in course and len(course) < 3000


def test_the_knowledge_view_needs_a_question_and_a_course(client, monkeypatch):
    patch_agents(monkeypatch, lambda **_kwargs: iter(()))

    def ask(body, **view):
        return client.post("/api/assistant", json={**body, "view": {"kind": "knowledge", **view}})

    assert ask({}, course=COURSE).status_code == 400
    assert ask({"question": "q"}).status_code == 400
    assert ask({"question": "q"}, course="x").status_code == 400


READER_DOC = {
    "available": True,
    "title": [{"kind": "text", "text": "Attention Is All You Need"}],
    "abstract": [{"kind": "paragraph", "inlines": [{"kind": "text", "text": "Transformers."}]}],
    "sections": [
        {
            "id": "S1",
            "level": 1,
            "number": "1",
            "title": [{"kind": "text", "text": "Introduction"}],
            "blocks": [{"kind": "paragraph", "inlines": [{"kind": "text", "text": "RNNs are slow."}]}],
        },
        {
            "id": "S3.SS2",
            "level": 2,
            "number": "3.2",
            "title": [{"kind": "text", "text": "Attention"}],
            "blocks": [
                {"kind": "paragraph", "inlines": [
                    {"kind": "text", "text": "We scale by "},
                    {"kind": "math", "latex": "\\sqrt{d_k}", "display": False},
                ]},
                {"kind": "equation", "id": "S3.E1", "latex": "QK^T", "tag": "(1)"},
            ],
        },
    ],
    "bibliography": [],
}


#: What rides beside the view on every request; the rest of a Reader body is the view.
TOP_LEVEL = ("question", "quick", "model", "provider", "history")


def reader_request(body: dict, **top) -> dict:
    """A request from the Reader: ``body``'s view fields under ``view``."""
    view = {key: value for key, value in body.items() if key not in TOP_LEVEL}
    kept = {key: value for key, value in body.items() if key in TOP_LEVEL}
    return {**kept, **top, "view": {"kind": "reader", **view}}


def ask_reader(client, body: dict):
    """Ask from the Reader."""
    return client.post("/api/assistant", json=reader_request(body))


def guide_reader(client, body: dict):
    """Ask the Reader for a guided read."""
    return client.post("/api/assistant", json=reader_request(body, workflow="guide"))


def test_the_reader_view_lays_out_the_paper_being_read(client, monkeypatch):
    """The Reader's assistant (v8.38.0): the graph-free researcher, handed the
    paper from the cached document, the section in view shown whole first."""
    seen: dict = {}
    asked: list = []

    def fake_document(ref):
        asked.append(ref)
        return READER_DOC

    def fake_run(**kwargs):
        seen.update(kwargs)
        yield events.Token(text="ok")

    monkeypatch.setattr(assistant_context.arxiv, "get_document", fake_document)
    patch_agents(monkeypatch, fake_run)
    response = ask_reader(client, {"question": "explain", "paper": "1706.03762", "section": "S3.SS2", "quick": True,
              "model": "anthropic:claude-x"},
    )
    assert frames(response) == [("token", {"text": "ok"}), ("done", {})]
    assert asked == ["1706.03762"]
    assert seen["paper_search"] is False
    assert seen["quick"] is True
    assert seen["model"] == "anthropic:claude-x"
    reading = seen["reading"]
    assert "THE PAPER BEING READ: 'Attention Is All You Need'" in reading
    assert "Abstract: Transformers." in reading
    assert "Outline:\n1 Introduction\n  3.2 Attention" in reading
    assert "THE SECTION THEY ARE READING: 3.2 Attention" in reading
    assert "We scale by $\\sqrt{d_k}$" in reading
    assert "$$QK^T$$ (1)" in reading
    # The section in view comes first and isn't repeated in the running text.
    assert reading.index("THE SECTION THEY ARE READING") < reading.index("## 1 Introduction")
    assert "## 3.2 Attention\n(shown above)" in reading


def test_the_reader_view_needs_a_question_and_a_readable_paper(client, monkeypatch):
    patch_agents(monkeypatch, lambda **_kwargs: iter(()))
    monkeypatch.setattr(assistant_context.arxiv, "get_document", lambda ref: {"available": False})
    # No PDF either (v8.40.0's fallback): and never a network lookup in a test.
    monkeypatch.setattr(assistant_context.pdf_service, "paper_pdf_url", lambda ref, provider: None)
    assert ask_reader(client, {"paper": "1706.03762"}).status_code == 400
    assert ask_reader(client, {"question": "q", "paper": "1706.03762"}).status_code == 400
    assert ask_reader(client, {"question": "q", "paper": "not-an-id"}).status_code == 400

    def boom(ref):
        raise TimeoutError("ar5iv slow")

    monkeypatch.setattr(assistant_context.arxiv, "get_document", boom)
    assert ask_reader(client, {"question": "q", "paper": "1706.03762"}).status_code == 400


def _pdf_pages(monkeypatch, pages, *, has_extra=True):
    """Stand a paper's PDF in for the Reader assistant's PDF context."""
    monkeypatch.setattr(assistant_context.pdf_service, "paper_pdf_url", lambda ref, provider: "https://x/p.pdf")
    monkeypatch.setattr(assistant_context.pdf_service, "get_pdf_pages", lambda url: {"available": True, "pages": pages})
    monkeypatch.setattr(assistant_context.optional, "available", lambda extra: has_extra)


def test_the_reader_view_reads_the_pdf_page_by_page_in_the_pdf_view(client, monkeypatch):
    """v8.40.0: in the PDF view the section is page:<n>, and the PDF's text is
    laid out with that page first."""
    seen: dict = {}

    def fake_run(**kwargs):
        seen.update(kwargs)
        yield events.Token(text="ok")

    _pdf_pages(monkeypatch, ["Page one text.", "Page two text.", "Page three text."])
    monkeypatch.setattr(assistant_context.arxiv, "get_document", lambda ref: pytest.fail("PDF view reads the PDF"))
    patch_agents(monkeypatch, fake_run)
    response = ask_reader(client, {"question": "explain", "paper": "1412.6980", "section": "page:2", "title": "Adam"},
    )
    assert frames(response)[-1] == ("done", {})
    reading = seen["reading"]
    assert "THE PAPER BEING READ: 'Adam', as its PDF (3 pages)." in reading
    assert "THE PAGE THEY ARE READING: page 2\n\nPage two text." in reading
    assert "--- page 2 ---\n(shown above)" in reading
    assert reading.index("Page two text.") < reading.index("--- page 1 ---")


def test_the_reader_view_prefers_the_document_and_falls_back_to_the_pdf(client, monkeypatch):
    seen: dict = {}

    def fake_run(**kwargs):
        seen.update(kwargs)
        yield events.Token(text="ok")

    patch_agents(monkeypatch, fake_run)
    _pdf_pages(monkeypatch, ["From the PDF."])
    monkeypatch.setattr(assistant_context.arxiv, "get_document", lambda ref: READER_DOC)
    ask_reader(client, {"question": "q", "paper": "1706.03762", "section": "S1"}).data
    assert "Attention Is All You Need" in seen["reading"] and "From the PDF." not in seen["reading"]

    # No HTML render (Adam): the PDF stands in.
    monkeypatch.setattr(assistant_context.arxiv, "get_document", lambda ref: {"available": False})
    ask_reader(client, {"question": "q", "paper": "1412.6980"}).data
    assert "From the PDF." in seen["reading"]


def test_the_reader_view_says_when_the_pdf_extra_is_missing(client, monkeypatch):
    patch_agents(monkeypatch, lambda **_kwargs: iter(()))
    _pdf_pages(monkeypatch, ["text"], has_extra=False)
    response = ask_reader(client, {"question": "q", "paper": "1412.6980", "section": "page:1"}
    )
    assert response.status_code == 400
    assert "uv sync --extra pdf" in response.json["error"]


def test_the_reader_view_pictures_a_pdf_highlight_for_the_model(client, monkeypatch, tmp_path):
    """v8.45.0: a highlight in the PDF view comes as places; the question
    carries the PDF's own words there, and a picture of it."""
    seen: dict = {}

    def fake_run(**kwargs):
        seen.update(kwargs)
        yield events.Token(text="ok")

    _pdf_pages(monkeypatch, ["Page one text.", "Page two text."])
    monkeypatch.setattr(assistant_context.pdf_service, "fetch_pdf", lambda url: tmp_path / "p.pdf")
    monkeypatch.setattr(
        assistant_context.pdf_passages, "passage_at", lambda path, places: {"text": "x = y + 1", "places": places}
    )
    monkeypatch.setattr(assistant_context.pdf_passages, "render_places", lambda path, places: [b"\x89PNG one"])
    patch_agents(monkeypatch, fake_run)
    places = [{"page": 2, "rects": [[10, 20, 30, 40]]}]
    response = ask_reader(client, {"question": "explain", "paper": "1412.6980", "section": "page:2", "places": places},
    )
    assert frames(response)[-1] == ("done", {})
    assert seen["images"] == [b"\x89PNG one"]
    assert "THE PASSAGE THEY HIGHLIGHTED, on page 2 of the PDF, is pictured in the image sent" in seen["reading"]
    assert seen["reading"].endswith("Its words, as the PDF holds them: x = y + 1")


def test_the_reader_view_asks_in_words_alone_without_places_or_a_picture(client, monkeypatch, tmp_path):
    seen: dict = {}

    def fake_run(**kwargs):
        seen.update(kwargs)
        yield events.Token(text="ok")

    _pdf_pages(monkeypatch, ["Page one text."])
    patch_agents(monkeypatch, fake_run)
    body = {"question": "q", "paper": "1412.6980", "section": "page:1"}
    frames(ask_reader(client, body))
    assert seen["images"] == [] and "HIGHLIGHTED" not in seen["reading"]

    def refuse(url):
        raise assistant_context.pdf_service.PdfError("gone")

    monkeypatch.setattr(assistant_context.pdf_service, "fetch_pdf", refuse)
    frames(ask_reader(client, {**body, "places": [{"page": 1, "rects": [[1, 2, 3, 4]]}]}))
    assert seen["images"] == [] and "HIGHLIGHTED" not in seen["reading"]


def test_the_reader_view_shows_the_model_figures_boxed_in_the_text(client, monkeypatch):
    """v8.48.0: a box over the text sends its figures' image sources; the
    model gets the images, and is told they're pictured."""
    seen: dict = {}

    def fake_run(**kwargs):
        seen.update(kwargs)
        yield events.Token(text="ok")

    _pdf_pages(monkeypatch, ["Page one text."])
    monkeypatch.setattr(assistant_context.reader_figures, "figure_pngs", lambda raw: [b"\x89PNG fig"] if raw else [])
    patch_agents(monkeypatch, fake_run)
    body = {"question": "q", "paper": "1412.6980", "section": "page:1", "figures": ["/api/figure_proxy?src=x"]}
    frames(ask_reader(client, body))
    assert seen["images"] == [b"\x89PNG fig"]
    assert "THE FIGURE THEY BOXED in the paper's text is pictured in the image sent" in seen["reading"]


def test_the_reader_view_routes_guide_or_answer(client):
    """v8.50.0: a plain ask for a guided read is routed without a model."""

    def route(message):
        body = {"message": message, "view": {"kind": "reader"}}
        return client.post("/api/assistant/route", json=body).json["workflow"]

    assert route("walk me through this paper") == "guide"
    assert route(7) == "answer"


def test_a_guided_read_streams_beats_over_the_paper_being_read(client, monkeypatch):
    """v8.50.0: the guided read reads the paper as the Reader Assistant does,
    and streams the lecturer's beats."""
    seen: dict = {}

    def fake_guided_read(reading, known, learning):
        seen.update(reading=reading, known=known, learning=learning)
        yield events.Beat(heading="Step", text="Teach it.", node_ids=[], quote="the words", labels=["(1)"])

    _pdf_pages(monkeypatch, ["Page one text."])
    monkeypatch.setattr(assistant_main.lecturer, "guided_read", fake_guided_read)
    response = guide_reader(client, {"paper": "1412.6980", "section": "page:1", "known": ["Softmax", 3], "learning": "x"},
    )
    sent = frames(response)
    assert sent[0][0] == "beat" and sent[0][1]["quote"] == "the words" and sent[0][1]["labels"] == ["(1)"]
    assert sent[-1] == ("done", {})
    assert seen["known"] == ["Softmax"] and seen["learning"] == []
    assert "THE PAGE THEY ARE READING: page 1" in seen["reading"]
    assert guide_reader(client, {}).status_code == 400


class TestCapabilities:
    """What each view lets the assistant do (``assistant.views``), enforced at
    the door: a request the view doesn't offer is refused before a stream
    exists, and a view with nothing to choose between is never routed."""

    @pytest.mark.parametrize(
        "body",
        [
            {"question": "q"},  # no view at all
            {"question": "q", "view": {"kind": "graph"}},
            {"question": "q", "view": "citations"},
            {"workflow": "lecture", "view": {"kind": "reader", "paper": "1412.6980"}},
            {"workflow": "guide", "view": citations()},
            {"workflow": "lecture", "view": {"kind": "general"}},
            {"workflow": "lecture", "view": {"kind": "knowledge"}},
            {"workflow": "teach", "question": "q", "view": {"kind": "general"}},
        ],
    )
    def test_a_view_refuses_what_it_does_not_offer(self, client, monkeypatch, body):
        patch_agents(monkeypatch, lambda **_kwargs: pytest.fail("nothing should run"))
        response = client.post("/api/assistant", json=body)
        assert response.status_code == 400
        assert response.json["error"]

    @pytest.mark.parametrize("kind", ["general", "knowledge", None])
    def test_a_view_that_only_answers_is_never_routed(self, client, monkeypatch, kind):
        """Asking a model to choose when there is one choice is paying for a
        known result: the general chat and the course always answer."""
        from curious_astronaut.agents.orchestrators import router

        monkeypatch.setattr(router, "route", lambda message: pytest.fail("routed"))
        monkeypatch.setattr(router, "route_reading", lambda message: pytest.fail("routed"))
        body = {"message": "lecture me on everything", "view": {"kind": kind}}
        assert client.post("/api/assistant/route", json=body).json["workflow"] == "answer"


class TestPlaceEndpoint:
    """``POST /api/assistant/route/place`` (v9.0.0, stage 4b): what a message is
    about, and as unable to fail as the other routes: a bad body keeps it here."""

    def test_it_passes_the_papers_and_screen_and_returns_the_place(self, client, monkeypatch):
        from curious_astronaut.agents.orchestrators import router

        seen: list = []

        def capture(message, papers, screen_paper=None, screen_tool=None):
            seen.append((message, papers, screen_paper, screen_tool))
            return router.PlaceRoute(place="paper", paper=2, tool="graph")

        monkeypatch.setattr(router, "route_place", capture)
        body = {
            "message": "and the Atari paper's references?",
            "papers": ["Attention", "Atari", 7],
            "screen": {"paper": 1, "tool": "reader"},
        }
        response = client.post("/api/assistant/route/place", json=body)
        assert response.get_json() == {"place": "paper", "paper": 2, "tool": "graph"}
        assert seen == [("and the Atari paper's references?", ["Attention", "Atari"], 1, "reader")]

    @pytest.mark.parametrize(
        "body", [{}, {"message": 3}, {"message": "x", "papers": "nope", "screen": [1]}, None]
    )
    def test_a_malformed_body_stays_here(self, client, body):
        response = client.post("/api/assistant/route/place", json=body)
        assert response.status_code == 200
        assert response.get_json() == {"place": "here", "paper": None, "tool": None}
