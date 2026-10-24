"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
client: the shared render fetch (arXiv's HTML first, ar5iv as the fallback,
v8.39.0), the image proxy fetch, and its host allowlist.

urlopen is faked directly — no network.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import io
import urllib.error

import pytest

from curious_astronaut.integrations.arxiv import client


class _FakeResponse(io.BytesIO):
    def __init__(self, body: bytes, content_type: str | None = None, charset: str | None = None):
        super().__init__(body)
        self.headers = _FakeHeaders(content_type, charset)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeHeaders:
    def __init__(self, content_type: str | None, charset: str | None):
        self._content_type = content_type
        self._charset = charset

    def get_content_charset(self):
        return self._charset

    def get_content_type(self):
        return self._content_type


def test_fetch_html_returns_decoded_body(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda request, timeout=None: _FakeResponse("<p>hello</p>".encode(), charset="utf-8"),
    )
    assert client.fetch_html("2406.12345") == "<p>hello</p>"


def test_fetch_html_returns_none_on_404(monkeypatch):
    def raise_404(request, timeout=None):
        raise urllib.error.HTTPError("url", 404, "Not Found", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", raise_404)
    assert client.fetch_html("2406.12345") is None


def test_fetch_html_reraises_non_404(monkeypatch):
    def raise_500(request, timeout=None):
        raise urllib.error.HTTPError("url", 500, "Server Error", {}, None)

    monkeypatch.setattr("urllib.request.urlopen", raise_500)
    with pytest.raises(urllib.error.HTTPError):
        client.fetch_html("2406.12345")


def test_fetch_html_builds_the_ar5iv_url(monkeypatch):
    urls = []

    def fake_urlopen(request, timeout=None):
        urls.append(request.full_url)
        return _FakeResponse(b"ok", charset="utf-8")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client.fetch_html("hep-th/9901001")
    # arXiv's own render is asked first; "ok" has no body, so ar5iv next.
    # urllib.parse.quote's default safe="/" keeps old-style ids' slash literal.
    assert urls == [
        "https://arxiv.org/html/hep-th/9901001",
        f"{client.BASE_URL}/html/hep-th/9901001",
    ]


BODY = '<section class="ltx_section"><p>A paper.</p></section>'


def _pages(responses: dict, seen: list):
    """A fake urlopen serving one response per host.

    Args:
        responses: Host to a body, or to an exception to raise.
        seen: Collects the URLs asked for.

    Returns:
        The fake.
    """

    def fake_urlopen(request, timeout=None):
        seen.append(request.full_url)
        answer = responses[request.host]
        if isinstance(answer, BaseException):
            raise answer
        return _FakeResponse(answer.encode(), charset="utf-8")

    return fake_urlopen


def test_fetch_render_takes_arxivs_own_render_first(monkeypatch):
    seen: list = []
    monkeypatch.setattr("urllib.request.urlopen", _pages({"arxiv.org": BODY}, seen))
    render = client.fetch_render("1706.03762")
    assert render == client.Render(html=BODY, url="https://arxiv.org/html/1706.03762", source="arXiv")
    assert seen == ["https://arxiv.org/html/1706.03762"]  # ar5iv never asked


@pytest.mark.parametrize(
    "arxiv_answer",
    [
        urllib.error.HTTPError("url", 404, "Not Found", {}, None),  # no render
        urllib.error.URLError("down"),  # unreachable
        TimeoutError("slow"),
        "<html><p>See pages 1-last of main.pdf</p></html>",  # a failed conversion's stub
    ],
)
def test_fetch_render_falls_back_to_ar5iv(monkeypatch, arxiv_answer):
    seen: list = []
    monkeypatch.setattr(
        "urllib.request.urlopen", _pages({"arxiv.org": arxiv_answer, client.AR5IV_HOST: BODY}, seen)
    )
    render = client.fetch_render("1706.03762")
    assert render is not None and render.source == "ar5iv" and render.html == BODY
    assert render.url == f"{client.BASE_URL}/html/1706.03762"


def test_fetch_render_keeps_arxivs_stub_when_ar5iv_has_less(monkeypatch):
    stub = "<html><p>See pages 1-last of main.pdf</p></html>"
    seen: list = []
    monkeypatch.setattr(
        "urllib.request.urlopen",
        _pages(
            {"arxiv.org": stub, client.AR5IV_HOST: urllib.error.URLError("down")},
            seen,
        ),
    )
    render = client.fetch_render("1412.6980")
    assert render is not None and render.source == "arXiv" and render.html == stub


@pytest.mark.parametrize(
    "url,expected",
    [
        (f"https://{client.AR5IV_HOST}/html/2406.12345", True),
        ("https://arxiv.org/html/1706.03762v7/Figures/a.png", True),  # arXiv's render
        ("https://arxiv.org/abs/1706.03762", False),  # arXiv, but not a render
        ("https://arxiv.org.evil.example/html/a.png", False),  # lookalike host
        (f"http://{client.AR5IV_HOST}/html/2406.12345", False),  # not https
        ("https://evil.example.com/html/2406.12345", False),  # wrong host
        ("not a url at all: 🚫", False),  # unparseable
    ],
)
def test_is_render_url(url, expected):
    assert client.is_render_url(url) is expected


def test_fetch_image_returns_bytes_and_content_type(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda request, timeout=None: _FakeResponse(b"\x89PNG", content_type="image/jpeg"),
    )
    body, content_type = client.fetch_image(f"https://{client.AR5IV_HOST}/fig1.jpg")
    assert body == b"\x89PNG"
    assert content_type == "image/jpeg"


def test_fetch_image_defaults_content_type(monkeypatch):
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda request, timeout=None: _FakeResponse(b"\x89PNG", content_type=None),
    )
    _body, content_type = client.fetch_image(f"https://{client.AR5IV_HOST}/fig1.png")
    assert content_type == "image/png"
