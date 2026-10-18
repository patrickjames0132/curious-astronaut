"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
A page's likely figures: lazy-loaded and srcset addresses resolved, the
figure caption and the text before each kept, page furniture and tiny or
vector images dropped; and an image's size read from its header.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import struct

from curious_astronaut.integrations.web import image_size, page_images

PAGE = """
<html><head><title> Markov decision processes — Notes </title>
<script>var img = "<img src='/ignored.png'>";</script></head>
<body>
<img src="/static/logo.png" alt="Site logo">
<p>An MDP is a loop between an agent and its environment.</p>
<figure>
  <img data-src="figures/loop.png" src="data:image/gif;base64,R0l" alt="The agent-environment loop">
  <figcaption>Figure 1: The agent acts, the environment answers.</figcaption>
</figure>
<p>The transition graph below has two states.</p>
<img srcset="graph-small.jpg 320w, graph-large.jpg 1200w" alt="Transition graph">
<img src="tiny.png" width="16" height="16">
<img src="diagram.svg" alt="A vector diagram">
<img src="figures/loop.png" alt="The same loop again">
</body></html>
"""


def test_a_page_lists_its_figures_with_their_words():
    title, images = page_images(PAGE, "https://notes.example/rl/mdp.html")
    assert title == "Markov decision processes — Notes"
    assert [image.url for image in images] == [
        "https://notes.example/rl/figures/loop.png",
        "https://notes.example/rl/graph-large.jpg",
    ]
    loop, graph = images
    assert loop.alt == "The agent-environment loop"
    assert loop.caption == "Figure 1: The agent acts, the environment answers."
    assert loop.context.endswith("An MDP is a loop between an agent and its environment.")
    assert graph.caption == ""
    assert "transition graph below" in graph.context


def _png(width: int, height: int) -> bytes:
    """A PNG header of this size.

    Args:
        width: Its width.
        height: Its height.

    Returns:
        The header bytes.
    """
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", width, height)


def test_an_image_size_comes_from_its_header():
    assert image_size(_png(640, 480)) == (640, 480)
    assert image_size(b"GIF89a" + struct.pack("<HH", 300, 200)) == (300, 200)
    jpeg = (
        b"\xff\xd8"
        + b"\xff\xe0" + struct.pack(">H", 16) + b"\x00" * 14
        + b"\xff\xc0" + struct.pack(">H", 17) + b"\x08" + struct.pack(">HH", 360, 720)
        + b"\x00" * 10
    )
    assert image_size(jpeg) == (720, 360)
    webp = b"RIFF" + b"\x00" * 4 + b"WEBPVP8X" + b"\x00" * 8 + (799).to_bytes(3, "little") + (599).to_bytes(3, "little")
    assert image_size(webp) == (800, 600)
    assert image_size(b"<svg></svg>") is None


def test_the_largest_size_wins_and_only_the_path_marks_furniture():
    page = (
        '<img src="small.png" srcset="small.png 1x, large.png 2x" alt="A diagram">'
        '<picture><source srcset="pic-400.webp 400w, pic-1200.webp 1200w">'
        '<img src="pic-200.webp" alt="A picture"></picture>'
        '<img src="figure.png?utm_content=thumbnail" alt="Kept">'
        '<img src="assets\\diagram.png" alt="Windows path">'
        '<img src="/icons/logo.png" alt="Dropped">'
    )
    _, found = page_images(page, "https://notes.example/post/")
    assert [image.url for image in found] == [
        "https://notes.example/post/large.png",
        "https://notes.example/post/pic-1200.webp",
        "https://notes.example/post/figure.png?utm_content=thumbnail",
        "https://notes.example/post/assets/diagram.png",
    ]
