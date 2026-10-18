"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Inline lesson images (v8.24.0): the tools a tutor writing a lesson uses to
find real images and place them in its prose, each credited and described.

**The lesson stays the model's own** (Patrick, 2026-10-17): it teaches from
what it knows and cites nothing. These tools ground the *pictures*, not the
prose: the tutor asks for the picture a paragraph needs, looks at what comes
back, and places one where it belongs, writing the paragraph around it. So
an image is chosen by the same writing that explains it, and the reader is
told what to notice.

**Images aren't optional** (Patrick, 2026-10-17): left to choose, the tutor
searched in one lesson of four. ``must_show_an_image`` sends a lesson back
until it has searched and placed one, unless its searches came up with
nothing that shows the idea; with it, three lessons that had placed nothing
each placed a fitting image (the run the log lines below record).

How it got here, so it isn't re-tried: the first build wrote the lesson,
then searched once on the subject's name and had a second model fit images
into prose that never knew about them. Almost no lesson got an image. A dry
run for "Bellman equations" showed why: the name alone ranked Sutton &
Barto's backup diagrams sixth of seven in the reader's library (only three
reached the picker), the web gave one usable page, and the only papers
searched were the course paper's own, whose figures are results plots. The
tutor's own phrase for the picture it wants ("a backup diagram for the
Bellman optimality equation") is the fix, and it can only write that phrase
while it is writing the lesson.

Two tools, over ``LessonDeps``:

* ``find_images(what)`` searches for one picture everywhere at once, in the reader's
  **library** (the mined figures on or near the passages that match), on the
  **web** (Wikipedia's articles on the subject and on ``what``, read
  directly, then the web scout's pages, their images read with the words
  around them through the guarded fetch), and in **papers** (an S2/OpenAlex
  search on ``what`` and its hits' ar5iv figures whose captions match best,
  plus the course paper's own figures in the paper's own lesson only). The
  candidates come back numbered **with their pixels**, shrunk first, so the
  tutor sees each one.
* ``show_image(number, description)`` places one: it answers with the
  ``<<FIG n>>`` marker the tutor writes on its own line, and queues the
  image for the stream. An image keeps its own caption; the tutor's
  ``description`` is used only for one without a real caption (Patrick: one
  description per image, never two).

Why Wikipedia is read directly: a dry run found every Wikipedia figure had
been dropped as page furniture (its addresses end ``utm_content=thumbnail``),
and Medium refuses server-side fetches outright (403). Wikipedia's figures
are the canonical ones a lesson wants (KL divergence's two densities, the
MDP state diagram), captioned and free to reuse.

Every candidate carries the app URL the browser shows it from and a ``key``
the server reads its pixels by (``image_bytes``). A key only ever resolves to
an ar5iv image, a PDF token this server minted, a library source, or a web
image a search registered (``web_image_url``), so neither the browser nor the
model ever hands the server a URL to fetch. **A web image is never stored**,
only its address: ``/api/web_image/<handle>`` fetches it afresh each time,
as ``docs/pdf-mining.md`` settles for PDFs' images.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from pydantic_ai import BinaryContent, ModelRetry, RunContext, ToolReturn

from .... import optional
from ....integrations import arxiv, openalex, web
from ....integrations import semantic_scholar as s2
from ....services import pdf as pdf_service
from ....services import sources
from ....services.graph import Provider
from ....storage import cache
from ... import captions, streams
from ...workers.search import web as web_scout

log = logging.getLogger(__name__)

Origin = Literal["library", "paper", "web"]

#: How many searches one lesson may make when nothing says otherwise: the
#: tutor's ``image_searches`` knob sets it per lesson (``LessonDeps.searches``),
#: as the researcher's search limits are knobs.
SEARCHES = 4

#: How many candidates one search shows the tutor, and the share each source
#: is sure of, so none crowds out the rest (the web, with Wikipedia, always
#: has more than enough: a 4/3/5 cap once left no room for papers at all).
#: Slots a source can't fill go to the others in turn.
PER_SEARCH = 8
LIBRARY_SHARE = 3
PAPER_SHARE = 2
WEB_SHARE = 3

#: How many library passages are searched for figures nearby.
LIBRARY_PASSAGES = 6

#: How far from a matching passage a library figure may sit, in pages. A
#: textbook's figure is usually on the page that discusses it or the next.
PAGE_REACH = 1

#: How many papers a search reads figures from, besides the course paper, and
#: how many of each paper's figures (best caption match first) it keeps.
SEARCHED_PAPERS = 3
FIGURES_PER_PAPER = 2

