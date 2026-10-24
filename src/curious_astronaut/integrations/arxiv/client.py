"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Shared HTTP transport for a paper's HTML render: arXiv's own (``arxiv.org/html``)
first, ar5iv (``ar5iv.labs.arxiv.org``) as the fallback (v8.39.0).

``figures.py``, ``fulltext.py`` and ``document.py`` each extract something
different from the same render, so the fetch (and its cache TTL) live here once
instead of one module reaching into the other's internals.

**Why arXiv first.** Both are LaTeXML renders with the same ``ltx_*`` markup, so
every parser here reads either unchanged. ar5iv was the only one for years, and
it is slow: on 2026-10-24 four fetches timed out at 30–150s. arXiv's own render
answered the same papers in about 0.05s, old ones included (1706.03762 from 2017,
1801.01290 from 2018). ar5iv stays as the fallback for a paper arXiv has no
render of. A paper whose LaTeX failed to convert in both (1412.6980, Adam) gets a
200 page with no body from each; ``fetch_render`` tries ar5iv when arXiv's page
has no body, and callers judge what comes back by content, not status.

A render carries the URL it came from, because the two sources write image paths
differently (arXiv's relative to ``/html/``, ar5iv's from the host root) and both
resolve correctly against their own page URL (``absolute_url``).

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from ...config import config

log = logging.getLogger(__name__)

AR5IV_HOST = "ar5iv.labs.arxiv.org"
BASE_URL = f"https://{AR5IV_HOST}"
#: arXiv's own HTML renders: https://arxiv.org/html/<id>.
ARXIV_HOST = "arxiv.org"
ARXIV_HTML_URL = f"https://{ARXIV_HOST}/html"
_USER_AGENT = {"User-Agent": "curious-astronaut/1.1 (https://github.com/patrickjames0132/curious-astronaut)"}
# ar5iv renders are static; cache figures/fulltext (and "not available" misses)
# for a month. Bump `refresh` on the caller to force a re-fetch.
CACHE_TTL = 60 * 60 * 24 * 30


@dataclass(frozen=True)
class Render:
    """A paper's HTML render, and the page URL it came from."""

    html: str
    #: The page's URL, which its relative image paths resolve against.
    url: str
    #: Who rendered it: ``"arXiv"`` or ``"ar5iv"``, as the Reader credits it.
    source: str


def has_body(html: str) -> bool:
    """Whether a render holds a paper rather than a failed conversion's stub.

    Args:
        html: The render.

    Returns:
        True when it has a section or an abstract (LaTeXML's markup).
    """
    return "ltx_section" in html or "ltx_abstract" in html


def fetch_render(arxiv_id: str) -> Render | None:
    """Fetch a paper's HTML render: arXiv's own first, then ar5iv.

    ar5iv is tried when arXiv has no render (404), fails, or serves a page
    with no body (a failed conversion's stub). When both have only a stub, the
    stub comes back, for the caller to read as unavailable.

    Args:
        arxiv_id: A bare arXiv id (version already stripped).

    Returns:
        The render, or None when neither source has one.

    Raises:
        urllib.error.HTTPError: On ar5iv's non-404 HTTP failures, once arXiv
            has failed too.
        urllib.error.URLError: On network failures reaching both.
    """
    quoted = urllib.parse.quote(arxiv_id)
    primary: Render | None = None
    try:
        url = f"{ARXIV_HTML_URL}/{quoted}"
        html = _fetch_page(url)
        if html is not None:
            primary = Render(html=html, url=url, source="arXiv")
            if has_body(html):
                return primary
    except (urllib.error.URLError, TimeoutError):
        log.warning("arXiv HTML fetch failed for %s; trying ar5iv", arxiv_id, exc_info=True)
    url = f"{BASE_URL}/html/{quoted}"
    try:
        html = _fetch_page(url)
    except (urllib.error.URLError, TimeoutError):
        if primary is not None:
            return primary  # arXiv's stub beats nothing
        raise
    if html is None:
        return primary
    fallback = Render(html=html, url=url, source="ar5iv")
    return fallback if has_body(html) or primary is None else primary


def fetch_html(arxiv_id: str) -> str | None:
    """Fetch a paper's HTML render, for callers that need only its text.

    Args:
        arxiv_id: A bare arXiv id (version already stripped).

    Returns:
        The render's HTML (arXiv's, else ar5iv's; see ``fetch_render``), or
        None when neither has one.

    Raises:
        urllib.error.HTTPError: On HTTP failures past both sources.
        urllib.error.URLError: On network failures reaching both.
    """
    render = fetch_render(arxiv_id)
    return render.html if render else None


def _fetch_page(url: str) -> str | None:
    """Fetch one render page.

    Args:
        url: The page's URL.

    Returns:
        The decoded HTML, or None on a 404.

    Raises:
        urllib.error.HTTPError: On non-404 HTTP failures.
        urllib.error.URLError: On network failures.
    """
    request = urllib.request.Request(url, headers=_USER_AGENT)
    try:
        with urllib.request.urlopen(request, timeout=config.providers.s2.timeout) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, "replace")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def absolute_url(src: str, page: str = BASE_URL + "/html/") -> str:
    """Absolutize a render's image src against the page it came from.

    Args:
        src: The raw ``src`` (or ``data``) attribute — absolute, host-relative
            (``/...``, ar5iv's style) or document-relative (arXiv's style,
            relative to ``/html/``).
        page: The render's page URL (``Render.url``); ar5iv's by default.

    Returns:
        An absolute URL (already-absolute URLs pass through).
    """
    return urllib.parse.urljoin(page, src)


def is_render_url(url: str) -> bool:
    """Check a URL against the figure proxy's allowlist.

    Args:
        url: The URL the browser asked the proxy to fetch.

    Returns:
        True only for https URLs on ar5iv's host, or under ``/html/`` on
        arXiv's: anything else is refused so the proxy can't be abused as an
        open relay (SSRF).
    """
    try:
        parts = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parts.scheme != "https":
        return False
    if parts.netloc == AR5IV_HOST:
        return True
    return parts.netloc == ARXIV_HOST and parts.path.startswith("/html/")


def fetch_image(url: str) -> tuple[bytes, str]:
    """Fetch a render's image for the same-origin proxy.

    The caller must allowlist the URL with ``is_render_url`` first — this
    function fetches whatever it's given.

    Args:
        url: An absolute render image URL (arXiv's or ar5iv's).

    Returns:
        A ``(bytes, content_type)`` tuple; the content type falls back to
        ``image/png`` when ar5iv doesn't declare one.

    Raises:
        urllib.error.HTTPError: On HTTP failures.
        urllib.error.URLError: On network failures.
    """
    request = urllib.request.Request(url, headers=_USER_AGENT)
    with urllib.request.urlopen(request, timeout=config.providers.s2.timeout) as response:
        return response.read(), response.headers.get_content_type() or "image/png"
