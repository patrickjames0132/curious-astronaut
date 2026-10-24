"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
A paper's ar5iv render as a structured document, for the Reader card.

``fulltext.py`` flattens the same render to plain text blocks for model
context: sections, figures and citation markers are all dropped, which is right
for its job. A reader needs exactly what it drops, so this is a second parse
beside it rather than a reuse of it. The output is a JSON tree the frontend
renders itself:

* ``sections`` — flat, in document order, each with its ``level`` (1 section,
  2 subsection, 3 subsubsection, 4 paragraph heading), its ``number`` and its
  own ``blocks`` (a nested section's content belongs to that section). The
  table of contents is built from this list.
* **blocks** — ``paragraph``, ``heading``, ``equation``, ``figure``, ``table``,
  ``list`` and ``listing`` (an algorithm's numbered, indented lines). A figure carries its image URLs (absolute ar5iv URLs; the route
  rewrites them to the same-origin proxy), its caption and its ``tag``
  ("Figure 2"). A float that is neither images nor a table (an algorithm box)
  keeps its content as nested ``blocks``.
* **inlines** — the runs inside a block: ``text`` (with an optional ``style``),
  ``math`` (the formula's ``alttext`` LaTeX, as in ``fulltext.py``), ``cite``
  (one bibliography entry, by its element id), ``ref`` (a jump to a figure,
  equation or section in the same document), ``link`` and ``note`` (a
  footnote's own runs). Keeping a citation as its own run, still tied to its
  ``bib.bibN`` entry, is the point of the whole parse: it's what later resolves
  ``[23]`` to the cited paper.
* ``bibliography`` — ``{id, label, text}`` per entry, ``text`` as runs.

We render the tree ourselves instead of passing ar5iv's HTML through: the
frontend never has to sanitize a third party's markup, and every run the later
Reader stages need to address (citations, terms) is already a value.

The parse builds a small element tree with ``HTMLParser`` (no new dependency)
and walks it. ar5iv's markup is LaTeXML's, so the walk keys on its ``ltx_*``
classes. Anything it doesn't recognize is walked through for its children, so
an unfamiliar wrapper loses nothing but its styling.

ar5iv answers some papers it failed to convert with a 200 page that has no
body (seen on 1412.6980). A parse with no sections and no abstract is reported
as ``available: False``, the same as a 404.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any

from ...storage import cache
from . import client

# Part of the cache key: bump it when the parse's output changes, so a
# document cached by an older parse isn't served for the rest of its 30 days.
_PARSE_VERSION = 3

Inline = dict[str, Any]
Block = dict[str, Any]

# Elements that never have children or an end tag.
_VOID_TAGS = {"img", "br", "hr", "meta", "link", "input", "col", "source", "wbr", "area", "base"}
# Subtrees that are never paper content.
_SKIP_TAGS = {"script", "style", "nav", "header", "footer", "svg", "button", "noscript"}
# LaTeXML wrappers around the page chrome and front matter we don't read as body.
_SKIP_CLASSES = {
    "ltx_authors",
    "ltx_dates",
    "ltx_page_footer",
    "ltx_page_header",
    "ltx_TOC",
    "ltx_keywords",
    "ltx_classification",
    "ltx_note_type",
}
_SECTION_LEVELS = {
    "ltx_section": 1,
    "ltx_appendix": 1,
    "ltx_subsection": 2,
    "ltx_subsubsection": 3,
    "ltx_paragraph": 4,
    "ltx_subparagraph": 4,
}
_STYLE_CLASSES = {
    "ltx_font_italic": "italic",
    "ltx_font_bold": "bold",
    "ltx_font_typewriter": "code",
}
_STYLE_TAGS = {
    "em": "italic",
    "i": "italic",
    "b": "bold",
    "strong": "bold",
    "code": "code",
    "tt": "code",
    "sup": "sup",
    "sub": "sub",
}
_HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
# How wide each typographic space is, in em. LaTeXML indents an algorithm's
# lines with these (2402.03300: em + en spaces per level); the ASCII spaces
# and newlines around them are only the HTML source's own formatting.
_SPACE_WIDTHS = {"\u2003": 1.0, "\u2002": 0.5, "\u2009": 0.2, "\u200a": 0.1, "\u00a0": 0.25}


@dataclass
class _Element:
    """One HTML element: its tag, attributes and children (elements or text)."""

    tag: str
    attrs: dict[str, str]
    children: list[_Element | str] = field(default_factory=list)

    @property
    def classes(self) -> set[str]:
        """The element's class names.

        Returns:
            The ``class`` attribute split on whitespace.
        """
        return set(self.attrs.get("class", "").split())

    def elements(self) -> list[_Element]:
        """The element's child elements, text nodes left out.

        Returns:
            The children that are elements, in order.
        """
        return [child for child in self.children if isinstance(child, _Element)]

    def find(self, tag: str | None = None, cls: str | None = None) -> _Element | None:
        """The first descendant matching a tag and/or class, depth first.

        Args:
            tag: The tag to match, or None for any.
            cls: A class the element must carry, or None for any.

        Returns:
            The first match, or None.
        """
        for child in self.elements():
            if (tag is None or child.tag == tag) and (cls is None or cls in child.classes):
                return child
            found = child.find(tag, cls)
            if found is not None:
                return found
        return None

    def find_all(self, tag: str | None = None, cls: str | None = None) -> list[_Element]:
        """Every descendant matching a tag and/or class, in document order.

        Args:
            tag: The tag to match, or None for any.
            cls: A class the element must carry, or None for any.

        Returns:
            The matches.
        """
        matches: list[_Element] = []
        for child in self.elements():
            if (tag is None or child.tag == tag) and (cls is None or cls in child.classes):
                matches.append(child)
            matches.extend(child.find_all(tag, cls))
        return matches

    def text(self) -> str:
        """The element's text content, whitespace collapsed.

        Returns:
            Every text node beneath it, joined.
        """
        parts: list[str] = []
        for child in self.children:
            parts.append(child if isinstance(child, str) else child.text())
        return " ".join("".join(parts).split())


class _TreeBuilder(HTMLParser):
    """Build an ``_Element`` tree, tolerating the unclosed tags HTML allows."""

    def __init__(self) -> None:
        """Start from an empty document root."""
        super().__init__(convert_charrefs=True)
        self.root = _Element("document", {})
        self._stack: list[_Element] = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Open an element (void elements close at once).

        Args:
            tag: The tag name.
            attrs: The tag's attributes as (name, value) pairs.
        """
        element = _Element(tag, {name: value or "" for name, value in attrs})
        self._stack[-1].children.append(element)
        if tag not in _VOID_TAGS:
            self._stack.append(element)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """A self-closed element: append it without opening a scope.

        Args:
            tag: The tag name.
            attrs: The tag's attributes as (name, value) pairs.
        """
        self._stack[-1].children.append(_Element(tag, {name: value or "" for name, value in attrs}))

    def handle_endtag(self, tag: str) -> None:
        """Close the nearest open element with this tag, and any left open inside it.

        Args:
            tag: The tag name.
        """
        for depth in range(len(self._stack) - 1, 0, -1):
            if self._stack[depth].tag == tag:
                del self._stack[depth:]
                return

    def handle_data(self, data: str) -> None:
        """Append a text node to the open element.

        Args:
            data: The character data.
        """
        self._stack[-1].children.append(data)


def _skipped(element: _Element) -> bool:
    """Whether an element is never paper content.

    Args:
        element: The element.

    Returns:
        True for page chrome, scripts and front matter.
    """
    return element.tag in _SKIP_TAGS or bool(element.classes & _SKIP_CLASSES)


# --- math ------------------------------------------------------------------

# Box commands authors wrap a formula in to make it fit the PDF's column.
# LaTeXML keeps the wrapper in ``alttext`` and KaTeX knows none of them; on a
# page that reflows, the formula alone is what's wanted. Each maps to how
# many brace groups come before the content (1801.01290 has
# ``\resizebox{22609920}{}{$…$}``).
_BOX_COMMANDS = {"resizebox": 2, "scalebox": 1, "adjustbox": 1}
# Macros KaTeX lacks, mapped to the nearest one it has.
_MACRO_SWAPS = {"\\nicefrac": "\\tfrac"}


def _latex(element: _Element) -> str:
    """A ``<math>`` element's LaTeX, made typesettable by KaTeX.

    Args:
        element: The ``<math>`` element.

    Returns:
        Its ``alttext``, box wrappers removed and unsupported macros swapped;
        "" when it has none.
    """
    latex = element.attrs.get("alttext", "").strip()
    for macro, swap in _MACRO_SWAPS.items():
        latex = re.sub(re.escape(macro) + r"(?![A-Za-z])", lambda _: swap, latex)
    return _unbox(latex).strip()


def _unbox(latex: str) -> str:
    r"""Replace each box command with the formula inside it.

    Args:
        latex: A formula.

    Returns:
        The formula with every ``\resizebox{…}{…}{X}`` (and kin) replaced by
        ``X``, X's own ``$`` fences dropped. A wrapper whose braces don't
        balance is left as it was.
    """
    pattern = re.compile(r"\\(" + "|".join(_BOX_COMMANDS) + r")(?![A-Za-z])\s*")
    position = 0
    pieces: list[str] = []
    while (match := pattern.search(latex, position)) is not None:
        cursor = match.end()
        groups: list[str] = []
        for _ in range(_BOX_COMMANDS[match.group(1)] + 1):
            if latex.startswith("[", cursor):  # an optional argument
                close = latex.find("]", cursor)
                cursor = close + 1 if close != -1 else cursor
            group = _brace_group(latex, cursor)
            if group is None:
                break
            groups.append(latex[cursor + 1 : group])
            cursor = group + 1
            while cursor < len(latex) and latex[cursor].isspace():
                cursor += 1
        if len(groups) != _BOX_COMMANDS[match.group(1)] + 1:
            pieces.append(latex[position : match.end()])
            position = match.end()
            continue
        body = groups[-1].strip()
        if body.startswith("$") and body.endswith("$"):
            body = body.strip("$")
        pieces.append(latex[position : match.start()] + "{" + _unbox(body) + "}")
        position = cursor
    pieces.append(latex[position:])
    return "".join(pieces)


def _brace_group(latex: str, start: int) -> int | None:
    """Where the brace group opening at ``start`` closes.

    Args:
        latex: The formula.
        start: The index of an opening ``{``.

    Returns:
        The index of its matching ``}``, or None when ``start`` isn't a ``{``
        or the group never closes. Escaped braces don't count.
    """
    if not latex.startswith("{", start):
        return None
    depth = 0
    index = start
    while index < len(latex):
        char = latex[index]
        if char == "\\":
            index += 2
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return None


# --- inlines ---------------------------------------------------------------


def _inlines(element: _Element, style: str | None = None) -> list[Inline]:
    """The runs inside an element, cleaned up.

    Args:
        element: The element whose children to read.
        style: The text style inherited from an enclosing element.

    Returns:
        Its runs, with whitespace collapsed and the ends trimmed.
    """
    return _tidy(_collect(element, style))


def _collect(element: _Element, style: str | None) -> list[Inline]:
    """The raw runs inside an element, before tidying.

    Args:
        element: The element whose children to read.
        style: The text style inherited from an enclosing element.

    Returns:
        Its runs, in order.
    """
    runs: list[Inline] = []
    for child in element.children:
        if isinstance(child, str):
            runs.append(_text_run(child, style))
        elif not _skipped(child):
            runs.extend(_inline(child, style))
    return runs


def _inline(element: _Element, style: str | None) -> list[Inline]:
    """The runs one element contributes.

    Args:
        element: The element.
        style: The text style inherited from an enclosing element.

    Returns:
        Its runs.
    """
    classes = element.classes
    if element.tag == "math":
        latex = _latex(element)
        if not latex:
            return []
        return [{"kind": "math", "latex": latex, "display": element.attrs.get("display") == "block"}]
    if element.tag == "a":
        return _anchor(element, style)
    if element.tag == "br":
        return [_text_run(" ", style)]
    if element.tag in {"img", "object"}:
        return []
    if "ltx_note" in classes:
        return _note(element)
    if "ltx_tag" in classes and "ltx_tag_bibitem" in classes:
        return []
    inner_style = _STYLE_TAGS.get(element.tag) or next(
        (name for cls, name in _STYLE_CLASSES.items() if cls in classes), style
    )
    return _collect(element, inner_style)


def _anchor(element: _Element, style: str | None) -> list[Inline]:
    """An ``<a>``: a citation, a jump within the paper, or an outside link.

    Args:
        element: The ``<a>`` element.
        style: The text style inherited from an enclosing element.

    Returns:
        One run for a citation, ref or link; the anchor's own runs otherwise.
    """
    href = element.attrs.get("href", "")
    text = element.text()
    if href.startswith("#bib."):
        return [{"kind": "cite", "bib": href[1:], "text": text}]
    if href.startswith("#") and len(href) > 1:
        return [{"kind": "ref", "target": href[1:], "text": text}]
    if href.startswith(("http://", "https://")) and text:
        return [{"kind": "link", "href": href, "text": text}]
    return _collect(element, style)


def _note(element: _Element) -> list[Inline]:
    """A footnote, as one run carrying its own content.

    Only LaTeXML's ``ltx_role_footnote`` notes have content worth showing;
    footnote *marks* (an author's affiliation symbol) carry none.

    Args:
        element: The ``ltx_note`` element.

    Returns:
        A single ``note`` run, or nothing for a bare mark.
    """
    if "ltx_role_footnote" not in element.classes:
        return []
    content = element.find(cls="ltx_note_content")
    if content is None:
        return []
    mark = element.find("sup", "ltx_note_mark")
    runs = _tidy(
        [
            run
            for child in content.children
            if not (isinstance(child, _Element) and _is_note_chrome(child))
            for run in (
                [_text_run(child, None)] if isinstance(child, str) else _inline(child, None)
            )
        ]
    )
    if not runs:
        return []
    return [{"kind": "note", "mark": mark.text() if mark else "", "inlines": runs}]


def _is_note_chrome(element: _Element) -> bool:
    """Whether a footnote child is its mark or type label rather than its text.

    Args:
        element: A child of a note's content.

    Returns:
        True for the repeated mark, the "footnote:" label and the tag.
    """
    classes = element.classes
    return bool(classes & {"ltx_note_mark", "ltx_note_type", "ltx_tag_note"})


def _text_run(text: str, style: str | None) -> Inline:
    """A text run.

    Args:
        text: Its text, whitespace not yet collapsed.
        style: Its style, if any.

    Returns:
        The run.
    """
    run: Inline = {"kind": "text", "text": text}
    if style:
        run["style"] = style
    return run


def _tidy(runs: list[Inline]) -> list[Inline]:
    """Collapse whitespace, merge neighbouring text runs and trim the ends.

    Args:
        runs: Raw runs.

    Returns:
        Runs ready to send: no empty text, no doubled spaces, no leading or
        trailing blanks.
    """
    merged: list[Inline] = []
    for run in runs:
        if run["kind"] == "text":
            text = re.sub(r"\s+", " ", run["text"])
            if not text:
                continue
            previous = merged[-1] if merged else None
            if previous and previous["kind"] == "text" and previous.get("style") == run.get("style"):
                previous["text"] = re.sub(r" {2,}", " ", previous["text"] + text)
                continue
            run = {**run, "text": text}
        merged.append(run)
    # A space shared between two runs only needs to appear once.
    for position in range(1, len(merged)):
        previous, current = merged[position - 1], merged[position]
        if (
            previous["kind"] == "text"
            and current["kind"] == "text"
            and previous["text"].endswith(" ")
            and current["text"].startswith(" ")
        ):
            current["text"] = current["text"][1:]
    if merged and merged[0]["kind"] == "text":
        merged[0]["text"] = merged[0]["text"].lstrip()
    if merged and merged[-1]["kind"] == "text":
        merged[-1]["text"] = merged[-1]["text"].rstrip()
    return [run for run in merged if run["kind"] != "text" or run["text"]]


# --- blocks ----------------------------------------------------------------


def _blocks(element: _Element) -> list[Block]:
    """The blocks inside a container, sections excluded (they're their own).

    Args:
        element: The container.

    Returns:
        Its blocks, in order.
    """
    blocks: list[Block] = []
    loose: list[Inline] = []  # inline content sitting directly in the container

    def flush() -> None:
        """Turn any loose inline content into a paragraph."""
        runs = _tidy(loose)
        loose.clear()
        if runs:
            blocks.append({"kind": "paragraph", "inlines": runs})

    for child in element.children:
        if isinstance(child, str):
            loose.append(_text_run(child, None))
            continue
        if _skipped(child) or _section_level(child) or "ltx_bibliography" in child.classes:
            continue
        block = _block(child)
        if block is None:
            loose.extend(_inline(child, None))
            continue
        flush()
        blocks.extend(block)
    flush()
    return blocks


def _block(element: _Element) -> list[Block] | None:
    """The blocks one element contributes, or None if it's inline content.

    Args:
        element: The element.

    Returns:
        Its blocks, or None for an element that belongs in a paragraph.
    """
    classes = element.classes
    if element.tag == "p":
        runs = _inlines(element)
        return [{"kind": "paragraph", "inlines": runs}] if runs else []
    if element.tag in _HEADING_TAGS:
        runs = _inlines(element)
        return [{"kind": "heading", "inlines": runs}] if runs else []
    if element.tag == "figure":
        return [_figure(element)]
    if element.tag == "table" and classes & {"ltx_equation", "ltx_equationgroup"}:
        return _equations(element)
    if element.tag == "table" and "ltx_tabular" in classes:
        return [{"kind": "table", "id": element.attrs.get("id", ""), "rows": _rows(element)}]
    if element.tag in {"ul", "ol"}:
        return [_list(element)]
    if "ltx_listing" in classes:
        return [_listing(element)]
    if element.tag == "math" and element.attrs.get("display") == "block":
        latex = _latex(element)
        return [{"kind": "equation", "id": element.attrs.get("id", ""), "latex": latex}] if latex else []
    if element.tag in {"div", "section", "blockquote", "article", "span"} and _has_block_child(element):
        return _blocks(element)
    if element.tag in {"div", "section", "blockquote", "article"}:
        runs = _inlines(element)
        return [{"kind": "paragraph", "inlines": runs}] if runs else []
    return None


def _has_block_child(element: _Element) -> bool:
    """Whether an element holds block content (so it's a wrapper, not a span).

    Args:
        element: The element.

    Returns:
        True when any descendant is a paragraph, heading, figure, table or list.
    """
    block_tags = {"p", "figure", "table", "ul", "ol", "div"} | _HEADING_TAGS
    return any(child.tag in block_tags or _has_block_child(child) for child in element.elements())


def _figure(element: _Element) -> Block:
    """A figure or table float: its images or table, caption and tag.

    Args:
        element: The ``<figure>`` element.

    Returns:
        A ``figure`` block. ``table`` holds the rows of a tabular float;
        ``blocks`` holds the content of a float that is neither (an algorithm).
    """
    caption_element = next((child for child in element.elements() if child.tag == "figcaption"), None)
    tag = ""
    caption: list[Inline] = []
    if caption_element is not None:
        tag_element = caption_element.find(cls="ltx_tag")
        tag = tag_element.text().rstrip(":").strip() if tag_element else ""
        caption = _tidy(
            [
                run
                for child in caption_element.children
                if not (isinstance(child, _Element) and "ltx_tag" in child.classes)
                for run in ([_text_run(child, None)] if isinstance(child, str) else _inline(child, None))
            ]
        )
    images = [
        {
            "src": client.absolute_url(source),
            "alt": image.attrs.get("alt", ""),
            "width": _number(image.attrs.get("width")),
            "height": _number(image.attrs.get("height")),
        }
        for image in element.find_all()
        if (source := _image_source(image))
    ]
    block: Block = {
        "kind": "figure",
        "id": element.attrs.get("id", ""),
        "tag": tag,
        "caption": caption,
        "images": images,
    }
    tabular = element.find("table", "ltx_tabular")
    if tabular is not None:
        block["rows"] = _rows(tabular)
    elif not images:
        body = _Element("div", {}, [child for child in element.children if child is not caption_element])
        block["blocks"] = _blocks(body)
    return block


def _image_source(element: _Element) -> str:
    """Where a figure panel's image lives, if the element is one.

    LaTeXML emits raster panels as ``<img src>`` and vector ones as
    ``<object type="image/svg+xml" data>`` (the appendix of 1706.03762). Both
    are shown through ``<img>``, where an SVG's scripts never run.

    Args:
        element: A descendant of a figure.

    Returns:
        The raw image URL, or "" when the element isn't an image.
    """
    if element.tag == "img":
        return element.attrs.get("src", "")
    if element.tag == "object" and element.attrs.get("type", "").startswith("image/"):
        return element.attrs.get("data", "")
    return ""


def _number(value: str | None) -> int | None:
    """An image dimension as an int.

    Args:
        value: The raw attribute.

    Returns:
        The number, or None when absent or not a whole number.
    """
    return int(value) if value and value.isdigit() else None


def _rows(table: _Element) -> list[list[dict[str, Any]]]:
    """A tabular's rows and cells.

    Args:
        table: The ``ltx_tabular`` element.

    Returns:
        Rows of ``{inlines, header, colspan}`` cells.
    """
    rows: list[list[dict[str, Any]]] = []
    for row in table.find_all("tr"):
        cells = []
        for cell in row.elements():
            if cell.tag not in {"td", "th"}:
                continue
            entry: dict[str, Any] = {"inlines": _inlines(cell), "header": cell.tag == "th"}
            span = _number(cell.attrs.get("colspan"))
            if span and span > 1:
                entry["colspan"] = span
            cells.append(entry)
        if cells:
            rows.append(cells)
    return rows


def _equations(table: _Element) -> list[Block]:
    """A displayed equation or equation group, one block per row.

    LaTeXML lays a display out as a table: each row is one line, its math split
    across alignment cells, its number in an ``ltx_tag_equation`` cell. Each
    row's pieces join back into one formula.

    Args:
        table: The ``ltx_equation`` / ``ltx_equationgroup`` table.

    Returns:
        One ``equation`` block per row that holds math.
    """
    equations: list[Block] = []
    # A row's own id sits on its <tbody> (``S3.Ex1``); only the first row may
    # fall back to the table's, so no two blocks share a DOM id.
    rows: list[tuple[str, _Element]] = []
    for body in [child for child in table.elements() if child.tag == "tbody"] or [table]:
        rows.extend(
            (body.attrs.get("id", ""), row) for row in body.find_all("tr") if "ltx_eqn_row" in row.classes
        )
    if not rows:
        rows = [("", table)]
    fallback = table.attrs.get("id", "")
    for row_id, row in rows:
        latex = " ".join(
            latex for math in row.find_all("math") if (latex := _latex(math))
        )
        if not latex:
            continue
        number = row.find(cls="ltx_tag_equation")
        equations.append(
            {
                "kind": "equation",
                "id": row.attrs.get("id") or row_id or fallback,
                "latex": latex,
                "tag": number.text() if number else "",
            }
        )
        fallback = ""
    return equations


def _listing(element: _Element) -> Block:
    """An algorithm (LaTeXML's ``ltx_listing``): its lines, numbered and indented.

    Args:
        element: The ``ltx_listing`` element.

    Returns:
        A ``listing`` block of ``{number, indent, inlines}`` lines, ``indent``
        in em (the leading typographic spaces' widths, summed).
    """
    lines = []
    for line in element.find_all(cls="ltx_listingline"):
        tag = line.find(cls="ltx_tag_listingline")
        body = _Element(
            "div",
            {},
            [child for child in line.children if not (isinstance(child, _Element) and "ltx_tag" in child.classes)],
        )
        runs = _collect(body, None)
        indent = 0.0
        for run in runs:
            if run["kind"] != "text":
                break
            text = run["text"]
            consumed = 0
            for char in text:
                if char in _SPACE_WIDTHS:
                    indent += _SPACE_WIDTHS[char]
                elif not char.isspace():
                    break
                consumed += 1
            run["text"] = text[consumed:]
            if consumed < len(text):
                break
        lines.append(
            {
                "number": tag.text().rstrip(":") if tag else "",
                "indent": round(indent, 2),
                "inlines": _tidy(runs),
            }
        )
    return {"kind": "listing", "id": element.attrs.get("id", ""), "lines": lines}


def _list(element: _Element) -> Block:
    """An itemize or enumerate list.

    Args:
        element: The ``<ul>`` / ``<ol>`` element.

    Returns:
        A ``list`` block whose items are each a list of blocks.
    """
    items = []
    for item in element.elements():
        if item.tag != "li":
            continue
        body = _Element(
            "div",
            {},
            [
                child
                for child in item.children
                if not (isinstance(child, _Element) and "ltx_tag_item" in child.classes)
            ],
        )
        blocks = _blocks(body)
        if blocks:
            items.append(blocks)
    return {"kind": "list", "ordered": element.tag == "ol", "items": items}


# --- sections and the document ---------------------------------------------


def _section_level(element: _Element) -> int:
    """A sectioning element's level.

    Args:
        element: The element.

    Returns:
        1–4 for a LaTeXML section, else 0.
    """
    if element.tag != "section":
        return 0
    return next((level for cls, level in _SECTION_LEVELS.items() if cls in element.classes), 0)


def _sections(container: _Element) -> list[dict[str, Any]]:
    """Every section beneath a container, flattened in document order.

    Args:
        container: The element to search.

    Returns:
        ``{id, level, number, title, blocks}`` per section.
    """
    sections: list[dict[str, Any]] = []
    for child in container.elements():
        if _skipped(child) or "ltx_bibliography" in child.classes:
            continue
        level = _section_level(child)
        if not level:
            sections.extend(_sections(child))
            continue
        heading = next((item for item in child.elements() if item.tag in _HEADING_TAGS), None)
        number = ""
        title: list[Inline] = []
        if heading is not None:
            tag = heading.find(cls="ltx_tag")
            number = tag.text().rstrip(".") if tag else ""
            title = _tidy(
                [
                    run
                    for item in heading.children
                    if not (isinstance(item, _Element) and "ltx_tag" in item.classes)
                    for run in ([_text_run(item, None)] if isinstance(item, str) else _inline(item, None))
                ]
            )
        body = _Element("section", {}, [item for item in child.children if item is not heading])
        sections.append(
            {
                "id": child.attrs.get("id", ""),
                "level": level,
                "number": number,
                "title": title,
                "blocks": _blocks(body),
            }
        )
        sections.extend(_sections(child))
    return sections


def _bibliography(root: _Element) -> list[dict[str, Any]]:
    """The reference list.

    Args:
        root: The document root.

    Returns:
        ``{id, label, text}`` per entry; ``label`` is the marker the text
        cites it by (``2``, or ``Bahdanau et al., 2014``), brackets stripped.
    """
    entries: list[dict[str, Any]] = []
    for item in root.find_all("li", "ltx_bibitem"):
        tag = item.find(cls="ltx_tag_bibitem")
        label = tag.text().strip("[]() ") if tag else ""
        blocks = [block for block in item.elements() if "ltx_bibblock" in block.classes]
        runs: list[Inline] = []
        for block in blocks:
            runs.extend(_collect(block, None))
            runs.append(_text_run(" ", None))
        entries.append({"id": item.attrs.get("id", ""), "label": label, "text": _tidy(runs)})
    return entries


def parse_document(html: str) -> dict[str, Any]:
    """Parse an ar5iv render into the Reader's structured document.

    Args:
        html: The full ar5iv HTML page.

    Returns:
        ``{available, title, abstract, sections, bibliography}``; see the
        module docstring for the shapes. ``available`` is False when the page
        has no body (no sections and no abstract).
    """
    builder = _TreeBuilder()
    builder.feed(html)
    builder.close()
    root = builder.root
    title_element = root.find(cls="ltx_title_document")
    abstract_element = root.find(cls="ltx_abstract")
    abstract: list[Block] = []
    if abstract_element is not None:
        body = _Element(
            "div",
            {},
            [
                child
                for child in abstract_element.children
                if not (isinstance(child, _Element) and child.tag in _HEADING_TAGS)
            ],
        )
        abstract = _blocks(body)
    sections = _sections(root)
    return {
        "available": bool(sections or abstract),
        "title": _inlines(title_element) if title_element is not None else [],
        "abstract": abstract,
        "sections": sections,
        "bibliography": _bibliography(root),
    }


def _empty() -> dict[str, Any]:
    """The document for a paper with no render.

    Returns:
        An unavailable, empty document.
    """
    return {"available": False, "title": [], "abstract": [], "sections": [], "bibliography": []}


def get_document(arxiv_id: str, *, refresh: bool = False) -> dict[str, Any]:
    """Fetch a paper's structured document from ar5iv, cached.

    Args:
        arxiv_id: The paper's arXiv id (a version suffix is stripped).
        refresh: When True, bypass the cache and re-fetch from ar5iv.

    Returns:
        The ``parse_document`` result. A paper ar5iv has no render for (a 404,
        or a 200 page with no body) comes back ``available: False``; misses
        are cached too. Image URLs are absolute ar5iv URLs.

    Raises:
        urllib.error.HTTPError: On non-404 ar5iv HTTP failures.
        urllib.error.URLError: On network failures.
    """
    arxiv_id = (arxiv_id or "").strip().split("v")[0]
    if not arxiv_id:
        return _empty()

    key = f"document:{_PARSE_VERSION}:{arxiv_id}"
    if not refresh:
        cached = cache.get(key, client.CACHE_TTL)
        if cached is not None:
            return dict(cached)

    html = client.fetch_html(arxiv_id)
    result = parse_document(html) if html is not None else _empty()
    cache.set(key, result)
    return result


# --- as text, for a model's prompt ------------------------------------------


def inline_text(runs: list[Inline]) -> str:
    """A run list as plain text: math kept as ``$…$``, a citation as its marker.

    Args:
        runs: The runs.

    Returns:
        Their text. A footnote follows its mark in brackets, so nothing the
        paper says is lost.
    """
    parts: list[str] = []
    for run in runs:
        kind = run.get("kind")
        if kind == "math":
            parts.append(f"$${run['latex']}$$" if run.get("display") else f"${run['latex']}$")
        elif kind == "note":
            parts.append(f" [footnote: {inline_text(run.get('inlines', []))}]")
        else:
            parts.append(str(run.get("text", "")))
    return "".join(parts)


def block_text(block: Block) -> str:
    """One block as plain text.

    Args:
        block: The block.

    Returns:
        Its text: an equation as ``$$…$$`` with its number, a figure or table
        as its tag and caption (and a table's rows, cells split by ``|``), a
        list as bullets, an algorithm as its numbered lines.
    """
    kind = block.get("kind")
    if kind in {"paragraph", "heading"}:
        return inline_text(block.get("inlines", []))
    if kind == "equation":
        tag = block.get("tag") or ""
        return f"$${block.get('latex', '')}$$ {tag}".rstrip()
    if kind in {"table", "figure"}:
        lines = []
        if kind == "figure":
            lines.append(f"[{block.get('tag') or 'Figure'}] {inline_text(block.get('caption', []))}".rstrip())
        for row in block.get("rows") or []:
            lines.append(" | ".join(inline_text(cell.get("inlines", [])) for cell in row))
        lines.extend(block_text(inner) for inner in block.get("blocks") or [])
        return "\n".join(line for line in lines if line)
    if kind == "list":
        return "\n".join(
            "- " + " ".join(block_text(inner) for inner in item) for item in block.get("items", [])
        )
    if kind == "listing":
        return "\n".join(
            f"{line.get('number', '')} {'  ' * round(line.get('indent', 0))}{inline_text(line.get('inlines', []))}"
            for line in block.get("lines", [])
        )
    return ""


def section_heading(section: dict[str, Any]) -> str:
    """A section's number and title, as the paper heads it.

    Args:
        section: The section.

    Returns:
        E.g. ``3.2 Attention``, or the title alone when unnumbered.
    """
    title = inline_text(section.get("title", []))
    number = section.get("number") or ""
    return f"{number} {title}".strip()


def section_text(section: dict[str, Any]) -> str:
    """A section as plain text: its heading, then its blocks.

    Args:
        section: The section.

    Returns:
        The text, blocks separated by blank lines.
    """
    body = "\n\n".join(text for text in (block_text(block) for block in section.get("blocks", [])) if text)
    return f"## {section_heading(section)}\n\n{body}".rstrip()