#: How many pages a web search reads, and how many pictures from each.
WEB_PAGES = 5
IMAGES_PER_PAGE = 4

#: Wikipedia, read directly (no key, no scout): how many articles a search
#: reads, and how many of each article's figures (best caption match first).
#: Its figures are captioned, free to reuse, and drawn to explain the idea,
#: which is what a lesson wants: the MDP article's state diagram, the KL
#: divergence article's two densities.
WIKIPEDIA = "https://en.wikipedia.org"
WIKI_ARTICLES = 2
WIKI_FIGURES = 4

#: The longest caption the tutor is shown per candidate.
CAPTION_LIMIT = 300

#: The largest page and image fetched, in bytes.
PAGE_BYTES = 4_000_000
IMAGE_BYTES = 6_000_000

#: The longest side an image is shrunk to before the tutor sees it: enough to
#: read a diagram's labels, at a fraction of a full image's tokens.
SHRINK_SIDE = 768

#: Image types a vision model reads.
_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}

#: The cache prefix a web image's address is registered under, by handle.
_WEB_PREFIX = "webimg:"

_WORD = re.compile(r"[a-z0-9]+")


class Candidate(BaseModel):
    """One real image the tutor may place in a lesson."""

    model_config = ConfigDict(extra="forbid")

    key: str
    """How the server reads its pixels (``image_bytes``)."""
    origin: Origin
    image: str
    """The app URL the browser loads it from."""
    caption: str
    credit: str
    """Where it is from, as the card says it: a book's or paper's title, or a
    web page's."""
    page: int | None = None
    context: str = ""
    """Words near it on its page (web images), for the tutor only."""
    link: str | None = None
    """Where the credit leads: the web page, the paper's page, its PDF at the
    figure's page, or the reader's own book at it."""


class Step(BaseModel):
    """What the tutor is doing now: one status line for the panel."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["step"] = "step"
    text: str


class LessonImage(BaseModel):
    """A placed image, in the shape the frontend's ``AnswerFigure`` reads.

    ``slot`` pairs it with the ``<<FIG n>>`` marker in the lesson, exactly as
    an assistant answer's figures pair with theirs.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["image"] = "image"
    slot: int
    image: str
    caption: str
    label: str | None
    title: str
    link: str | None
    description: str
    origin: Origin


@dataclass
class LessonDeps:
    """One lesson's image run-state, shared by the tools and the stream loop.

    ``candidates`` numbers every image any search showed, across searches,
    so ``show_image`` names one by the number the tutor saw. ``queue`` is
    how a tool's steps and placed images reach the stream: tools push, the
    lesson's stream loop drains between run events.
    """

    subject: str
    paper_ref: str
    paper_title: str
    provider: Provider
    images_left: int
    paper_lesson: bool = False
    """The lesson is the course paper's own: only then are its figures offered
    (a concept lesson given them placed results plots)."""
    searches: int = SEARCHES
    """The lesson's search budget (the tutor's ``image_searches`` knob)."""
    searches_left: int = -1
    """What is left of it; starts at ``searches``."""
    paper_figures_offered: bool = False
    nudges: int = 0
    candidates: list[Candidate] = field(default_factory=list)
    pixels: dict[str, tuple[bytes, str]] = field(default_factory=dict)
    shown: dict[str, int] = field(default_factory=dict)
    images: list[LessonImage] = field(default_factory=list)
    queue: list[Step | LessonImage] = field(default_factory=list)

    def __post_init__(self) -> None:
        """Start the budget full unless told otherwise."""
        if self.searches_left < 0:
            self.searches_left = self.searches

    def emit(self, event: Step | LessonImage) -> None:
        """Queue a step or a placed image for the stream.

        Args:
            event: The event.
        """
        self.queue.append(event)

    def drain(self) -> list[Step | LessonImage]:
        """Take (and clear) everything queued since the last drain.

        Returns:
            The queued events, oldest first.
        """
        drained, self.queue = self.queue, []
        return drained


# --- Candidates ------------------------------------------------------------


def _words(text: str) -> set[str]:
    """The lower-cased words of a text, for a rough caption match.

    Args:
        text: Any text.

    Returns:
        Its words of three letters or more.
    """
    return {word for word in _WORD.findall(text.casefold()) if len(word) > 2}


