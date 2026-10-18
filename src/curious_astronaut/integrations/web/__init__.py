"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The open web as a source of pictures (v8.24.0), for a lesson's inline images.

Not a service with a host, unlike the other integrations: the pages come from
the web scout's search, and the images from those pages, so every URL here is
one the app didn't choose.

* ``fetch``  — ``safe_get``, a guarded GET (http(s) only, public addresses
  only, every redirect re-checked, size and time capped), and ``UnsafeUrl``.
* ``images`` — ``page_images`` (a page's likely figures, with their alt,
  caption and nearby text) and ``image_size`` (dimensions from the header).

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from .fetch import UnsafeUrl, check_url, safe_get
from .images import PageImage, image_size, page_images

__all__ = ["PageImage", "UnsafeUrl", "check_url", "image_size", "page_images", "safe_get"]
