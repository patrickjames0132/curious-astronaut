"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Figures boxed in the Reader's text, as PNGs for the model (v8.48.0): only
render images the figure proxy would fetch, every one made a PNG (an SVG
plot rendered by pymupdf), and nothing fetched that isn't allowed.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from curious_astronaut.services.reader import figures

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20">'
    b'<rect width="40" height="20" fill="red"/></svg>'
)
RENDER = "https://arxiv.org/html/1801.01290v2/"


def test_a_source_is_unwrapped_from_the_proxy_and_held_to_its_allowlist():
    proxied = "/api/figure_proxy?src=https%3A%2F%2Farxiv.org%2Fhtml%2F1801.01290v2%2Fhopper.png"
    assert figures.figure_source(proxied) == RENDER + "hopper.png"
    assert figures.figure_source(RENDER + "hopper.png") == RENDER + "hopper.png"
    assert figures.figure_source("https://evil.example/x.png") is None
    assert figures.figure_source("/api/figure_proxy?src=http%3A%2F%2F169.254.169.254%2F") is None
    # Our path on someone else's host is not our proxy.
    assert figures.figure_source("https://evil.example/api/figure_proxy?src=x") is None


def test_figures_come_back_as_pngs_and_the_disallowed_are_never_fetched(monkeypatch):
    fetched = []
    served = {"plot.svg": (SVG, "image/svg+xml"), "photo.png": (PNG, "image/png")}

    def fake_fetch(url):
        fetched.append(url)
        name = url.rsplit("/", 1)[-1]
        if name not in served:
            raise OSError("404")
        return served[name]

    monkeypatch.setattr(figures.arxiv, "fetch_image", fake_fetch)
    images = figures.figure_pngs(
        [RENDER + "photo.png", "https://evil.example/x.png", RENDER + "plot.svg", RENDER + "gone.png", 7]
    )
    assert images[0] == PNG
    assert images[1].startswith(b"\x89PNG") and len(images) == 2
    assert fetched == [RENDER + "photo.png", RENDER + "plot.svg", RENDER + "gone.png"]


def test_figures_are_capped_and_skip_what_isnt_a_list(monkeypatch):
    monkeypatch.setattr(figures.arxiv, "fetch_image", lambda url: (PNG, "image/png"))
    assert len(figures.figure_pngs([RENDER + f"{index}.png" for index in range(9)])) == figures.MAX_FIGURES
    assert figures.figure_pngs("nope") == []


def test_without_the_pdf_extra_only_pngs_go(monkeypatch):
    monkeypatch.setattr(figures.optional, "available", lambda extra: False)
    monkeypatch.setattr(figures.arxiv, "fetch_image", lambda url: (SVG, "image/svg+xml"))
    assert figures.figure_pngs([RENDER + "plot.svg"]) == []