def _is_caption(text: str) -> bool:
    """Whether some words read as a caption, not a file name or a stray label.

    A web image's only words are often its ``alt``, and an ``alt`` is often
    its file name (``maze_one_path``): that is no caption, so the tutor
    describes the image instead.

    Args:
        text: The caption or alt text.

    Returns:
        True for at least three words.
    """
    return len(text.split()) >= 3


def _by_match(candidates: list[Candidate], what: str) -> list[Candidate]:
    """Candidates ordered by how many of ``what``'s words their caption shares.

    Args:
        candidates: The candidates.
        what: The picture asked for.

    Returns:
        The best matches first; ties keep their order.
    """
    wanted = _words(what)
    return sorted(candidates, key=lambda candidate: -len(wanted & _words(candidate.caption)))


def _ar5iv_candidates(arxiv_id: str, title: str) -> list[Candidate]:
    """A paper's figures from its ar5iv render.

    Args:
        arxiv_id: The paper's arXiv id.
        title: Its title, for the credit.

    Returns:
        Its figures in order; none without a render (never raises).
    """
    try:
        rendered = arxiv.get_figures(arxiv_id)
    except Exception:
        log.warning("ar5iv figures failed for %s", arxiv_id, exc_info=True)
        return []
    candidates: list[Candidate] = []
    for figure in rendered.get("figures") or []:
        source = figure.get("image") or ""
        if not arxiv.is_ar5iv_url(source):
            continue
        candidates.append(
            Candidate(
                key=f"ar5iv:{source}",
                origin="paper",
                image="/api/figure_proxy?src=" + urllib.parse.quote(source, safe=""),
                caption=figure.get("caption") or "",
                credit=title,
                link=f"https://arxiv.org/abs/{arxiv_id}",
            )
        )
    return candidates


def _course_paper_candidates(paper_ref: str, provider: Provider, title: str) -> list[Candidate]:
    """The course paper's own figures: ar5iv's first, else its mined open-access PDF.

    Args:
        paper_ref: The paper's arXiv id, or its provider node id.
        provider: Who resolves a non-arXiv paper's PDF.
        title: The paper's title, for the credit.

    Returns:
        Its figures in order; none when it has neither source (never raises).
    """
    if arxiv.looks_arxiv(paper_ref):
        rendered = _ar5iv_candidates(paper_ref, title)
        if rendered:
            return rendered
    try:
        url = (
            pdf_service.arxiv_pdf_url(paper_ref)
            if arxiv.looks_arxiv(paper_ref)
            else pdf_service.resolve_oa_pdf(paper_ref, provider)
        )
        mined = pdf_service.get_pdf_floats(url) if url else {}
    except Exception:
        log.warning("PDF figures failed for %s", paper_ref, exc_info=True)
        return []
    token = mined.get("token")
    candidates: list[Candidate] = []
    for position, entry in enumerate(mined.get("floats") or []):
        if entry.get("kind", "figure") != "figure":
            continue  # a table or an algorithm box is no picture
        candidates.append(
            Candidate(
                key=f"pdf:{token}:{position}",
                origin="paper",
                image=f"/api/pdf_figure/{token}/{position}",
                caption=entry.get("caption") or "",
                credit=title,
                page=entry.get("page"),
                link=f"{url}#page={entry['page']}" if entry.get("page") else url,
            )
        )
    return candidates


def _searched_paper_candidates(what: str, subject: str, provider: Provider) -> list[Candidate]:
    """Figures from papers on the subject, best caption match to ``what`` first.

    The search is on the subject: a paper search on a long picture
    description ("a diagram of two distributions…") finds noise, while the
    subject finds the papers about the idea, whose figures ``what`` then
    ranks. Only papers with an ar5iv render: mining a PDF per hit would cost
    a download and a parse each, for one picture.

    Args:
        what: The picture asked for.
        subject: The lesson's subject, which the search is on.
        provider: Which corpus to search.

    Returns:
        Up to ``FIGURES_PER_PAPER`` figures from each of the first
        ``SEARCHED_PAPERS`` papers with a render; none on any failure.
    """
    try:
        if provider == "openalex":
            hits = openalex.search_papers(subject, limit=10)
        else:
            hits = [hit.get("node", hit) for hit in s2.search_papers(subject, limit=10)]
    except Exception:
        log.warning("paper search for images failed: %r", what, exc_info=True)
        return []
    found: list[Candidate] = []
    read = 0
    for hit in hits:
        arxiv_id = hit.get("arxiv_id")
        if not arxiv_id or read >= SEARCHED_PAPERS:
            continue
        figures = _ar5iv_candidates(arxiv_id, hit.get("title") or "A paper")
        if figures:
            read += 1
            found.extend(_by_match(figures, what)[:FIGURES_PER_PAPER])
    return found


