"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The paper's sections as a placer reads them: the model calls that put
margin notes in the Reader (the Knowledge Graph notes, v8.44.0, and the
criticism notes, v8.54.0) read the same sections the Reader shows, by the
same ids, so a note lands where it was placed.

* **The text** (``text_sections``): the arXiv render's sections down to
  :data:`DEPTH`, each with the text of the deeper ones under it folded in.
* **The PDF** (``pdf_sections``), for a paper the Reader can only show as a
  PDF: its table of contents, each entry with the text of the pages it spans.

Moved here from ``routes/knowledge.py`` when the criticism notes needed them
too.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from typing import Any, Literal

from ... import optional
from ...agents.orchestrators.tutor import PaperSection
from ...integrations import arxiv
from ...integrations.arxiv import document as arxiv_document
from .. import pdf as pdf_service
from ..graph import Provider

#: Sections placed in: down to subsubsections, as deep as the contents list.
DEPTH = 3
#: The most pages one PDF contents entry reads (an appendix can run long).
PDF_PAGES = 3


def text_sections(doc: dict[str, Any]) -> list[PaperSection]:
    """The paper's sections as the placer reads them.

    Sections down to :data:`DEPTH`, each with the text of the deeper ones
    under it folded in: a paragraph heading ("Encoder:", "Label Smoothing")
    is a section of its own in the document, and its text belongs to the
    subsection it sits in (Attention's layer normalization is only there).

    Args:
        doc: The paper's structured document.

    Returns:
        The sections, in order.
    """
    sections: list[PaperSection] = []
    for section in doc.get("sections", []):
        if section.get("level", 9) <= DEPTH and section.get("title"):
            sections.append(
                PaperSection(
                    id=str(section["id"]),
                    heading=arxiv_document.section_heading(section),
                    text=arxiv_document.section_text(section),
                )
            )
        elif sections and section.get("level", 0) > DEPTH:
            sections[-1].text += "\n\n" + arxiv_document.section_text(section)
    return sections


def pdf_sections(paper: str, provider: Provider) -> list[PaperSection]:
    """A PDF's sections as the placer reads them (v8.44.0, the PDF view).

    The PDF's table of contents (its outline, else the headings found in its
    text: ``services/pdf/headings.py``), each entry with the text of the
    pages it spans: from its own page up to the next entry's, or its page
    alone when the next starts on the same one. Page-coarse, but the placer
    only needs to know what each section is about.

    Args:
        paper: The paper's arXiv id, or its provider id.
        provider: Who to ask for a non-arXiv paper's open-access PDF.

    Returns:
        ``pdf:<n>`` sections, ``n`` the entry's place in the contents (the
        Reader's ``/pdf-contents`` lists the same, in the same order), the
        reference list left out; empty
        when there's no PDF, no contents, or no ``pdf`` extra.
    """
    url = pdf_service.paper_pdf_url(paper, provider)
    if not url:
        return []
    try:
        entries = pdf_service.get_pdf_contents(url).get("entries") or []
        pages = pdf_service.get_pdf_pages(url).get("pages") or []
    except optional.MissingExtra:
        return []
    sections: list[PaperSection] = []
    for index, entry in enumerate(entries):
        # The reference list is what's cited, not what the reader needs.
        if str(entry["title"]).lower().strip() in {"references", "bibliography"}:
            continue
        first = int(entry["page"])
        following = next((int(later["page"]) for later in entries[index + 1 :] if int(later["page"]) > first), None)
        last = min(following - 1 if following else first, first + PDF_PAGES - 1, len(pages))
        sections.append(
            PaperSection(
                id=f"pdf:{index}",
                heading=str(entry["title"]),
                text="\n\n".join(pages[first - 1 : max(last, first)]),
            )
        )
    return sections


def paper_sections(paper: str, source: Literal["text", "pdf"], provider: Provider) -> list[PaperSection]:
    """The sections to place in, from the text or the PDF.

    Args:
        paper: The paper's arXiv id, or for the PDF a provider id too.
        source: Which: the arXiv render's text, or the PDF's contents.
        provider: Who to ask for a non-arXiv paper's open-access PDF.

    Returns:
        The sections (see :func:`text_sections`, :func:`pdf_sections`);
        empty when there's no text or PDF to read.

    Raises:
        Exception: Fetching the render or the PDF can fail; callers treat it
            as nothing to place in.
    """
    if source == "pdf":
        return pdf_sections(paper, provider)
    doc = arxiv.get_document(paper)
    return text_sections(doc) if doc.get("available") else []
