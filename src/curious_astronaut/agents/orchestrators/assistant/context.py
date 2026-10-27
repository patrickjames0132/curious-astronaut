"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
What each view lends the assistant: its prompt blocks, built and bounded here.

The client names what is on screen; this module turns that into the text the
model reads — the paper open in the Reader (from its structured document or
its PDF), a passage highlighted in the PDF pictured, a Knowledge Graph course
laid out, the other chats' summaries — and bounds every block, so no one view
can crowd the question out. Moved here from ``routes/agents.py`` when the
four assistants' routes became one (``main.run``); the blocks themselves are
unchanged.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging

from .... import optional
from ....config import config
from ....integrations import arxiv
from ....integrations.arxiv import document as arxiv_document
from ....services import pdf as pdf_service
from ....services.graph import Provider
from ....services.pdf import passages as pdf_passages
from ....services.reader import figures as reader_figures

log = logging.getLogger(__name__)


def concept_names(raw: object) -> list[str]:
    """A request's list of concept names, checked and capped.

    Args:
        raw: The field.

    Returns:
        Up to 60 of its strings, each cut to 120 characters.
    """
    if not isinstance(raw, list):
        return []
    return [item.strip()[:120] for item in raw[:60] if isinstance(item, str) and item.strip()]


#: The most course items laid out for a prompt; a course is a few dozen.
COURSE_ITEMS = 200
#: The open lesson is shown whole up to this many characters…
OPEN_LESSON_CHARS = 12000
#: …and every other written lesson up to this many, its opening.
LESSON_EXCERPT_CHARS = 1200
#: The whole course block's ceiling, lessons included.
COURSE_CHARS = 40000
#: The section being read is shown whole up to this many characters…
OPEN_SECTION_CHARS = 20000
#: …and the reading block, the whole paper in order after it, stops here. Most
#: papers fit whole: "Attention Is All You Need" is about 30,000.
READING_CHARS = 60000


#: Where the Reader is in a PDF: ``page:<n>`` (1-based), in place of a section id.
PAGE_PREFIX = "page:"


def reading_context(
    paper: object, section: object, provider: Provider, title: object = None
) -> tuple[str, str]:
    """Lay the paper open in the Reader out for the researcher's prompt.

    Built here rather than sent by the client, which only names the paper and
    where it is: the server already holds the text (the Reader fetched it to
    show it), and a page of paper is too much to post with every question.
    Two sources (v8.40.0): the structured document (v8.38.0) when the Reader
    shows the text, and the PDF's text page by page when it shows the PDF,
    or when the paper has no HTML render at all.

    Args:
        paper: The paper's arXiv id, or its provider node id for a paper not
            on arXiv.
        section: Where the reader is: a section id, ``page:<n>`` in the PDF
            view, or None.
        provider: Who to ask for a non-arXiv paper's open-access PDF.
        title: The paper's title, for a PDF (which carries no reliable one).

    Returns:
        ``(block, error)``: the reading block, or '' with what to tell the
        reader when there is nothing to read from.
    """
    if not isinstance(paper, str) or not paper.strip():
        return "", "This paper has no text the assistant can read."
    in_pdf = isinstance(section, str) and section.startswith(PAGE_PREFIX)
    if not in_pdf:
        block = _document_context(paper, section)
        if block:
            return block, ""
    return _pdf_context(paper, section if in_pdf else None, provider, title)


def _pdf_context(paper: str, section: object, provider: Provider, title: object) -> tuple[str, str]:
    """The paper laid out from its PDF's text, page by page (v8.40.0).

    Args:
        paper: The paper's arXiv id or provider node id.
        section: ``page:<n>`` for the page in view, or None.
        provider: Who to ask for a non-arXiv paper's open-access PDF.
        title: The paper's title, as the client knows it.

    Returns:
        ``(block, error)`` as for ``reading_context``.
    """
    ref = arxiv.extract_id(paper) or paper.strip()
    url = pdf_service.paper_pdf_url(ref, provider)
    if not url:
        return "", "This paper has no text the assistant can read."
    if not optional.available("pdf"):
        return "", (
            "Reading a PDF needs the pdf extra, which this install doesn't have: "
            "uv sync --extra pdf"
        )
    pages = pdf_service.get_pdf_pages(url).get("pages") or []
    if not any(pages):
        return "", "This paper's PDF has no text the assistant can read (it may be scanned)."
    opened = 0
    if isinstance(section, str):
        digits = section[len(PAGE_PREFIX):]
        opened = int(digits) if digits.isdigit() and 1 <= int(digits) <= len(pages) else 0
    name = _clip(title, 300) or "the paper"
    block = f"THE PAPER BEING READ: {name!r}, as its PDF ({len(pages)} pages).\n"
    if opened:
        block += f"\nTHE PAGE THEY ARE READING: page {opened}\n\n{pages[opened - 1][:OPEN_SECTION_CHARS]}\n"
    block += "\nTHE PAPER'S TEXT, page by page:\n"
    for number, page in enumerate(pages, start=1):
        if number == opened:
            block += f"\n--- page {number} ---\n(shown above)\n"
            continue
        text = f"\n--- page {number} ---\n{page}\n"
        if len(block) + len(text) > READING_CHARS:
            block += "\n(The rest of the paper is cut for length.)"
            break
        block += text
    return block[:READING_CHARS], ""


