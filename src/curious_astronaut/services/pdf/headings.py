"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
A PDF's table of contents, for the Reader's PDF view (v8.40.0).

The PDF's own outline (its bookmarks) when it has one; many papers don't
(arXiv's Adam and SAC PDFs have none, Attention's has 22 entries), so
otherwise the section headings found in its text. A heading is a short line
set larger or bolder than the body text that is either numbered ("3",
"3.2", "A", "B.1") or one of the standard unnumbered ones (Abstract,
References, ...).

Two quirks of how LaTeX PDFs come out, both seen in arXiv papers:

- **The number and the title can be separate lines** on one baseline
  (Attention and Adam set ``1`` and ``Introduction`` apart; SAC sets them as
  one). Lines are joined by baseline before matching.
- **Words can arrive without spaces** (Adam's small caps come as spans
  like ``I`` ``NITIALIZATION`` ``B`` ``IAS``, the gap only in the geometry):
  spans are joined with a space where their gap is wider than a fifth of the
  font size.
- **A long heading wraps** (SAC's "4 From Soft Policy Iteration to Soft" /
  "Actor-Critic"): a numbered heading takes the next line in its block when
  that line is set the same way and isn't a heading itself.

Headings in ALL CAPS (ICLR's style) are shown in sentence case, so the
contents don't shout.

Every entry carries ``top``, how far down its page the heading sits (PDF
points from the page's top edge), when that's known: papers often start two
sections on one page, and the contents need it to jump to the right one and
to tell which is being read. An outline entry's destination says where it
points, in the page's own bottom-up coordinates for a named destination (as
LaTeX's hyperref writes them) and top-down for a direct one, as PyMuPDF
reads them back.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from ... import optional

log = logging.getLogger(__name__)

#: A numbered heading: "3", "3.2", "3.2.1", or an appendix's "A", "B.1".
_NUMBERED = re.compile(
    r"^(?P<number>\d{1,2}(?:\.\d{1,2}){0,2}|[A-H](?:\.\d{1,2}){0,2})\.?\s+(?P<title>[A-Z].{1,90})$"
)
#: Unnumbered headings worth listing.
_NAMED = {
    "abstract",
    "introduction",
    "related work",
    "background",
    "conclusion",
    "conclusions",
    "discussion",
    "acknowledgements",
    "acknowledgments",
    "references",
    "bibliography",
    "appendix",
    "appendices",
}
#: A heading is at least this much larger than the body text, or bold.
_SIZE_MARGIN = 0.6
#: Lines within this many points vertically share a baseline.
_BASELINE_SLACK = 2.0
#: Levels kept: sections, subsections, subsubsections.
_MAX_LEVEL = 3
#: More than this many headings means the heuristic misread the paper.
_MAX_HEADINGS = 80


@dataclass
class _Line:
    """One visual line: its page, text, position, size and weight."""

    page: int
    block: int
    text: str
    left: float
    top: float
    size: float
    bold: bool


def _is_bold(span: dict) -> bool:
    """Whether a text span is set in bold.

    Args:
        span: A PyMuPDF text span.

    Returns:
        True for the bold flag or a bold-looking font name.
    """
    font = str(span.get("font", "")).lower()
    return bool(int(span.get("flags", 0)) & 16) or "bold" in font or font.endswith("-medi")


def _span_text(spans: list[dict]) -> str:
    """A line's spans as text, with a space wherever the gap between two is
    wide enough to be one (small caps arrive without them).

    Args:
        spans: The line's non-blank PyMuPDF spans, in order.

    Returns:
        The text, whitespace collapsed.
    """
    parts = [spans[0]["text"]]
    for previous, span in zip(spans, spans[1:]):
        gap = span["bbox"][0] - previous["bbox"][2]
        if gap > span["size"] * 0.2 and not parts[-1].endswith(" ") and not span["text"].startswith(" "):
            parts.append(" ")
        parts.append(span["text"])
    return " ".join("".join(parts).split())


def _lines(doc: object) -> tuple[list[_Line], float]:
    """Every visual line in a document, joined by baseline, and the body size.

    Args:
        doc: An open PyMuPDF document.

    Returns:
        The lines in reading order, and the most common span size (the body
        text's), weighted by characters.
    """
    sizes: Counter[float] = Counter()
    lines: list[_Line] = []
    for index in range(doc.page_count):  # type: ignore[attr-defined]
        page = doc.load_page(index)  # type: ignore[attr-defined]
        for number, block in enumerate(page.get_text("dict")["blocks"]):
            for raw in block.get("lines", []):
                spans = [span for span in raw["spans"] if span["text"].strip()]
                if not spans:
                    continue
                for span in spans:
                    sizes[round(span["size"], 1)] += len(span["text"])
                text = _span_text(spans)
                line = _Line(
                    page=index + 1,
                    block=number,
                    text=text,
                    left=raw["bbox"][0],
                    top=raw["bbox"][1],
                    size=max(span["size"] for span in spans),
                    bold=all(_is_bold(span) for span in spans),
                )
                previous = lines[-1] if lines else None
                # A number set apart from its title, on the same baseline.
                if (
                    previous
                    and previous.page == line.page
                    and abs(previous.top - line.top) <= _BASELINE_SLACK
                    and line.left > previous.left
                ):
                    previous.text = f"{previous.text} {line.text}"
                    previous.size = max(previous.size, line.size)
                    previous.bold = previous.bold and line.bold
                    continue
                lines.append(line)
    body = sizes.most_common(1)[0][0] if sizes else 10.0
    return lines, body


def _sentence_case(title: str) -> str:
    """An ALL-CAPS title in sentence case; any other title as it is.

    Args:
        title: The heading's title.

    Returns:
        The title, e.g. "INTRODUCTION" → "Introduction".
    """
    letters = [char for char in title if char.isalpha()]
    if letters and all(char.isupper() for char in letters) and len(letters) > 3:
        return title[:1].upper() + title[1:].lower()
    return title


def find_headings(path: str | Path) -> list[dict]:
    """A PDF's section headings, found in its text.

    Args:
        path: Filesystem path to the PDF.

    Returns:
        ``[{title, level, page, top}]`` in order (``page`` 1-based, ``top`` in
        points from the page's top edge); empty when
        none are found, when the heuristic finds implausibly many, or when
        the file can't be read.
    """
    fitz = optional.require("fitz", "pdf")
    try:
        doc = fitz.open(path)
    except Exception:
        log.warning("pymupdf couldn't open %s", path, exc_info=True)
        return []
    try:
        lines, body = _lines(doc)
    except Exception:
        log.warning("heading search failed for %s", path, exc_info=True)
        return []
    finally:
        doc.close()
    found: list[dict] = []
    for position, line in enumerate(lines):
        prominent = line.size >= body + _SIZE_MARGIN or line.bold
        if not prominent or len(line.text) > 100:
            continue
        match = _NUMBERED.match(line.text)
        if match:
            title = match.group("title")
            following = lines[position + 1] if position + 1 < len(lines) else None
            if (
                following
                and following.page == line.page
                and following.block == line.block
                and following.bold == line.bold
                and abs(following.size - line.size) < 0.3
                and not _NUMBERED.match(following.text)
                and following.top - line.top < line.size * 1.8
            ):
                title = f"{title} {following.text}"
            level = match.group("number").count(".") + 1
            if level <= _MAX_LEVEL:
                found.append(
                    {
                        "title": f"{match.group('number')} {_sentence_case(title)}",
                        "level": level,
                        "page": line.page,
                        "top": round(line.top, 1),
                    }
                )
        elif line.text.lower().rstrip(":.") in _NAMED:
            found.append(
                {
                    "title": _sentence_case(line.text.rstrip(":.")),
                    "level": 1,
                    "page": line.page,
                    "top": round(line.top, 1),
                }
            )
    return found if len(found) <= _MAX_HEADINGS else []


def _outline_top(doc: object, page: int, dest: dict) -> float | None:
    """How far down its page an outline entry points.

    Args:
        doc: The open PyMuPDF document.
        page: The entry's 1-based page.
        dest: The entry's destination, from ``get_toc(simple=False)``.

    Returns:
        Points from the page's top edge, or None when the destination doesn't
        say (or says something off the page).
    """
    fitz = optional.require("fitz", "pdf")
    point = dest.get("to")
    if point is None or dest.get("kind") not in (fitz.LINK_GOTO, fitz.LINK_NAMED):
        return None
    height = doc.load_page(page - 1).rect.height  # type: ignore[attr-defined]
    top = height - point.y if dest["kind"] == fitz.LINK_NAMED else point.y
    return round(top, 1) if 0 <= top < height else None


def find_contents(path: str | Path) -> dict:
    """A PDF's table of contents: its own outline, else its headings.

    Args:
        path: Filesystem path to the PDF.

    Returns:
        ``{"source": "outline" | "headings" | "none", "entries": [{title,
        level, page, top?}]}``; ``top`` is left out of an outline entry whose
        destination doesn't give it.
    """
    fitz = optional.require("fitz", "pdf")
    entries: list[dict] = []
    try:
        doc = fitz.open(path)
        try:
            for level, title, page, *rest in doc.get_toc(simple=False):
                if int(level) > _MAX_LEVEL or not str(title).strip() or not 1 <= int(page) <= doc.page_count:
                    continue
                entry: dict = {"title": str(title).strip(), "level": int(level), "page": int(page)}
                top = _outline_top(doc, int(page), rest[0]) if rest and isinstance(rest[0], dict) else None
                if top is not None:
                    entry["top"] = top
                entries.append(entry)
        finally:
            doc.close()
    except Exception:
        log.warning("pymupdf couldn't read the outline of %s", path, exc_info=True)
        entries = []
    if entries:
        return {"source": "outline", "entries": entries}
    headings = find_headings(path)
    return {"source": "headings" if headings else "none", "entries": headings}