def _library_candidates(what: str) -> list[Candidate]:
    """Figures from the reader's library near the passages that match.

    Args:
        what: The picture asked for.

    Returns:
        Figures on or near the best passages' pages, best passage first, each
        once; none without a library or the ``sources`` extra (never raises).
    """
    try:
        passages = sources.search(what, top_k=LIBRARY_PASSAGES)
    except Exception:
        log.warning("library search for images failed", exc_info=True)
        return []
    candidates: list[Candidate] = []
    seen: set[str] = set()
    for passage in passages:
        source_id = passage["source_id"]
        try:
            entries = sources.get_source_figures(source_id).get("floats") or []
        except Exception:
            log.warning("figure manifest failed for %s", source_id, exc_info=True)
            continue
        nearby = sorted(
            (
                (abs(entry["page"] - passage["page"]), position, entry)
                for position, entry in enumerate(entries)
                if entry.get("kind", "figure") == "figure"
                and abs(entry["page"] - passage["page"]) <= PAGE_REACH
            ),
            key=lambda found: found[0],
        )
        for _, position, entry in nearby:
            key = f"library:{source_id}:{position}"
            if key in seen:
                continue
            seen.add(key)
            candidates.append(
                Candidate(
                    key=key,
                    origin="library",
                    image=f"/api/sources/{source_id}/figure/{position}",
                    caption=entry.get("caption") or "",
                    credit=passage.get("source_title") or "Your library",
                    page=entry["page"],
                    link=f"/api/sources/{source_id}/pdf#page={entry['page']}",
                )
            )
    return candidates


def _web_handle(url: str) -> str:
    """The opaque handle a web image is known by.

    Args:
        url: The image's address.

    Returns:
        16 hex characters.
    """
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def web_image_url(handle: str) -> str | None:
    """The address behind a web image's handle, if a search registered it.

    The proxy only fetches what a search found and recorded here; a handle
    the server never issued names nothing, so the browser can't steer a
    fetch.

    Args:
        handle: The handle in ``/api/web_image/<handle>``.

    Returns:
        The image URL, or None for an unknown handle.
    """
    entry = cache.get(_WEB_PREFIX + handle)
    return entry.get("url") if isinstance(entry, dict) else None


def _read_page(url: str) -> tuple[str, str, list[web.PageImage]]:
    """A page's title and likely images, or nothing when it can't be read.

    Args:
        url: The page.

    Returns:
        Its final URL, its title, and up to ``IMAGES_PER_PAGE`` images, the
        captioned and described ones first.
    """
    try:
        body, content_type, final = web.safe_get(url, max_bytes=PAGE_BYTES, accept="text/html")
    except Exception as error:
        # Expected often (a 404, a page past the cap, a host that's gone): one
        # line, no traceback.
        log.info("web page unreadable: %s (%s)", url, error)
        return url, "", []
    if "html" not in content_type:
        return final, "", []
    title, images = web.page_images(body.decode("utf-8", errors="replace"), final)
    ranked = sorted(images, key=lambda image: (not image.caption, not image.alt))
    return final, title, ranked[:IMAGES_PER_PAGE]


def _read_image(url: str) -> tuple[bytes, str] | None:
    """An image's bytes, when it is a raster large enough to teach from.

    Args:
        url: The image.

    Returns:
        Its bytes and media type, or None.
    """
    try:
        body, content_type, _ = web.safe_get(url, max_bytes=IMAGE_BYTES, accept="image/*")
    except Exception as error:
        log.info("web image unreadable: %s (%s)", url, error)
        return None
    size = web.image_size(body)
    if content_type not in _IMAGE_TYPES or size is None or min(size) < web.images.MIN_SIDE:
        return None
    return body, content_type


def _downloaded(
    found: list[tuple[str, str, web.PageImage]], pixels: dict[str, tuple[bytes, str]]
) -> list[Candidate]:
    """Download found web images, keep the teachable ones, and register each.

    Args:
        found: Each image with the page it is on and the credit to give it.
        pixels: Filled with each kept image's bytes, so it isn't downloaded
            twice.

    Returns:
        The kept images as candidates, in order.
    """
    with ThreadPoolExecutor(max_workers=8) as pool:
        downloaded = list(pool.map(lambda entry: _read_image(entry[2].url), found))
    candidates: list[Candidate] = []
    for (page, credit, image), data in zip(found, downloaded):
        if data is None:
            continue
        handle = _web_handle(image.url)
        cache.set(_WEB_PREFIX + handle, {"url": image.url, "page": page, "title": credit})
        key = f"web:{handle}"
        pixels[key] = data
        candidates.append(
            Candidate(
                key=key,
                origin="web",
                image=f"/api/web_image/{handle}",
                caption=image.caption or image.alt,
                credit=credit,
                context=image.context,
                link=page,
            )
        )
    return candidates


