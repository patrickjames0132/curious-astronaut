"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Passages of a PDF by where they sit on the page (v8.45.0, the Reader's
stage 6): what a highlight covers, where an answer's quotes are, and a
picture of either for the model.

Everything here speaks **places**: a page and the rectangles on it, in PDF
points from the page's top-left, the coordinates pdf.js draws the Reader's
pages in at scale 1, so the browser and this module point at the same spot.

Why places, not text: the browser reads a highlight out of pdf.js's text
layer, which is in the order the PDF was written, not read. A selection
across an equation sweeps in glyphs from elsewhere, and finding words again
in that layer lit the wrong spots (Patrick, 2026-10-25: "very noisy"). So the
Reader sends where the highlight is, and this module answers from pymupdf's
words, which come in reading order with their boxes:

* ``passage_between`` — a highlight as the reader dragged it: every word
  from the one where the drag began to the one where it ended, in reading
  order, so a passage across a column or a page reads (and lights) whole.
  The first build sent the selection's rectangles and kept those between
  the drag's two heights, which in two columns kept only the first and last
  lines (Patrick: "only highlighting bits and pieces").
* ``passage_at`` — the words inside rectangles, as text, and the
  rectangles snapped to those words, line by line.
* ``find_quotes`` — where an answer's ⟦quotes⟧ are, found by letters and
  digits only (case, punctuation and ligatures differ between the model's
  copy and the PDF), else by their first and last few words.
* ``render_places`` — a PNG of each page's part, attached to the question,
  so the model *sees* an equation the PDF's glyphs can't spell.
* ``labels_in`` / ``label_places`` — the labels both of the Reader's views
  share (v8.48.0): "Figure 1", "Table 2", "Algorithm 1", an equation's
  "(6)". A place is told which it covers, and a label is found as a place,
  a float by the mined manifest's region and an equation by its number's
  line, so a box or highlight from one view lights in the other: positions
  mean nothing across views, labels mean the same thing in both.

Nothing is stored: like a figure (``docs/pdf-mining.md``), all of it is
derived from the PDF on disk in milliseconds. The words are memoized in
process for the last few files, as one answer asks for them more than once.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import functools
import re
import unicodedata
from pathlib import Path
from typing import NamedTuple, TypedDict

from ... import optional
from ...config import config
from .errors import PdfError

MAX_PLACES = 8
"""Pages one highlight may cover: more is a request gone wrong."""
MAX_RECTS = 400
"""Rectangles on one page of a highlight (one per text span, at most)."""
MAX_IMAGES = 4
"""Pictures of a highlight sent to the model (one per page and column)."""
SLACK = 1.0
"""Points a word's center may sit outside a highlight's rectangle."""
PADDING = 6.0
"""Points of page around a highlight's picture."""
END_WORDS = 5
"""Words matched at each end of a quote not found whole."""
STRETCH = 1.5
"""How much longer than the quote a match by its ends may run."""

FLOAT_LABEL = re.compile(r"^\s*(figure|fig\.|table|algorithm)\s*(\d+)", re.IGNORECASE)
"""A float's caption, as it opens: "Figure 3.", "Fig. 3:", "Table 1"."""
EQUATION_NUMBER = re.compile(r"^\((\d+[a-z]?)\)[.,;]?$")
"""An equation's number, as a word of its own: "(6)"."""
WORD_GAP = 8.0
"""Points after a word the next on its line may start; a column's gutter is wider."""
NUMBER_REACH = 120.0
"""Points right of a place an equation's number may sit and still be its."""

LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}
"""Ligatures a PDF's text can carry, spelled out."""


class Place(TypedDict):
    """Where a passage is: a 1-based page and rectangles on it, in points."""

    page: int
    rects: list[list[float]]


class Point(TypedDict):
    """A spot on a page: a 1-based page and a point on it, in points from
    its left and top edges.
    """

    page: int
    left: float
    top: float


class Word(NamedTuple):
    """One word of a PDF, as pymupdf reads it, with where it is."""

    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str
    block: int
    line: int


def comparable(text: str) -> str:
    """Text reduced to what a comparison reads: lowercase letters and digits.

    Args:
        text: Any text.

    Returns:
        Its letters and digits, lowercased, ligatures spelled out.
    """
    kept = []
    for char in unicodedata.normalize("NFKD", text):
        for piece in LIGATURES.get(char, char.lower()):
            if piece.isalnum():
                kept.append(piece)
    return "".join(kept)


