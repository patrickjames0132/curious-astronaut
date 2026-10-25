"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The figures a box over the Reader's text took, as pictures for the model
(v8.48.0, the Reader's stage 8).

An image can't be selected, so until a box could take a figure the model
never saw one asked about from the text: only its caption. The Reader sends
the figure's image sources as the page shows them, our figure proxy's URLs
(``/api/figure_proxy?src=…``); each is unwrapped, held to **the proxy's own
allowlist** (``arxiv.is_render_url``, ar5iv and arXiv's HTML render only),
so a question can't make the server fetch anything else, and fetched.

**Every picture goes as a PNG.** Many renders draw their plots as SVG (all
of SAC's results are), which the model can't take; pymupdf, the ``pdf``
extra, opens SVG, JPEG and the rest and renders them to PNG. Without the
extra only figures already PNG go.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
import urllib.parse

from ... import optional
from ...integrations import arxiv

log = logging.getLogger(__name__)

MAX_FIGURES = 8
"""Images one question may carry: a figure's panels count one each. Eight,
not four: SAC's results figure is six panels, and four cut it short (the
model answered about "the four plots you've shared")."""
PROXY_PATH = "/api/figure_proxy"
"""Where the page loads a figure from, our same-origin proxy."""
SVG_SCALE = 2.0
"""How much larger than its own size an SVG is drawn, to be legible."""


def figure_source(raw: str) -> str | None:
    """The render URL behind an image source, if it's one we may fetch.

    Args:
        raw: An image's ``src`` as the page shows it: our proxy's URL, or a
            render URL itself.

    Returns:
        The render URL, or None when it isn't on the proxy's allowlist.
    """
    parsed = urllib.parse.urlparse(raw)
    if parsed.path == PROXY_PATH and not parsed.netloc:
        raw = urllib.parse.parse_qs(parsed.query).get("src", [""])[0]
    return raw if arxiv.is_render_url(raw) else None


def _as_png(data: bytes, content_type: str) -> bytes | None:
    """An image as PNG bytes.

    Args:
        data: The image as fetched.
        content_type: Its declared type.

    Returns:
        PNG bytes, or None when it can't be made one (no ``pdf`` extra for
        anything but a PNG, or a file pymupdf can't read).
    """
    if content_type == "image/png" and data.startswith(b"\x89PNG"):
        return data
    if not optional.available("pdf"):
        return None
    fitz = optional.require("fitz", "pdf")
    try:
        if content_type == "image/svg+xml" or data.lstrip().startswith((b"<svg", b"<?xml")):
            with fitz.open(stream=data, filetype="svg") as doc:
                page = doc.load_page(0)
                pixmap = page.get_pixmap(matrix=fitz.Matrix(SVG_SCALE, SVG_SCALE), alpha=False)
                return bytes(pixmap.tobytes("png"))
        return bytes(fitz.Pixmap(data).tobytes("png"))
    except Exception:
        log.warning("figure image couldn't be made a PNG (%s)", content_type, exc_info=True)
        return None


def figure_pngs(raw: object) -> list[bytes]:
    """The figures a box took, fetched and made PNGs, for the model.

    Args:
        raw: The request's ``figures``: their images' sources.

    Returns:
        Up to ``MAX_FIGURES`` PNGs, in order; any that isn't allowed, fails to
        fetch or can't be made a PNG is left out.
    """
    if not isinstance(raw, list):
        return []
    images: list[bytes] = []
    for item in raw:
        if len(images) >= MAX_FIGURES:
            break
        url = figure_source(item) if isinstance(item, str) else None
        if not url:
            continue
        try:
            data, content_type = arxiv.fetch_image(url)
        except Exception:
            log.warning("figure fetch failed for %s", url, exc_info=True)
            continue
        png = _as_png(data, content_type)
        if png:
            images.append(png)
    return images
