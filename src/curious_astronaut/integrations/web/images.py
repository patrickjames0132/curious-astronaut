"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The pictures on a web page, with the words that say what each shows (v8.24.0).

A lesson's image can be a diagram found on the web. A search returns
pages, not images, so this reads a page's HTML and lists its pictures:
``page_images`` walks the markup with the standard library's parser (the
codebase has no HTML library, and needs none for this) and keeps, for each
``<img>``, its address (``src``, else a lazy-loader's ``data-src``, else the
largest ``srcset`` entry), its ``alt``, the caption of the ``<figure>`` it
sits in, and the text just before it. Those words are what let the tutor
judge an image before it looks at it.

Most images on a page aren't figures: logos, avatars, icons, tracking pixels,
ads. ``page_images`` drops the ones whose address or declared size gives them
away; ``image_size`` reads an image's real dimensions from its header (PNG,
JPEG, GIF, WebP) so a downloaded one can be refused when it is too small to
teach from.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import re
import struct
import urllib.parse
from html.parser import HTMLParser

from pydantic import BaseModel, ConfigDict

#: Address words that mark an image as page furniture, not a figure. Matched
#: against the address's **path only**: Wikipedia tags every figure's query
#: string ``utm_content=thumbnail``, which once dropped all of them.
_FURNITURE = re.compile(
    r"logo|icon|avatar|sprite|badge|banner|button|emoji|favicon|pixel|tracking|spinner|"
    r"gravatar|/ads?/|advert|social|share|thumb_?nail",
    re.IGNORECASE,
)

#: Image formats a vision model reads. SVG is left out: it can't be checked
#: for size, is usually an icon, and the model isn't shown vector files.
_RASTER = re.compile(r"\.(png|jpe?g|gif|webp)(\?|#|$)", re.IGNORECASE)

#: The smallest side, in pixels, of an image worth teaching from.
MIN_SIDE = 200

#: How much of the text before an image is kept as its context.
CONTEXT_CHARS = 240


class PageImage(BaseModel):
    """One picture on a page, and the words around it."""

    model_config = ConfigDict(extra="forbid")

    url: str
    alt: str
    caption: str
    context: str


def _largest_srcset(srcset: str) -> str:
    """The largest candidate in a ``srcset`` (by its ``w`` or ``x`` descriptor).

    Args:
        srcset: The attribute.

    Returns:
        Its address, or '' when it lists none.
    """
    best, best_size = "", -1.0
    for entry in srcset.split(","):
        parts = entry.split()
        if not parts:
            continue
        size = 1.0
        if len(parts) > 1 and parts[1][:-1].replace(".", "", 1).isdigit():
            size = float(parts[1][:-1])
        if size > best_size:
            best, best_size = parts[0], size
    return best