def highlight_context(paper: object, provider: Provider, raw: object) -> tuple[str, list[bytes]]:
    """A passage highlighted in the Reader's PDF view, read and pictured (v8.45.0).

    The browser reads a PDF highlight out of order, and an equation's glyphs
    spell nothing, so the Reader sends where the highlight is and the
    question carries the PDF's own words there and a picture of it
    (``services/pdf/passages.py``).

    Args:
        paper: The paper's arXiv id or provider node id.
        provider: Who to ask for a non-arXiv paper's open-access PDF.
        raw: The request's ``places``.

    Returns:
        ``(block, images)``: a prompt block saying what was highlighted and
        that it's pictured, and the PNGs; ``("", [])`` without places, or
        when the PDF can't be read (the question still quotes the passage).
    """
    places = pdf_passages.clean_places(raw)
    if not places or not isinstance(paper, str) or not optional.available("pdf"):
        return "", []
    url = pdf_service.paper_pdf_url(arxiv.extract_id(paper) or paper.strip(), provider)
    if not url:
        return "", []
    try:
        path = pdf_service.fetch_pdf(url)
        words = pdf_passages.passage_at(path, places)["text"]
        images = pdf_passages.render_places(path, places)
    except pdf_service.PdfError:
        log.warning("highlight context failed for %s", paper, exc_info=True)
        return "", []
    pages = ", ".join(str(place["page"]) for place in places)
    block = (
        f"\n\nTHE PASSAGE THEY HIGHLIGHTED, on page {pages} of the PDF, is pictured in the "
        f"image{'s' if len(images) > 1 else ''} sent with their question. Read it from the "
        "picture: a PDF's text spells an equation as loose glyphs. Its words, as the PDF "
        f"holds them: {words or '(none: it is a figure or an equation)'}"
    )
    return (block, images) if images else ("", [])


def _document_context(paper: str, section: object) -> str:
    """The paper laid out from its structured document (v8.38.0).

    Args:
        paper: The paper's arXiv id, as the Reader asked for its document.
        section: The id of the section being read, or None.

    Returns:
        The reading block — title, abstract, outline, the section being read
        whole, then the rest of the paper in order under ``READING_CHARS`` —
        or '' when the paper has no readable document.
    """
    if not arxiv.looks_arxiv(arxiv.extract_id(paper) or paper):
        return ""
    try:
        doc = arxiv.get_document(arxiv.extract_id(paper) or paper)
    except Exception:  # ar5iv down: nothing to read from, as with no render
        log.warning("reading context fetch failed for %s", paper, exc_info=True)
        return ""
    if not doc.get("available"):
        return ""
    sections = doc.get("sections", [])
    title = arxiv_document.inline_text(doc.get("title", []))
    block = f"THE PAPER BEING READ: {title!r}\n"
    abstract = "\n\n".join(arxiv_document.block_text(item) for item in doc.get("abstract", []))
    if abstract:
        block += f"\nAbstract: {abstract}\n"
    outline = [
        "  " * (item["level"] - 1) + arxiv_document.section_heading(item)
        for item in sections
        if item.get("level", 4) <= 3 and item.get("title")
    ]
    if outline:
        block += "\nOutline:\n" + "\n".join(outline) + "\n"
    opened = next((item for item in sections if item.get("id") == section), None)
    if opened is not None:
        block += (
            f"\nTHE SECTION THEY ARE READING: {arxiv_document.section_heading(opened)}\n\n"
            + arxiv_document.section_text(opened)[:OPEN_SECTION_CHARS]
            + "\n"
        )
    block += "\nTHE PAPER'S TEXT, in order:\n"
    for item in sections:
        if opened is not None and item is opened:
            block += f"\n## {arxiv_document.section_heading(item)}\n(shown above)\n"
            continue
        text = "\n" + arxiv_document.section_text(item) + "\n"
        if len(block) + len(text) > READING_CHARS:
            block += "\n(The rest of the paper is cut for length.)"
            break
        block += text
    return block[:READING_CHARS]


def _clip(value: object, limit: int) -> str:
    """A string field from the client, or '' when it is not one, cut to a limit.

    Args:
        value: The raw field.
        limit: The most characters kept.

    Returns:
        The string, at most ``limit`` characters.
    """
    return value[:limit] if isinstance(value, str) else ""