def clean_places(raw: object) -> list[Place]:
    """Places as the client sent them, checked: whatever isn't one is dropped.

    Args:
        raw: The request's ``places``: ``[{page, rects: [[x0, y0, x1, y1]]}]``.

    Returns:
        The well-formed places, capped (``MAX_PLACES``, ``MAX_RECTS``).
    """
    if not isinstance(raw, list):
        return []
    places: list[Place] = []
    for item in raw[:MAX_PLACES]:
        if not isinstance(item, dict):
            continue
        page = item.get("page")
        rects = item.get("rects")
        if not isinstance(page, int) or isinstance(page, bool) or page < 1:
            continue
        if not isinstance(rects, list):
            continue
        kept = [
            [float(value) for value in rect]
            for rect in rects[:MAX_RECTS]
            if isinstance(rect, list)
            and len(rect) == 4
            and all(isinstance(value, int | float) and not isinstance(value, bool) for value in rect)
            and rect[2] > rect[0]
            and rect[3] > rect[1]
        ]
        if kept:
            places.append({"page": page, "rects": kept})
    return places


def _point(raw: object) -> Point | None:
    """One end of a drag as the client sent it, checked.

    Args:
        raw: ``{page, left, top}``.

    Returns:
        The point, or None when it isn't one.
    """
    if not isinstance(raw, dict):
        return None
    page, left, top = raw.get("page"), raw.get("left"), raw.get("top")
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        return None
    if not isinstance(left, int | float) or isinstance(left, bool):
        return None
    if not isinstance(top, int | float) or isinstance(top, bool):
        return None
    return {"page": page, "left": float(left), "top": float(top)}


def clean_span(raw: object) -> tuple[Point, Point] | None:
    """Where a drag began and ended, as the client sent it, checked.

    Args:
        raw: The request's ``span``: ``{start: {page, left, top}, end: {...}}``.

    Returns:
        ``(start, end)``, or None when either isn't a point.
    """
    if not isinstance(raw, dict):
        return None
    start, end = _point(raw.get("start")), _point(raw.get("end"))
    return (start, end) if start and end else None


@functools.lru_cache(maxsize=4)
def _words_of(path: str, stamp: int) -> tuple[Word, ...]:
    """Every word of a PDF, in reading order (memoized by file and mtime).

    Args:
        path: Filesystem path to the PDF.
        stamp: Its modification time, so a re-download is read afresh.

    Returns:
        The words, page by page.

    Raises:
        PdfError: When pymupdf can't open the file.
    """
    del stamp  # only part of the cache key
    fitz = optional.require("fitz", "pdf")
    try:
        doc = fitz.open(path)
    except Exception as exc:
        raise PdfError(f"pymupdf couldn't open {path}") from exc
    try:
        return tuple(
            Word(index + 1, x0, y0, x1, y1, text, block, line)
            for index in range(doc.page_count)
            for x0, y0, x1, y1, text, block, line, _ in doc.load_page(index).get_text("words")
        )
    finally:
        doc.close()


def _words(path: str | Path) -> tuple[Word, ...]:
    """Every word of a PDF, in reading order.

    Args:
        path: Filesystem path to the PDF.

    Returns:
        The words, page by page.
    """
    file = Path(path)
    return _words_of(str(file), file.stat().st_mtime_ns)


def _places_of(words: list[Word]) -> list[Place]:
    """Words' rectangles, one per line they sit on, grouped by page.

    Args:
        words: Words, in reading order.

    Returns:
        A place per page they're on, in order, each line one rectangle.
    """
    lines: dict[tuple[int, int, int], list[float]] = {}
    for word in words:
        key = (word.page, word.block, word.line)
        box = lines.get(key)
        if box is None:
            lines[key] = [word.x0, word.y0, word.x1, word.y1]
        else:
            box[:] = [min(box[0], word.x0), min(box[1], word.y0), max(box[2], word.x1), max(box[3], word.y1)]
    places: list[Place] = []
    for (page, _, _), box in lines.items():
        if not places or places[-1]["page"] != page:
            places.append({"page": page, "rects": []})
        places[-1]["rects"].append([round(value, 2) for value in box])
    return places


def _inside(word: Word, rects: list[list[float]]) -> bool:
    """Whether a word's center sits in any of a page's rectangles.

    Args:
        word: The word.
        rects: The rectangles, in points.

    Returns:
        True when it does, give or take ``SLACK``.
    """
    middle_x = (word.x0 + word.x1) / 2
    middle_y = (word.y0 + word.y1) / 2
    return any(
        rect[0] - SLACK <= middle_x <= rect[2] + SLACK and rect[1] - SLACK <= middle_y <= rect[3] + SLACK
        for rect in rects
    )