def _wikipedia_titles(query: str) -> list[str]:
    """The Wikipedia articles a search finds for a query.

    Args:
        query: What to look for.

    Returns:
        Up to ``WIKI_ARTICLES`` titles, best first; none on any failure.
    """
    params = urllib.parse.urlencode(
        {"action": "query", "list": "search", "srsearch": query, "srlimit": WIKI_ARTICLES, "format": "json"}
    )
    try:
        body, _, _ = web.safe_get(
            f"{WIKIPEDIA}/w/api.php?{params}", max_bytes=500_000, accept="application/json"
        )
        hits = json.loads(body).get("query", {}).get("search", [])
    except Exception as error:
        log.info("wikipedia search failed for %r (%s)", query, error)
        return []
    return [hit["title"] for hit in hits if isinstance(hit, dict) and hit.get("title")]


def _wikipedia_candidates(
    what: str, subject: str, pixels: dict[str, tuple[bytes, str]]
) -> list[Candidate]:
    """Figures from the Wikipedia articles on the subject and on ``what``.

    The subject's own article comes first (it holds the canonical diagram),
    then the best article for the picture asked for; each article's figures
    are ranked by how well their captions match.

    Args:
        what: The picture asked for.
        subject: The lesson's subject.
        pixels: Filled with each kept image's bytes.

    Returns:
        The candidates; none on any failure (never raises).
    """
    titles = list(dict.fromkeys(_wikipedia_titles(subject)[:1] + _wikipedia_titles(what)[:1]))
    wanted = _words(f"{what} {subject}")
    found: list[tuple[str, str, web.PageImage]] = []
    for title in titles:
        slug = urllib.parse.quote(title.replace(" ", "_"), safe="")
        article = f"{WIKIPEDIA}/wiki/{slug}"
        try:
            body, _, final = web.safe_get(
                f"{WIKIPEDIA}/api/rest_v1/page/html/{slug}", max_bytes=PAGE_BYTES, accept="text/html"
            )
        except Exception as error:
            log.info("wikipedia article unreadable: %s (%s)", title, error)
            continue
        _, figures = web.page_images(body.decode("utf-8", errors="replace"), final)
        ranked = sorted(
            (figure for figure in figures if figure.caption or figure.alt),
            key=lambda figure: -len(wanted & _words(figure.caption or figure.alt)),
        )
        found.extend((article, f"Wikipedia: {title}", figure) for figure in ranked[:WIKI_FIGURES])
    return _downloaded(found, pixels)


def _web_candidates(
    what: str, subject: str, pixels: dict[str, tuple[bytes, str]]
) -> list[Candidate]:
    """Images found on the web for ``what``: Wikipedia's first, then the scout's pages.

    Args:
        what: The picture asked for.
        subject: The lesson's subject, for context in the search.
        pixels: Filled with each kept image's bytes, so it isn't downloaded
            twice.

    Returns:
        The candidates; none when nothing is found (the scout degrades to
        no pages on its own failures, never raising).
    """
    wikipedia = _wikipedia_candidates(what, subject, pixels)
    need = (
        f"Pages with a clear diagram or illustration of {what} (lesson: {subject}). "
        "Prefer lecture notes, textbooks, course pages and explainer blogs."
    )
    findings = streams.run(web_scout.scout(need))
    pages = [
        source.url for source in findings.sources if "wikipedia.org" not in source.url
    ][:WEB_PAGES]
    if not pages:
        return wikipedia
    with ThreadPoolExecutor(max_workers=8) as pool:
        read = list(pool.map(_read_page, pages))
    found = [
        (final, title or urllib.parse.urlsplit(final).hostname or "the web", image)
        for final, title, images in read
        for image in images
    ]
    return wikipedia + _downloaded(found, pixels)


