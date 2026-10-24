"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
headings: a PDF's table of contents for the Reader's PDF view (v8.40.0) — its
outline when it has one, else headings found in its text, on synthetic PDFs
built to show the layouts real arXiv PDFs use.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import fitz

from curious_astronaut.services.pdf import headings

BODY = "This is ordinary body text in the paper, set at the body size. " * 3


def _pdf(tmp_path, draw, toc=None):
    """A one-page PDF drawn by ``draw(page)``, with body text for its size."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    for row in range(12):
        page.insert_text((72, 400 + row * 14), BODY[:90], fontsize=10)
    draw(page)
    if toc:
        doc.set_toc(toc)
    path = tmp_path / "paper.pdf"
    doc.save(path)
    doc.close()
    return path


def test_a_number_set_apart_from_its_title_is_joined(tmp_path):
    # Attention and Adam set "1" and "Introduction" as separate lines.
    def draw(page):
        page.insert_text((72, 100), "1", fontsize=14)
        page.insert_text((92, 100), "Introduction", fontsize=14)
        page.insert_text((72, 150), "3.2", fontsize=14)
        page.insert_text((98, 150), "Attention", fontsize=14)

    found = headings.find_headings(_pdf(tmp_path, draw))
    assert found == [
        {"title": "1 Introduction", "level": 1, "page": 1, "top": 84.9},
        {"title": "3.2 Attention", "level": 2, "page": 1, "top": 134.9},
    ]


def test_a_wrapped_heading_takes_its_second_line(tmp_path):
    def draw(page):
        page.insert_text((72, 100), "4 From Soft Policy Iteration to Soft\nActor-Critic", fontsize=14)

    found = headings.find_headings(_pdf(tmp_path, draw))
    assert found == [{"title": "4 From Soft Policy Iteration to Soft Actor-Critic", "level": 1, "page": 1, "top": 84.9}]


def test_numbered_body_text_and_all_caps(tmp_path):
    def draw(page):
        page.insert_text((72, 100), "2 RELATED WORK", fontsize=14)
        page.insert_text((72, 130), "REFERENCES", fontsize=14)
        # A numbered line at the body size is a list item, not a heading.
        page.insert_text((72, 160), "1 We first note that the method converges.", fontsize=10)

    found = headings.find_headings(_pdf(tmp_path, draw))
    assert found == [
        {"title": "2 Related work", "level": 1, "page": 1, "top": 84.9},
        {"title": "References", "level": 1, "page": 1, "top": 114.9},
    ]


def test_the_outline_comes_first_when_the_pdf_has_one(tmp_path):
    def draw(page):
        page.insert_text((72, 100), "1 Introduction", fontsize=14)

    toc = [[1, "Intro (bookmark)", 1, {"kind": fitz.LINK_GOTO, "to": fitz.Point(72, 86)}]]
    contents = headings.find_contents(_pdf(tmp_path, draw, toc=toc))
    assert contents == {
        "source": "outline",
        "entries": [{"title": "Intro (bookmark)", "level": 1, "page": 1, "top": 86.0}],
    }
    contents = headings.find_contents(_pdf(tmp_path, draw))
    assert contents == {
        "source": "headings",
        "entries": [{"title": "1 Introduction", "level": 1, "page": 1, "top": 84.9}],
    }


def test_an_outline_entry_knows_how_far_down_its_page_it_points(tmp_path):
    # Two sections on one page (the SHARSA paper's page 8): the contents need
    # each one's place to jump to it and to tell which is being read.
    doc = fitz.open(_pdf(tmp_path, lambda page: None))
    # A direct destination reads back top-down; a named one (hyperref's)
    # bottom-up, in the page's own coordinates.
    assert headings._outline_top(doc, 1, {"kind": fitz.LINK_GOTO, "to": fitz.Point(108, 366.0)}) == 366.0
    assert headings._outline_top(doc, 1, {"kind": fitz.LINK_NAMED, "to": fitz.Point(108, 194.6)}) == 597.4
    # Off the page, or no point at all: unknown.
    assert headings._outline_top(doc, 1, {"kind": fitz.LINK_NAMED, "to": fitz.Point(108, 900)}) is None
    assert headings._outline_top(doc, 1, {"kind": fitz.LINK_URI}) is None
    doc.close()


def test_spans_join_with_a_space_where_the_gap_is_wide():
    # Adam's small caps: "I" "NITIALIZATION" "B" "IAS", word gaps only in the geometry.
    def span(text, start, end):
        return {"text": text, "size": 10.0, "bbox": (start, 0, end, 10)}

    spans = [span("I", 0, 4), span("NITIALIZATION", 4, 60), span("B", 64, 68), span("IAS", 68, 80)]
    assert headings._span_text(spans) == "INITIALIZATION BIAS"
