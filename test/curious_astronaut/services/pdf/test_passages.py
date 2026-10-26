"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Passages by place (v8.45.0): a highlight's words read from where it sits,
an answer's quotes found as rectangles, and either pictured for the model.

A real synthetic PDF, so pymupdf's words, boxes and renders are the real ones.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import fitz

from curious_astronaut.services.pdf import passages

LINES = [
    "Attention lets every position look at every other position",
    "in one step, which is why the model trains so quickly on",
    "long sequences of words without any recurrent connections.",
]


def _paper(tmp_path):
    """A two-page PDF: three lines of prose on page 1, a line on page 2."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    for row, line in enumerate(LINES):
        page.insert_text((72, 100 + row * 14), line, fontsize=10)
    page.insert_text((72, 400), "An efficient method stands apart.", fontsize=10)
    doc.new_page(width=612, height=792).insert_text((72, 100), "The second page says hello.", fontsize=10)
    path = tmp_path / "paper.pdf"
    doc.save(path)
    doc.close()
    return path


def test_comparable_keeps_letters_and_digits_and_spells_ligatures():
    assert passages.comparable("Eﬃcient, Model-2!") == "efficientmodel2"


def test_clean_places_drops_what_isnt_a_place():
    raw = [
        {"page": 1, "rects": [[1, 2, 3, 4], [5, 5, 4, 6], [1, 2, 3], "x", [1, True, 3, 4]]},
        {"page": 0, "rects": [[1, 2, 3, 4]]},
        {"page": True, "rects": [[1, 2, 3, 4]]},
        {"page": 2, "rects": []},
        "nonsense",
    ]
    assert passages.clean_places(raw) == [{"page": 1, "rects": [[1.0, 2.0, 3.0, 4.0]]}]
    assert passages.clean_places("nope") == []


def test_a_highlight_reads_its_words_in_order_and_snaps_to_their_lines(tmp_path):
    path = _paper(tmp_path)
    # A loose box over the first two lines.
    found = passages.passage_at(path, [{"page": 1, "rects": [[60, 85, 400, 118]]}])
    assert found["text"].startswith("Attention lets every position")
    assert found["text"].endswith("trains so quickly on")
    assert [place["page"] for place in found["places"]] == [1]
    rects = found["places"][0]["rects"]
    assert len(rects) == 2  # one per line
    assert all(rect[0] >= 71 and rect[1] > 85 for rect in rects)


def test_a_drag_reads_every_word_between_its_ends_in_reading_order(tmp_path):
    """v8.45.0: the drag's two ends are trusted, not the browser's rectangles
    between them, so a passage across a page (or a column) reads whole."""
    path = _paper(tmp_path)
    words = list(passages._words(path))
    lets = next(word for word in words if word.text == "lets")
    second = next(word for word in words if word.text == "second")
    found = passages.passage_between(
        path,
        {"page": 1, "left": lets.x0, "top": (lets.y0 + lets.y1) / 2},
        # Just past the word's end, as a caret after its last letter sits.
        {"page": 2, "left": second.x1 + 1, "top": (second.y0 + second.y1) / 2},
    )
    assert found["text"].startswith("lets every position")
    assert "without any recurrent connections. An efficient method stands apart. The second" in found["text"]
    assert found["text"].endswith("The second")
    assert [place["page"] for place in found["places"]] == [1, 2]
    assert len(found["places"][0]["rects"]) == 4  # three lines, and the one below


def test_a_drag_dragged_backwards_reads_the_same(tmp_path):
    path = _paper(tmp_path)
    start = {"page": 1, "left": 300.0, "top": 125.0}
    end = {"page": 1, "left": 73.0, "top": 96.0}
    assert passages.passage_between(path, start, end) == passages.passage_between(path, end, start)


def test_a_drag_on_a_page_with_no_words_reads_nothing(tmp_path):
    path = _paper(tmp_path)
    nowhere = {"page": 9, "left": 1.0, "top": 1.0}
    assert passages.passage_between(path, nowhere, nowhere) == {"text": "", "places": []}


def test_clean_span_checks_both_ends():
    good = {"start": {"page": 1, "left": 1, "top": 2}, "end": {"page": 2, "left": 3.5, "top": 4}}
    assert passages.clean_span(good) == ({"page": 1, "left": 1.0, "top": 2.0}, {"page": 2, "left": 3.5, "top": 4.0})
    assert passages.clean_span({"start": good["start"]}) is None
    assert passages.clean_span({**good, "end": {"page": 0, "left": 1, "top": 1}}) is None
    assert passages.clean_span({**good, "end": {"page": 1, "left": True, "top": 1}}) is None
    assert passages.clean_span("nope") is None


def test_a_passage_across_columns_is_pictured_a_column_at_a_time(tmp_path):
    path = _paper(tmp_path)
    left_and_right = [{"page": 1, "rects": [[72, 90, 280, 104], [320, 90, 540, 104], [72, 104, 280, 118]]}]
    assert passages._columns(left_and_right[0]["rects"]) == [
        [[72, 90, 280, 104], [72, 104, 280, 118]],
        [[320, 90, 540, 104]],
    ]
    assert len(passages.render_places(path, left_and_right)) == 2


def test_a_highlight_over_nothing_reads_nothing(tmp_path):
    path = _paper(tmp_path)
    assert passages.passage_at(path, [{"page": 1, "rects": [[300, 600, 400, 700]]}]) == {
        "text": "",
        "places": [],
    }


def test_quotes_are_found_across_lines_and_pages_or_not_at_all(tmp_path):
    path = _paper(tmp_path)
    whole, by_ends, elsewhere, missing, short = passages.find_quotes(
        path,
        [
            "which is why the model trains so quickly",
            # A slip in the middle: found by its first and last five words.
            "every position look at every other spot in one step, which is why the model",
            "The second page says hello",
            "nothing like this is anywhere in the paper",
            "in",
        ],
    )
    assert [place["page"] for place in whole] == [1] and len(whole[0]["rects"]) == 1
    assert len(by_ends[0]["rects"]) == 2
    assert elsewhere[0]["page"] == 2
    assert missing == [] and short == []


def test_a_quote_found_by_its_ends_keeps_to_the_band_between_them(tmp_path):
    """Words the PDF wrote between a quote's ends but set elsewhere on the
    page (an equation's glyphs, say) aren't lit."""
    path = _paper(tmp_path)
    words = list(passages._words(path))
    head = next(word for word in words if word.text == "Attention")
    tail = next(word for word in words if word.text == "quickly")
    stray = next(word for word in words if word.text == "efficient")
    kept = passages._between([head, stray, tail], head, tail)
    assert kept == [head, tail]


def test_places_are_pictured_one_png_per_page(tmp_path):
    path = _paper(tmp_path)
    images = passages.render_places(
        path,
        [
            {"page": 1, "rects": [[72, 90, 300, 104]]},
            {"page": 2, "rects": [[72, 90, 300, 104]]},
            {"page": 9, "rects": [[72, 90, 300, 104]]},
        ],
    )
    assert len(images) == 2
    assert all(image.startswith(b"\x89PNG") for image in images)


def _two_columns(tmp_path):
    """A two-column page: an equation numbered (3) in the left column, prose
    in the right at its height, and prose that cites "(3)" mid-line."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Justified lines, as a paper's are, run to the column's edge (~290).
    page.insert_text((60, 100), "The left column opens with words, set justified out", fontsize=10)
    page.insert_text((100, 140), "x = y + z", fontsize=10)
    page.insert_text((270, 140), "(3)", fontsize=10)
    page.insert_text((320, 140), "The right column runs beside it here.", fontsize=10)
    page.insert_text((60, 180), "As (3) shows the left column goes on, to its edge", fontsize=10)
    page.insert_text((60, 400), "Figure 2. A plot of the results.", fontsize=10)
    path = tmp_path / "columns.pdf"
    doc.save(path)
    doc.close()
    return path


FLOATS = [{"kind": "figure", "page": 1, "caption": "Figure 2. A plot of the results.", "region": [60, 300, 300, 390]}]


def test_a_float_label_reads_as_the_text_view_writes_it():
    assert passages.float_label("Figure 1. Training curves") == "Figure 1"
    assert passages.float_label("Fig. 3: Results") == "Figure 3"
    assert passages.float_label("TABLE 2 Parameters") == "Table 2"
    assert passages.float_label("Algorithm 1 Soft Actor-Critic") == "Algorithm 1"
    assert passages.float_label("A caption with no label") is None


def test_labels_are_found_as_places_a_float_by_its_region_an_equation_by_its_line(tmp_path):
    path = _two_columns(tmp_path)
    figure, equation, missing = passages.label_places(path, FLOATS, ["Figure 2", "(3)", "(4)"])
    assert figure == [{"page": 1, "rects": [[60.0, 300.0, 300.0, 390.0]]}]
    # The equation's line in its own column: the right column's words at the
    # same height aren't taken, and the "(3)" cited mid-line isn't the one.
    [place] = equation
    assert place["page"] == 1
    left, top, right, bottom = place["rects"][0]
    assert 99 <= left <= 101 and right < 300 and top < 140 < bottom + 3
    assert missing == []


def test_a_place_is_told_the_labels_it_covers(tmp_path):
    path = _two_columns(tmp_path)
    # A box over the equation's body reaches its number, beside it.
    assert passages.labels_in(path, FLOATS, [{"page": 1, "rects": [[95, 128, 160, 145]]}]) == ["(3)"]
    # One over part of the figure.
    assert passages.labels_in(path, FLOATS, [{"page": 1, "rects": [[100, 320, 150, 340]]}]) == ["Figure 2"]
    # The prose citing "(3)" isn't an equation.
    assert passages.labels_in(path, FLOATS, [{"page": 1, "rects": [[55, 168, 300, 184]]}]) == []


def _sectioned(tmp_path):
    """Three pages: "1 Introduction" and "1.1 Setting" on page 1, "2 Method"
    running onto page 2 with a figure in it and a running header on each
    page, then "3 Conclusion" on page 3."""
    doc = fitz.open()
    for number in range(3):
        page = doc.new_page(width=612, height=792)
        page.insert_text((250, 40), "A Running Header", fontsize=9)
        if number == 0:
            page.insert_text((72, 100), "1 Introduction", fontsize=12)
            page.insert_text((72, 120), "The opening words of the paper.", fontsize=10)
            page.insert_text((72, 160), "1.1 Setting", fontsize=11)
            page.insert_text((72, 180), "Where it all happens.", fontsize=10)
            page.insert_text((72, 400), "2 Method", fontsize=12)
            page.insert_text((72, 420), "The method begins here.", fontsize=10)
        if number == 1:
            page.insert_text((72, 100), "The method goes on here.", fontsize=10)
            page.insert_text((100, 300), "axis 4000", fontsize=8)
        if number == 2:
            page.insert_text((72, 100), "3 Conclusion", fontsize=12)
            page.insert_text((72, 120), "It all comes together.", fontsize=10)
    path = tmp_path / "sectioned.pdf"
    doc.save(path)
    doc.close()
    return path


CONTENTS = [
    {"title": "1 Introduction", "level": 1, "page": 1, "top": 91},
    {"title": "1.1 Setting", "level": 2, "page": 1, "top": 152},
    {"title": "2 Method", "level": 1, "page": 1, "top": 391},
    {"title": "3 Conclusion", "level": 1, "page": 3, "top": 91},
]
FIGURE = [{"kind": "figure", "page": 2, "caption": "Figure 1. A plot.", "region": [90, 280, 300, 320]}]


def _lines(path, places):
    words = list(passages._words(path))
    return [
        " ".join(word.text for word in words if word.page == place["page"] and passages._inside(word, [rect]))
        for place in places
        for rect in place["rects"]
    ]


def test_a_section_is_found_by_number_or_title_with_its_subsections(tmp_path):
    path = _sectioned(tmp_path)
    by_number, by_title, missing = passages.label_places(path, [], ["§1", "§Conclusion", "§9 Nope"], CONTENTS)
    lines = _lines(path, by_number)
    assert lines[0] == "1 Introduction" and "Where it all happens." in lines
    assert "2 Method" not in lines  # it ends at the next heading at its level
    assert _lines(path, by_title) == ["3 Conclusion", "It all comes together."]
    assert missing == []


def test_a_section_across_pages_leaves_out_figures_and_running_headers(tmp_path):
    path = _sectioned(tmp_path)
    [method] = passages.label_places(path, FIGURE, ["§2 Method"], CONTENTS)
    lines = _lines(path, method)
    assert lines == ["2 Method", "The method begins here.", "The method goes on here."]