def image_bytes(key: str) -> tuple[bytes, str]:
    """A candidate's pixels, read server-side by its key.

    Safe on any key: ``ar5iv:`` only fetches ar5iv's own host, ``pdf:`` only
    renders a token this server minted when it mined the PDF, ``library:``
    only a stored source, and ``web:`` only an image a search registered
    (then through the guarded fetch); anything else is refused.

    Args:
        key: The candidate's ``key``.

    Returns:
        The image bytes and their media type.

    Raises:
        ValueError: For a key of no known kind, an unknown web handle, or a
            web image that is gone or no longer an image.
        Exception: Fetch and render failures propagate.
    """
    kind, _, rest = key.partition(":")
    if kind == "ar5iv" and arxiv.is_ar5iv_url(rest):
        return arxiv.fetch_image(rest)
    if kind == "pdf":
        token, _, position = rest.rpartition(":")
        return pdf_service.render_figure(token, int(position)), "image/png"
    if kind == "web":
        url = web_image_url(rest)
        if url is None:
            raise ValueError(f"unknown web image {rest!r}")
        data = _read_image(url)
        if data is None:
            raise ValueError(f"web image unreadable: {url}")
        return data
    if kind == "library":
        source_id, _, position = rest.rpartition(":")
        return sources.render_source_figure(source_id, int(position)), "image/png"
    raise ValueError(f"unknown image key {key!r}")


def shrink(data: bytes, media_type: str) -> tuple[bytes, str]:
    """An image no wider or taller than ``SHRINK_SIDE``, for the tutor's eyes.

    Uses PyMuPDF (the ``pdf`` extra) when it is installed; without it, or for
    a format it can't read, the image goes as it is, which costs tokens, not
    correctness.

    Args:
        data: The image.
        media_type: Its type.

    Returns:
        The shrunk PNG, or the image unchanged.
    """
    size = web.image_size(data)
    if size is None or max(size) <= SHRINK_SIDE or not optional.available("pdf"):
        return data, media_type
    try:
        fitz = optional.require("fitz", "pdf")
        pixmap = fitz.Pixmap(data)
        if pixmap.alpha:
            pixmap = fitz.Pixmap(pixmap, 0)  # drop alpha: an RGB PNG
        factor = SHRINK_SIDE / max(pixmap.width, pixmap.height)
        scaled = fitz.Pixmap(pixmap, int(pixmap.width * factor), int(pixmap.height * factor))
        return scaled.tobytes("png"), "image/png"
    except Exception:
        log.info("could not shrink a %s image", media_type, exc_info=True)
        return data, media_type


# --- The tools -------------------------------------------------------------

def _gather(deps: LessonDeps, what: str) -> list[Candidate]:
    """One search's candidates from every source, new ones only, each sure of its share.

    Every search looks everywhere: left to choose, the tutor named one or two
    places a search, the web most, and the reader's library and papers were
    rarely seen. No source outranks another (Patrick, 2026-10-17: the tutor
    judges which suit the lesson), so they are interleaved, one from each in
    turn, and the list's order favours none.

    Args:
        deps: The lesson's run-state.
        what: The picture asked for.

    Returns:
        At most ``PER_SEARCH`` candidates not shown in an earlier search.
    """
    offered = {candidate.key for candidate in deps.candidates}

    def unseen(found: list[Candidate]) -> list[Candidate]:
        """The candidates not offered before, each once.

        Args:
            found: One source's candidates.

        Returns:
            Those not yet offered, in order.
        """
        kept = [candidate for candidate in found if candidate.key not in offered]
        offered.update(candidate.key for candidate in kept)
        return kept

    library = unseen(_library_candidates(what))
    papers: list[Candidate] = []
    if deps.paper_lesson and deps.paper_ref and not deps.paper_figures_offered:
        deps.paper_figures_offered = True
        own = _course_paper_candidates(deps.paper_ref, deps.provider, deps.paper_title)
        papers.extend(_by_match(own, what)[:2])
    papers = unseen(papers + _searched_paper_candidates(what, deps.subject, deps.provider))
    online = unseen(_web_candidates(what, deps.subject, deps.pixels))
    # Each source's share first, then whatever room is left, a slot to each in turn.
    shares = [(library, LIBRARY_SHARE), (papers, PAPER_SHARE), (online, WEB_SHARE)]
    taken = [found[:share] for found, share in shares]
    room = PER_SEARCH - sum(len(chosen) for chosen in taken)
    while room > 0:
        grew = False
        for (found, _), chosen in zip(shares, taken):
            if room > 0 and len(chosen) < len(found):
                chosen.append(found[len(chosen)])
                room -= 1
                grew = True
        if not grew:
            break
    # One line per search, so a lesson that placed nothing says whether it
    # found nothing or turned down what it found.
    log.info(
        "lesson images %r: find %r: library=%d papers=%d web=%d",
        deps.subject,
        what,
        len(library),
        len(papers),
        len(online),
    )
    deepest = max((len(chosen) for chosen in taken), default=0)
    return [chosen[rank] for rank in range(deepest) for chosen in taken if rank < len(chosen)]