class _ImageParser(HTMLParser):
    """Collect a page's ``<img>``s with their alt, figure caption and preceding text."""

    def __init__(self, base: str) -> None:
        """Start a parse.

        Args:
            base: The page's URL, for resolving relative addresses.
        """
        super().__init__(convert_charrefs=True)
        self.base = base
        self.images: list[dict[str, str]] = []
        self.title = ""
        self._text: list[str] = []
        self._figure: list[int] = []  # indexes of images inside the open <figure>
        self._in_caption = False
        self._caption: list[str] = []
        self._in_title = False
        self._skip = 0  # inside <script> / <style>
        self._sources: list[str] = []  # srcsets of the open <picture>'s <source>s

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Note an image, or where a figure, caption or title opens.

        Args:
            tag: The tag.
            attrs: Its attributes.
        """
        named = {name: value or "" for name, value in attrs}
        if tag in ("script", "style", "noscript"):
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "figure":
            self._figure = []
            self._caption = []
        elif tag == "figcaption":
            self._in_caption = True
        elif tag == "picture":
            self._sources = []
        elif tag == "source":
            self._sources.append(named.get("srcset") or named.get("data-srcset") or "")
        elif tag == "img":
            # The largest offered size first: ``src`` is often a thumbnail too
            # small to teach from (or to pass ``MIN_SIDE``), and a <picture>
            # (Medium, many blogs) offers its sizes on its <source>s.
            source = (
                named.get("data-src")
                or named.get("data-original")
                or _largest_srcset(named.get("srcset") or named.get("data-srcset") or "")
                or next(filter(None, (_largest_srcset(entry) for entry in self._sources)), "")
                or named.get("src")
            )
            if not source or source.startswith("data:"):
                return
            # A page written on Windows can name its images with backslashes,
            # which a browser forgives and a fetch does not.
            source = source.replace("\\", "/")
            for side in ("width", "height"):
                declared = named.get(side, "")
                if declared.isdigit() and int(declared) < MIN_SIDE // 2:
                    return  # declared too small to be a figure
            self._figure.append(len(self.images))
            self.images.append(
                {
                    "url": urllib.parse.urljoin(self.base, source),
                    "alt": " ".join(named.get("alt", "").split()),
                    "caption": "",
                    "context": " ".join(" ".join(self._text).split())[-CONTEXT_CHARS:],
                }
            )

    def handle_endtag(self, tag: str) -> None:
        """Close a figure (giving its images the caption), caption or title.

        Args:
            tag: The tag.
        """
        if tag in ("script", "style", "noscript"):
            self._skip = max(0, self._skip - 1)
        elif tag == "title":
            self._in_title = False
        elif tag == "figcaption":
            self._in_caption = False
        elif tag == "picture":
            self._sources = []
        elif tag == "figure":
            caption = " ".join(" ".join(self._caption).split())
            for index in self._figure:
                self.images[index]["caption"] = caption
            self._figure = []

    def handle_data(self, data: str) -> None:
        """Keep text: the title, a caption, and the running page text.

        Args:
            data: The text.
        """
        if self._skip:
            return
        if self._in_title:
            self.title += data
            return
        if self._in_caption:
            self._caption.append(data)
        self._text.append(data)
        if len(self._text) > 200:
            self._text = self._text[-100:]


def page_images(html: str, base: str) -> tuple[str, list[PageImage]]:
    """The likely figures on a page, with the words around each.

    Args:
        html: The page's HTML.
        base: Its final URL, for relative addresses.

    Returns:
        The page's title, and its images that look like figures (raster,
        not furniture, not declared tiny), each once, in page order.
    """
    parser = _ImageParser(base)
    parser.feed(html)
    seen: set[str] = set()
    found: list[PageImage] = []
    for image in parser.images:
        url = image["url"]
        path = urllib.parse.urlsplit(url).path
        if url in seen or _FURNITURE.search(path) or not _RASTER.search(path):
            continue
        seen.add(url)
        found.append(PageImage(**image))
    return " ".join(parser.title.split()), found


def image_size(data: bytes) -> tuple[int, int] | None:
    """An image's width and height, read from its header.

    Args:
        data: The image bytes.

    Returns:
        ``(width, height)`` for a PNG, GIF, JPEG or WebP; None for anything
        else or a header too short to read.
    """
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        width, height = struct.unpack(">II", data[16:24])
        return width, height
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        width, height = struct.unpack("<HH", data[6:10])
        return width, height
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) >= 30:
        chunk = data[12:16]
        if chunk == b"VP8X":
            return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
        if chunk == b"VP8 ":
            width, height = struct.unpack("<HH", data[26:30])
            return width & 0x3FFF, height & 0x3FFF
        if chunk == b"VP8L":
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        return None
    if data[:2] == b"\xff\xd8":
        position = 2
        while position + 9 < len(data):
            if data[position] != 0xFF:
                position += 1
                continue
            marker = data[position + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height, width = struct.unpack(">HH", data[position + 5 : position + 9])
                return width, height
            length = struct.unpack(">H", data[position + 2 : position + 4])[0]
            position += 2 + length
        return None
    return None