def _joined(words: list[Word]) -> str:
    """Words read out as running text, a hyphen broken across lines rejoined.

    Args:
        words: Words, in reading order.

    Returns:
        The text.
    """
    text = ""
    previous: Word | None = None
    for word in words:
        same_line = previous is not None and (previous.page, previous.block, previous.line) == (
            word.page,
            word.block,
            word.line,
        )
        if previous is None:
            text = word.text
        elif not same_line and text.endswith("-") and text[-2:-1].isalpha():
            text = text[:-1] + word.text
        else:
            text += " " + word.text
        previous = word
    return text


def passage_at(path: str | Path, places: list[Place]) -> dict:
    """The passage a highlight covers: its words, and where exactly they are.

    Args:
        path: Filesystem path to the PDF.
        places: Where the highlight is (``clean_places``).

    Returns:
        ``{text, places}``: the words whose centers sit in the highlight, in
        reading order, and their lines' rectangles. Both empty when it
        covers no words (a picture, a blank margin).
    """
    wanted = {place["page"]: place["rects"] for place in places}
    words = [word for word in _words(path) if word.page in wanted and _inside(word, wanted[word.page])]
    return {"text": _joined(words), "places": _places_of(words)}


def _nearest(words: tuple[Word, ...], point: Point) -> int | None:
    """The word a point is on, or the closest to it on its page.

    Args:
        words: Every word of the PDF.
        point: The point.

    Returns:
        The word's index, or None when its page has no words.
    """
    best: tuple[float, int] | None = None
    for position, word in enumerate(words):
        if word.page != point["page"]:
            continue
        across = max(word.x0 - point["left"], 0.0, point["left"] - word.x1)
        down = max(word.y0 - point["top"], 0.0, point["top"] - word.y1)
        # A line apart counts for more than a word apart.
        distance = across + down * 4
        if best is None or distance < best[0]:
            best = (distance, position)
    return best[1] if best else None


def passage_between(path: str | Path, start: Point, end: Point) -> dict:
    """A highlight as the reader dragged it: the words from where the drag
    began to where it ended, in reading order.

    The caret's ends are trusted, not what lies between them on screen:
    pdf.js's text layer is in the order the PDF was written, so the
    browser's selection between them can sweep in glyphs set elsewhere, and
    its rectangles can't tell a column break from noise. The PDF's words in
    reading order can.

    Args:
        path: Filesystem path to the PDF.
        start: Where the drag began (its caret: the left edge of the first
            character).
        end: Where it ended (the right edge of the last).

    Returns:
        ``{text, places}`` as for ``passage_at``; both empty when a point's
        page has no words.
    """
    words = _words(path)
    # Nudged inward, so a caret on the gap between two words picks the one
    # it belongs to.
    first = _nearest(words, {**start, "left": start["left"] + 1})
    last = _nearest(words, {**end, "left": end["left"] - 1})
    if first is None or last is None:
        return {"text": "", "places": []}
    first, last = min(first, last), max(first, last)
    covered = list(words[first : last + 1])
    return {"text": _joined(covered), "places": _places_of(covered)}


def _columns(rects: list[list[float]]) -> list[list[list[float]]]:
    """A page's rectangles in groups that share a column (overlap across).

    Args:
        rects: The rectangles.

    Returns:
        The groups, left to right.
    """
    groups: list[list[list[float]]] = []
    for rect in sorted(rects, key=lambda item: item[0]):
        group = next(
            (group for group in groups if any(rect[0] < other[2] and other[0] < rect[2] for other in group)),
            None,
        )
        if group is None:
            groups.append([rect])
        else:
            group.append(rect)
    return groups


def float_label(caption: str) -> str | None:
    """The label a float's caption opens with, as the text view writes it.

    Args:
        caption: The caption ("Figure 1. Training curves…").

    Returns:
        "Figure 1", "Table 2", "Algorithm 1", or None for one without.
    """
    match = FLOAT_LABEL.match(caption)
    if not match:
        return None
    kind = match.group(1).lower()
    name = "Figure" if kind.startswith("fig") else kind.capitalize()
    return f"{name} {match.group(2)}"


