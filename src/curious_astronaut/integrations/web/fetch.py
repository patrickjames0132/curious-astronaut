"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
A guarded GET for URLs the app didn't choose (v8.24.0).

Lesson images fetch pages the web scout found, and then images those pages
point at: URLs written by strangers. Every other fetch in the codebase goes
to a known host (S2, OpenAlex, arXiv) or to a URL the reader typed, so none
needed a guard. This one does, because a page can name any address, and a
server that fetches whatever a page names can be steered at the machine's
own services (the classic server-side request forgery).

So ``safe_get`` allows http(s) only, resolves the host and refuses any
address that isn't public (loopback, the private and link-local ranges, the
cloud metadata address), checks every redirect hop the same way, and caps
the size and the time. The check runs before the connection rather than on
it, so a DNS answer that changes between the two (rebinding) could slip
through; for a local, single-user install that is an accepted gap, named
here so a hosted deploy closes it first.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import ipaddress
import socket
import urllib.error
import urllib.parse
import urllib.request
from http.client import HTTPMessage
from typing import IO

#: Who we say we are. Some image hosts refuse an empty user agent.
USER_AGENT = "curious-astronaut/1.1 (+https://github.com/patrickjames0132/curious-astronaut)"

#: Seconds before a fetch gives up.
TIMEOUT = 12

#: The most redirects followed.
MAX_REDIRECTS = 4


class UnsafeUrl(ValueError):
    """A URL that may not be fetched: not http(s), or not a public address."""


def check_url(url: str) -> None:
    """Refuse a URL that isn't http(s) to a public address.

    Args:
        url: The URL.

    Raises:
        UnsafeUrl: When it may not be fetched, saying why.
    """
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UnsafeUrl(f"not an http(s) URL: {url[:100]}")
    try:
        answers = socket.getaddrinfo(parts.hostname, parts.port or None)
    except socket.gaierror as error:
        raise UnsafeUrl(f"no such host: {parts.hostname}") from error
    for answer in answers:
        address = ipaddress.ip_address(answer[4][0])
        if not address.is_global:
            raise UnsafeUrl(f"{parts.hostname} is not a public address ({address})")


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only to a URL that passes ``check_url``."""

    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: IO[bytes],
        code: int,
        msg: str,
        headers: HTTPMessage,
        newurl: str,
    ) -> urllib.request.Request | None:
        """Check the next hop before following it.

        Args:
            req: The request being redirected.
            fp: The response body.
            code: The HTTP status.
            msg: The status message.
            headers: The response headers.
            newurl: Where it redirects to.

        Returns:
            The next request.
        """
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_CheckedRedirects)
_CheckedRedirects.max_redirections = MAX_REDIRECTS


def _read_capped(response: IO[bytes], max_bytes: int) -> bytes:
    """Read a body, refusing one past the cap.

    Args:
        response: The open response.
        max_bytes: The most to accept.

    Returns:
        The body.

    Raises:
        ValueError: When the body is larger than ``max_bytes``.
    """
    body = response.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise ValueError(f"response larger than {max_bytes} bytes")
    return body


def safe_get(url: str, *, max_bytes: int, accept: str = "*/*") -> tuple[bytes, str, str]:
    """GET a URL the app didn't choose, guarded.

    Args:
        url: The URL.
        max_bytes: The largest body accepted.
        accept: The ``Accept`` header.

    Returns:
        The body, its content type (lower-cased, parameters dropped), and the
        final URL after redirects (for resolving relative links).

    Raises:
        UnsafeUrl: For a URL, or a redirect, that may not be fetched.
        ValueError: For a body past ``max_bytes``.
        urllib.error.URLError: On network and HTTP failures.
    """
    check_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with _OPENER.open(request, timeout=TIMEOUT) as response:
        body = _read_capped(response, max_bytes)
        content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return body, content_type, response.geturl()