def _origin_label(candidate: Candidate) -> str:
    """Where a candidate comes from, as the tutor is told it.

    Args:
        candidate: The candidate.

    Returns:
        E.g. "the reader's library: Sutton & Barto, p.87".
    """
    origin = {"library": "the reader's library", "paper": "a paper", "web": "a web page"}
    page = f", p.{candidate.page}" if candidate.page else ""
    return f"{origin[candidate.origin]}: {candidate.credit}{page}"


def find_images(ctx: RunContext[LessonDeps], what: str) -> ToolReturn | str:
    """Search for real images of one specific thing the lesson explains, and
    look at them. Ask for the picture itself, not just the subject: "a backup
    diagram for the Bellman optimality equation", "a plot of gradient
    descent overshooting with too large a learning rate". It looks in the
    reader's own library, research papers and the web (Wikipedia, lecture
    notes, explainers) at once; you will see each candidate with its caption
    and where it is from. Place one with show_image only if it truly shows
    what your paragraph explains.

    Args:
        ctx: The run context carrying the lesson's image state (framework-injected).
        what: The picture you want, described specifically.

    Returns:
        The candidates, numbered, with their images; or a message when the
        search budget is spent or nothing usable was found.
    """
    deps = ctx.deps
    what = what.strip()
    if not what:
        return "Say what picture you want."
    if deps.searches_left <= 0:
        return "No image searches left: write the rest of the lesson with what you have."
    deps.searches_left -= 1
    shown: list[tuple[int, Candidate, tuple[bytes, str]]] = []
    for candidate in _gather(deps, what):
        try:
            data, media_type = deps.pixels.get(candidate.key) or image_bytes(candidate.key)
        except Exception:
            log.warning("image unreadable: %s", candidate.key, exc_info=True)
            continue
        deps.candidates.append(candidate)
        shown.append((len(deps.candidates), candidate, shrink(data, media_type)))
    if not shown:
        deps.emit(Step(text=f"No images of {what} found"))
        return f"No usable images of {what} in the library, papers or on the web."
    count = len(shown)
    deps.emit(Step(text=f"Looking at {count} image{'s' if count != 1 else ''}…"))
    content: list[str | BinaryContent] = []
    for number, candidate, (data, media_type) in shown:
        caption = candidate.caption[:CAPTION_LIMIT] if _is_caption(candidate.caption) else "(no caption)"
        near = f" Near it on the page: {candidate.context}" if candidate.context else ""
        content.append(f"[{number}] From {_origin_label(candidate)}. Caption: {caption}.{near}")
        content.append(BinaryContent(data=data, media_type=media_type))
    numbers = ", ".join(str(number) for number, _, _ in shown)
    return ToolReturn(
        return_value=(
            f"{count} candidate image(s) for {what}, numbered {numbers}, shown below. "
            "Place one with show_image only if it truly shows what your paragraph explains."
        ),
        content=content,
    )


def show_image(ctx: RunContext[LessonDeps], number: int, description: str = "") -> str:
    """Place one of the images find_images showed you in the lesson. The
    result gives you a <<FIG n>> marker: put it on its own line right after
    the paragraph the image illustrates, and write that paragraph so it
    points the reader at it.

    Args:
        ctx: The run context carrying the lesson's image state (framework-injected).
        number: The candidate's number, as find_images showed it.
        description: Only for an image shown "(no caption)": one or two plain
            sentences saying what it shows, describing only what is really in
            it (LaTeX between $…$ for notation). An image with a caption keeps
            its own, so leave this out.

    Returns:
        The marker to place, or a message when the number is wrong or the
        image budget is spent.
    """
    deps = ctx.deps
    if not 1 <= number <= len(deps.candidates):
        return f"No image {number}: use a number find_images showed you."
    candidate = deps.candidates[number - 1]
    if candidate.key in deps.shown:
        return f"Image {number} is already placed: its marker is <<FIG {deps.shown[candidate.key]}>>."
    if deps.images_left <= 0:
        return "No images left for this lesson: write the rest without more."
    deps.images_left -= 1
    slot = len(deps.images) + 1
    deps.shown[candidate.key] = slot
    label, caption = captions.split_label(candidate.caption)
    page = f", p. {candidate.page}" if candidate.page else ""
    # One description per image (Patrick): its own caption when it has one,
    # the tutor's words only when it has none.
    captioned = _is_caption(caption) or (bool(label) and bool(caption.strip()))
    description = "" if captioned else description.strip()
    placed = LessonImage(
        slot=slot,
        image=candidate.image,
        caption=caption if captioned else "",
        label=label or ("Image" if candidate.origin == "web" else None),
        title=f"{candidate.credit}{page}",
        link=candidate.link,
        description=description,
        origin=candidate.origin,
    )
    deps.images.append(placed)
    log.info("lesson images %r: placed %s from %s", deps.subject, candidate.key, candidate.credit)
    deps.emit(placed)
    deps.emit(Step(text=f"Placing an image from {candidate.credit}…"))
    return (
        f"Placed. Put the marker <<FIG {slot}>> on its own line right after the "
        "paragraph this image illustrates."
    )


