"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The guarded GET: only http(s) to public addresses, every redirect re-checked,
and a body past the cap refused. No network: name resolution is stubbed.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import io

import pytest

from curious_astronaut.integrations.web import fetch


def _resolving(address: str):
    """A stand-in ``getaddrinfo`` answering every host with one address.

    Args:
        address: The address.

    Returns:
        The stand-in.
    """
    return lambda host, port: [(None, None, None, "", (address, 0))]


@pytest.mark.parametrize(
    "address",
    ["127.0.0.1", "10.0.0.5", "192.168.1.2", "169.254.169.254", "::1", "fd00::1"],
)
def test_a_private_or_local_address_is_refused(monkeypatch, address):
    monkeypatch.setattr(fetch.socket, "getaddrinfo", _resolving(address))
    with pytest.raises(fetch.UnsafeUrl):
        fetch.check_url("https://looks-public.example/figure.png")


def test_only_http_urls_to_a_public_address_pass(monkeypatch):
    monkeypatch.setattr(fetch.socket, "getaddrinfo", _resolving("93.184.215.14"))
    fetch.check_url("https://example.org/figure.png")
    for bad in ("file:///etc/passwd", "ftp://example.org/x", "gopher://x", "https:///nohost"):
        with pytest.raises(fetch.UnsafeUrl):
            fetch.check_url(bad)


def test_a_redirect_to_a_private_address_is_refused(monkeypatch):
    answers = {"public.example": "93.184.215.14", "internal.example": "10.1.2.3"}
    monkeypatch.setattr(
        fetch.socket,
        "getaddrinfo",
        lambda host, port: [(None, None, None, "", (answers[host], 0))],
    )
    handler = fetch._CheckedRedirects()
    with pytest.raises(fetch.UnsafeUrl):
        handler.redirect_request(None, None, 302, "Found", {}, "http://internal.example/admin")


def test_a_body_past_the_cap_is_refused():
    assert fetch._read_capped(io.BytesIO(b"x" * 10), 10) == b"x" * 10
    with pytest.raises(ValueError):
        fetch._read_capped(io.BytesIO(b"x" * 11), 10)
