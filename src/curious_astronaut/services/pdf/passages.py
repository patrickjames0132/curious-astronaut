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

Nothing is stored: like a figure (``docs/pdf-mining.md``), all of it is
derived from the PDF on disk in milliseconds. The words are memoized in
process for the last few files, as one answer asks for them more than once.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import functools
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