#: What a lesson that tried to finish without searching is told.
SEARCH_FIRST = (
    "Search before you write: call find_images for the picture that would most "
    "help a reader see this idea, look at what comes back, and place the best one "
    "with show_image. Then write the lesson around it."
)

#: What a lesson that searched but placed nothing is told, while it can search.
PLACE_ONE = (
    "Every lesson shows at least one image. Place the candidate that best shows "
    "the idea with show_image, or call find_images again with a different "
    "description (another kind of picture, or the idea's best-known diagram) and "
    "place the best of those. Then write the lesson around it."
)

#: How many times one lesson is sent back, at most: then it is kept as it is.
NUDGES = 3


def send_back(deps: LessonDeps) -> str | None:
    """Why a lesson finishing now would be sent back, or None when it would be kept.

    The one rule both ``must_show_an_image`` (which enforces it) and the
    stream (which decides, as a draft starts, whether its text may reach the
    page) read, so the two can't disagree: whether a draft is kept depends
    only on what the tools did before it, never on its text.

    Args:
        deps: The lesson's image run-state.

    Returns:
        ``SEARCH_FIRST`` or ``PLACE_ONE``; None once it holds an image, can't
        get one, or has been sent back ``NUDGES`` times.
    """
    if deps.images or deps.nudges >= NUDGES:
        return None
    if deps.searches_left == deps.searches:
        return SEARCH_FIRST
    if deps.searches_left > 0 or deps.candidates:
        return PLACE_ONE
    return None  # every search came back empty: nothing to place


def must_show_an_image(ctx: RunContext[LessonDeps], output: Any) -> Any:
    """Send a lesson back until it has searched and placed an image.

    Left optional, the tutor searched in one lesson of four (2026-10-17, the
    log line ``_gather`` writes): it wrote from memory and never looked, and
    Patrick decided images aren't optional. So a lesson that never searched
    is sent to search, and one that searched but placed nothing is sent to
    place the best candidate or search again. It goes out without an image
    only when its searches are spent and nothing found showed the idea: a
    wrong image is worse than none. And never more than ``NUDGES`` times, so
    a model that won't comply still gives the waiting reader a lesson.

    Args:
        ctx: The run context carrying the lesson's image state.
        output: The lesson it tried to finish with.

    Returns:
        The lesson, once it holds an image or can't get one.

    Raises:
        ModelRetry: While it hasn't searched, or hasn't placed an image and
            still could.
    """
    reason = send_back(ctx.deps)
    if reason is None:
        return output
    ctx.deps.nudges += 1
    log.info("lesson images %r: no image yet; sent back (%d)", ctx.deps.subject, ctx.deps.nudges)
    raise ModelRetry(reason)


def pending_step(tool_name: str, args: dict[str, Any]) -> Step | None:
    """The status line for a tool the tutor just asked for, before it runs.

    Nothing reaches the stream while a tool runs (the stream loop drains
    between run events), and a search is the slowest thing in a lesson, so
    its line is said the moment the call is written, as the researcher's
    pending trace chips are.

    Args:
        tool_name: The tool called.
        args: Its arguments.

    Returns:
        The step for a search; None for anything else.
    """
    if tool_name != "find_images":
        return None
    what = args.get("what")
    if not isinstance(what, str) or not what.strip():
        return None
    return Step(text=f"Searching your library, papers and the web for {what.strip()}…")
