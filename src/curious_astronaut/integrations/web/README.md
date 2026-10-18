# `integrations/web`

The open web as a source of **pictures** (v8.24.0), for a lesson's inline
images.
Unlike every other integration it has no host: the pages come from the web
scout's search (`agents/workers/search/web`), and the images from those
pages, so **every URL here is one the app didn't choose**. That is the
whole reason it is its own package.

```
web/
  fetch.py  — safe_get: the guarded GET, check_url, UnsafeUrl
  images.py — page_images: a page's likely figures with their words; image_size
```

## Why a guarded fetch

Every other fetch in the codebase goes to a known host (S2, OpenAlex, arXiv,
Hugging Face) or to a URL the reader typed into the library. These go to
addresses written by strangers, and a server that fetches whatever a page
names can be steered at the machine's own services (server-side request
forgery: `http://169.254.169.254/` is the cloud metadata service, and
`localhost` is this app). So `safe_get`:

- allows **http(s) only**;
- resolves the host and refuses any address that **isn't public**
  (`ipaddress.is_global`: loopback, the private and link-local ranges,
  unique-local IPv6);
- **re-checks every redirect hop** (`_CheckedRedirects`), at most four;
- caps the **size** (the caller says how much) and the **time** (12s).

The check runs *before* the connection, so a DNS answer that changes in
between (rebinding) could slip through. For a local, single-user install
that is an accepted gap, written down so a hosted deploy closes it first.

## Reading a page's pictures

A search returns pages, not images. `page_images` walks the HTML with the
standard library's `HTMLParser` (the codebase has no HTML library, and this
needs none) and keeps, for each `<img>`:

- its **address**: `data-src` / `data-original` (lazy loaders, whose `src`
  is a placeholder), then the largest `srcset` entry, then the largest of
  an enclosing `<picture>`'s `<source>`s, and only then `src`, which is often
  a thumbnail too small to keep (v8.24.0); resolved against the page's final
  URL, backslashes read as slashes (a page written on Windows); `data:`
  URIs are skipped;
- its **alt**, the **caption** of the `<figure>` around it, and the
  **text just before it** (240 characters): the words that let the tutor
  judge an image before looking at it.

Most images on a page aren't figures. Addresses whose **path** names page
furniture (logo, icon, avatar, sprite, badge, ads, social, thumbnails…;
the path only, since Wikipedia ends every figure's address with
`?utm_content=thumbnail`, which once dropped them all), images
declared under 100px, non-raster files (SVG: no size to check, usually an
icon, and not shown to a vision model) and repeats are dropped.
`image_size` then reads a downloaded image's real width and height from its
header (PNG, GIF, JPEG, WebP; no imaging library), so the caller can refuse
one under 200px a side.

## Who uses it

Only `agents/orchestrators/tutor/images.py`, which finds a written lesson's
images: it reads the scout's pages and their images through here, and keeps
nothing but each image's address (under an opaque handle the browser sees);
`/api/web_image/<handle>` fetches it afresh through `safe_get` each time.

Copied, with its tests, from the parked `feature/visuals` branch (2026-10-17),
where it was built for interactive visuals; lesson images reuse it as it was.

## Verified by

`test/curious_astronaut/integrations/web/`: `test_fetch.py` refuses every
private and local address (IPv4 and IPv6, the metadata address), non-http
schemes and a hostless URL, a redirect to a private address, and a body past
its cap, with name resolution stubbed (no network). `test_images.py` lists a
page's figures (a lazy-loaded one with its figure caption, the largest
`srcset` entry) with the text before each, drops the logo, the tiny image,
the SVG and the repeat, ignores markup inside a script, and reads sizes from
PNG, GIF, JPEG and WebP headers.