def _course_line(item: dict) -> str:
    """One course item as an outline line: its kind, check-off and links.

    Args:
        item: ``{title, kind, known?, needs?: [{title, why}], members?:
            [titles], toward?}`` from the client.

    Returns:
        The line, with an indented line per prerequisite.
    """
    kind = _clip(item.get("kind"), 20) or "concept"
    line = f"- {_clip(item.get('title'), 200)} ({kind})"
    if item.get("known") is True:
        line += " [checked off as known]"
    members = [_clip(member, 200) for member in item.get("members") or []][:12]
    if members:
        line += f": combines {', '.join(members)} toward {_clip(item.get('toward'), 200)}"
    for need in (item.get("needs") or [])[:20]:
        if isinstance(need, dict):
            line += f"\n    needs {_clip(need.get('title'), 200)}: {_clip(need.get('why'), 300)}"
    return line


def course_context(raw: object, lessons: bool = True) -> str:
    """Lay a Knowledge Graph course out for the researcher's prompt (v8.25.0).

    The client sends the course as structure; the bounds are kept here, as
    for sibling threads, so a large course cannot crowd out the question.

    Args:
        raw: ``{paper, open?, items: [{title, kind, known?, needs?,
            members?, toward?, lesson?}]}``.
        lessons: Include the lessons; False gives the outline alone (a
            course attached from another chat).

    Returns:
        The course block, or '' when ``raw`` is not a course.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("items"), list):
        return ""
    items = [item for item in raw["items"][:COURSE_ITEMS] if isinstance(item, dict)]
    block = f"THE COURSE, on the paper {_clip(raw.get('paper'), 300)!r}:\n"
    block += "\n".join(_course_line(item) for item in items)
    if not lessons:
        return block[:COURSE_CHARS]
    opened = _clip(raw.get("open"), 200)
    for item in items:
        if opened and item.get("title") == opened:
            text = _clip(item.get("lesson"), OPEN_LESSON_CHARS)
            block += f"\n\nTHE LESSON THE STUDENT HAS OPEN: {opened}\n"
            block += text or "(not written yet)"
    written = [
        item
        for item in items
        if item.get("title") != opened and isinstance(item.get("lesson"), str) and item["lesson"]
    ]
    if written:
        block += "\n\nOTHER LESSONS WRITTEN SO FAR (their openings):"
        for item in written:
            block += f"\n\n## {_clip(item.get('title'), 200)}\n"
            block += _clip(item.get("lesson"), LESSON_EXCERPT_CHARS)
    return block[:COURSE_CHARS]


def sibling_context(payload: dict) -> str:
    """Bound explicitly labelled background material from sibling threads.

    Args:
        payload: Request containing an index and optionally mentioned histories.

    Returns:
        A bounded context string; empty when no siblings were supplied.
    """
    raw = payload.get("thread_context")
    if not isinstance(raw, list):
        return ""
    sections: list[str] = []
    remaining = 24000
    for item in raw[:max(0, config.server.history_turns * 2)]:
        if not isinstance(item, dict) or not isinstance(item.get("title"), str):
            continue
        summary = item.get("summary", "")
        summary = summary[:1500] if isinstance(summary, str) else ""
        section = f"From sibling thread {item['title'][:200]!r}:\n{summary}"
        # A Knowledge Graph chat brings its course's outline along (v8.25.0):
        # its turns are about a course, and read poorly without it.
        course = course_context(item.get("course"), lessons=False)
        if item.get("mentioned") is True and course:
            section += "\nIts course:\n" + course
        if item.get("mentioned") is True:
            turns = resumed_history(item)
            section += "\nExplicitly attached discussion:\n" + "\n".join(
                f"{turn['role']}: {turn['content']}" for turn in turns
            )
        sections.append(section[:remaining])
        remaining -= len(sections[-1])
        if remaining <= 0:
            break
    return "\n\n".join(sections)


def resumed_history(payload: dict) -> list[dict]:
    """Validate and cap the completed history supplied by the client.

    Args:
        payload: Request body containing optional role/content turns.

    Returns:
        Valid turns within the configured history window.
    """
    raw = payload.get("history")
    if not isinstance(raw, list):
        return []
    clean = [
        {"role": turn["role"], "content": turn["content"]}
        for turn in raw
        if isinstance(turn, dict)
        and turn.get("role") in {"user", "assistant"}
        and isinstance(turn.get("content"), str)
        and turn["content"].strip()
    ]
    keep = config.server.history_turns * 2
    return clean[-keep:] if keep else []


def boxed_figures(raw: object) -> tuple[str, list[bytes]]:
    """Figures boxed in the Reader's text view, pictured for the model (v8.48.0).

    The question's own words quote a boxed figure's caption, which can't show
    the figure itself, so its image goes with the question.

    Args:
        raw: The request's ``figures``: the boxed figures' image sources.

    Returns:
        ``(block, images)``: a prompt block saying the figures are pictured,
        and their PNGs; ``("", [])`` when nothing was boxed.
    """
    figures = reader_figures.figure_pngs(raw)
    if not figures:
        return "", []
    plural = len(figures) > 1
    block = (
        f"\n\nTHE FIGURE{'S' if plural else ''} THEY BOXED in the paper's text "
        f"{'are' if plural else 'is'} pictured in the image"
        f"{'s' if plural else ''} sent with their question; the passage they "
        "quote gives the caption. Read the figure from the picture."
    )
    return block, figures