def _number(word: Word) -> str | None:
    """An equation's number, if a word is one.

    Args:
        word: The word.

    Returns:
        "(6)", or None.
    """
    match = EQUATION_NUMBER.match(word.text)
    return f"({match.group(1)})" if match else None


def _overlaps(first: list[float], second: list[float]) -> bool:
    """Whether two rectangles share any area.

    Args:
        first: ``[x0, y0, x1, y1]``.
        second: The other.

    Returns:
        True when they overlap.
    """
    return first[0] < second[2] and second[0] < first[2] and first[1] < second[3] and second[1] < first[3]


def _equation_line(words: tuple[Word, ...], number: Word) -> list[float]:
    """The line an equation's number closes: its column's words beside it.

    The column is the span of the page's text lines that run past the
    number's left edge, so the other column's words on the same height
    aren't taken. A tall equation (a fraction) overlaps the band and is
    taken whole across it.

    Args:
        words: Every word of the PDF.
        number: The number's word.

    Returns:
        The rectangle around the equation's line and its number.
    """
    page = [word for word in words if word.page == number.page]
    lines: dict[tuple[int, int], list[float]] = {}
    for word in page:
        box = lines.setdefault((word.block, word.line), [word.x0, word.x1])
        box[0], box[1] = min(box[0], word.x0), max(box[1], word.x1)
    spans = [span for span in lines.values() if span[0] <= number.x0 and span[1] >= number.x0 - 5]
    left = min((span[0] for span in spans), default=number.x0)
    band = (number.y0 - 4, number.y1 + 4)
    taken = [
        word
        for word in page
        if word.y0 < band[1] and word.y1 > band[0] and word.x0 >= left - 2 and word.x1 <= number.x1
    ]
    return [
        round(min(word.x0 for word in taken), 2),
        round(min(word.y0 for word in taken), 2),
        round(max(word.x1 for word in taken), 2),
        round(max(word.y1 for word in taken), 2),
    ]


def _closes_its_line(words: tuple[Word, ...], number: Word) -> bool:
    """Whether a number word is the last on its line, as an equation's is.

    Args:
        words: Every word of the PDF.
        number: The word.

    Returns:
        True when no word follows it at its height within a word's gap
        (prose that says "see (6)" goes on past it); the other column's
        words, across the gutter, don't count.
    """
    middle = (number.y0 + number.y1) / 2
    return not any(
        word.page == number.page
        and number.x1 < word.x0 <= number.x1 + WORD_GAP
        and word.y0 < middle < word.y1
        for word in words
    )


def label_places(path: str | Path, floats: list[dict], labels: list[str]) -> list[list[Place]]:
    """Where each label is in a PDF: a float's region, an equation's line.

    Args:
        path: Filesystem path to the PDF.
        floats: The PDF's mined manifest (``get_pdf_floats``'s ``floats``).
        labels: The labels, as the text view writes them.

    Returns:
        For each label, in order, its places; empty for one not found.
    """
    words = _words(path)
    found: list[list[Place]] = []
    for label in labels:
        if label.startswith("("):
            numbers = [word for word in words if _number(word) == label]
            number = next((word for word in numbers if _closes_its_line(words, word)), None)
            found.append([{"page": number.page, "rects": [_equation_line(words, number)]}] if number else [])
            continue
        entry = next((item for item in floats if float_label(str(item.get("caption", ""))) == label), None)
        found.append(
            [{"page": int(entry["page"]), "rects": [[round(float(value), 2) for value in entry["region"]]]}]
            if entry
            else []
        )
    return found


def labels_in(path: str | Path, floats: list[dict], places: list[Place]) -> list[str]:
    """The labels a passage's places cover: the floats they overlap, and the
    equations whose numbers close a line they reach.

    Args:
        path: Filesystem path to the PDF.
        floats: The PDF's mined manifest.
        places: The places (a highlight's lines, or a box).

    Returns:
        The labels, in reading order, each once.
    """
    words = _words(path)
    labels: list[str] = []
    for place in places:
        for item in floats:
            label = float_label(str(item.get("caption", "")))
            if (
                label
                and label not in labels
                and int(item.get("page", 0)) == place["page"]
                and any(_overlaps(rect, [float(value) for value in item["region"]]) for rect in place["rects"])
            ):
                labels.append(label)
        for word in words:
            label = _number(word)
            if not label or label in labels or word.page != place["page"]:
                continue
            middle = (word.y0 + word.y1) / 2
            beside = any(
                rect[1] - SLACK <= middle <= rect[3] + SLACK and rect[0] - SLACK <= word.x0 <= rect[2] + NUMBER_REACH
                for rect in place["rects"]
            )
            if beside and _closes_its_line(words, word):
                labels.append(label)
    return labels


def _between(words: list[Word], head: Word, tail: Word) -> list[Word]:
    """Words that sit between two others on the page, top to bottom.

    A quote found by its ends spans whatever the PDF wrote between them,
    which can include an equation's glyphs set elsewhere on the page; only
    what lies in the band from the first line to the last stays.

    Args:
        words: The words from ``head`` to ``tail``, in reading order.
        head: The quote's first word.
        tail: Its last word.

    Returns:
        The words in the band.
    """
    def in_band(word: Word) -> bool:
        middle = (word.y0 + word.y1) / 2
        if head.page == tail.page:
            return word.page == head.page and head.y0 - SLACK <= middle <= tail.y1 + SLACK
        if word.page == head.page:
            return middle >= head.y0 - SLACK
        if word.page == tail.page:
            return middle <= tail.y1 + SLACK
        return head.page < word.page < tail.page

    return [word for word in words if in_band(word)]


def find_quotes(path: str | Path, quotes: list[str]) -> list[list[Place]]:
    """Where each of an answer's quotes is in a PDF.

    Args:
        path: Filesystem path to the PDF.
        quotes: The quotes, as the model wrote them.

    Returns:
        For each quote, in order, the places it covers; empty for one not
        found (too short, paraphrased, or a formula).
    """
    words = _words(path)
    text = ""
    owners: list[int] = []  # the word each kept character came from
    for position, word in enumerate(words):
        kept = comparable(word.text)
        text += kept
        owners.extend([position] * len(kept))
    found: list[list[Place]] = []
    for quote in quotes:
        wanted = comparable(quote)
        span: tuple[int, int] | None = None
        by_ends = False
        if len(wanted) >= 4 and (start := text.find(wanted)) >= 0:
            span = (start, start + len(wanted))
        elif len(wanted) >= 4:
            pieces = [piece for piece in quote.split() if comparable(piece)]
            if len(pieces) >= END_WORDS * 2:
                head = comparable(" ".join(pieces[:END_WORDS]))
                tail = comparable(" ".join(pieces[-END_WORDS:]))
                start = text.find(head)
                tail_at = text.find(tail, start + len(head)) if start >= 0 else -1
                if tail_at >= 0 and tail_at + len(tail) - start <= len(wanted) * STRETCH:
                    span = (start, tail_at + len(tail))
                    by_ends = True
        if span is None:
            found.append([])
            continue
        first, last = owners[span[0]], owners[span[1] - 1]
        covered = list(words[first : last + 1])
        if by_ends:
            covered = _between(covered, words[first], words[last])
        found.append(_places_of(covered))
    return found


def render_places(path: str | Path, places: list[Place]) -> list[bytes]:
    """A picture of each page's part of a passage, for the model to see.

    Args:
        path: Filesystem path to the PDF.
        places: Where the passage is.

    Returns:
        One PNG per page and column (at most ``MAX_IMAGES``), each the box
        around that column's rectangles with ``PADDING`` of page around it,
        rendered at ``config.pdf.render_dpi``. By column, so a passage
        across a column break isn't pictured as the whole page between.

    Raises:
        PdfError: When pymupdf can't open the file or render a page.
    """
    fitz = optional.require("fitz", "pdf")
    try:
        doc = fitz.open(path)
    except Exception as exc:
        raise PdfError(f"pymupdf couldn't open {path}") from exc
    images: list[bytes] = []
    try:
        for place in places:
            if not 1 <= place["page"] <= doc.page_count or not place["rects"]:
                continue
            page = doc.load_page(place["page"] - 1)
            for rects in _columns(place["rects"]):
                if len(images) >= MAX_IMAGES:
                    break
                box = fitz.Rect(
                    min(rect[0] for rect in rects) - PADDING,
                    min(rect[1] for rect in rects) - PADDING,
                    max(rect[2] for rect in rects) + PADDING,
                    max(rect[3] for rect in rects) + PADDING,
                )
                clip = box & page.rect
                if not clip.is_empty:
                    images.append(page.get_pixmap(clip=clip, dpi=config.pdf.render_dpi).tobytes("png"))
    except Exception as exc:
        raise PdfError(f"rendering a passage of {path} failed") from exc
    finally:
        doc.close()
    return images
