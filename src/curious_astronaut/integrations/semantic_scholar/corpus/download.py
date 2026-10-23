"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Resumable downloader for the bulk Datasets shards.

The full corpus is ~300 GB across ~450 gzipped shards (citations ≈ 390 files,
papers ≈ 60), so a download runs for hours-to-days and *will* be interrupted.
This module makes that survivable:

* **Per-shard checkpoint** (``download.json``) records the byte count, the size
  the server advertised, and a done flag for each shard, so a rerun skips
  finished shards and resumes a partial one from where it stopped (HTTP
  ``Range``).
* **Partial shards** land in a ``.part`` file and are only renamed to the final
  ``.gz`` once the body is **provably complete** — a query/ingest never sees a
  truncated shard.
* **Signed-URL expiry** (a mid-download 403/416) triggers a fresh listing from
  :mod:`datasets` and a retry, so a days-long pull rides out expiring links.
* **A slow transfer is resumed on a freshly signed link.** S3 serves most
  shards at ~25 MB/s, but during the 2026-10-06 pull every run slowed to
  ~0.5–1.5 MB/s a few minutes after it started (after 3, 6 and 5 shards), and
  killing and restarting the command made it fast again at once. Reconnecting
  *inside* the process did not help, even though DNS (a 3-second TTL over many
  addresses) landed each new connection on a different S3 server: 3.5.81.12,
  16.15.45.234, 52.92.194.209, all slow. What a restart changes that a
  reconnect doesn't is the link. A new run re-lists the dataset, and every link
  carries a temporary AWS security token, so the working explanation is that a
  link slows a few minutes after it's issued. So a shard whose speed stays
  under :data:`_SLOW_BYTES_PER_SECOND` for :data:`_SLOW_WINDOW_SECONDS` is
  re-listed for a fresh link and resumed with a ``Range`` request,
  automatically, doing what a manual restart did.

**Why completeness is checked explicitly.** CPython's
``http.client.HTTPResponse.read(amt)`` does *not* raise ``IncompleteRead`` when
the connection dies mid-body: it returns ``b""`` and closes the connection, with
a comment in the stdlib saying it would like to raise but won't, for backwards
compatibility. A dropped socket is therefore byte-for-byte indistinguishable
from a clean EOF, so a downloader that trusts "read returned empty" happily
renames a half-shard into place and checkpoints it ``done``. That is exactly
what happened to a 2026-08-05 citations shard, which landed at 577 MB of a
1.07 GB body and only surfaced ~36 minutes into the *ingest*, as a DuckDB
"malformed JSON" error 355 shards deep (see docs/bugs.md). Every completed
transfer is now measured against ``Content-Length`` before the rename, and a
short read leaves the ``.part`` alone so the next attempt resumes the tail.

:func:`verify_release` is the audit for corpora downloaded before that guard
existed — the failure's quiet variant is a truncation landing exactly on a line
boundary, which ingests cleanly and silently drops rows.

Deliberately stdlib-only (``urllib``), matching the rest of the S2 client — no
new HTTP dependency for a job that's just streamed GETs with a ``Range`` header.
Invoked by the ``astronaut corpus download`` / ``astronaut corpus verify`` CLI; not on
any request path.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import gzip
import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import datasets
from .datasets import CorpusError
from .paths import DATASETS, ReleasePaths, corpus_root, release_paths

log = logging.getLogger(__name__)

#: Read size for streaming a shard to disk — 4 MiB keeps the syscall count low
#: on multi-hundred-MB shards without a large memory footprint.
_CHUNK_BYTES = 4 * 1024 * 1024

#: How many times a shard whose body arrived short is retried before the pull
#: gives up. Each retry resumes from the surviving ``.part`` via ``Range``, so
#: the cost of one is the missing tail, not the whole shard. Five is chosen for
#: a days-long pull over a flaky link: enough that a transient reset never ends
#: the run, few enough that a genuinely unservable shard fails visibly instead
#: of spinning.
_SHORT_READ_RETRIES = 5

#: The speed floor below which a connection is dropped and the shard resumed
#: on a fresh one, and the window it's measured over. 3 MB/s is an eighth of
#: S3's usual ~25 MB/s, so only a genuinely stuck connection trips it, and
#: 30 seconds keeps one slow patch from looking like a stuck connection.
_SLOW_BYTES_PER_SECOND = 3_000_000
_SLOW_WINDOW_SECONDS = 30.0

#: How many slow connections one shard may abandon before the speed floor is
#: lifted for it. If every connection is slow, the link itself is, and a slow
#: shard still beats a failed run: past this the shard finishes at whatever
#: speed it gets.
_SLOW_RESTARTS = 20

#: Progress callback: ``(dataset, filename, bytes_done, total_bytes)``. Fired as
#: each shard streams so the CLI can render a live per-shard bar; ``total_bytes``
#: is None when the server sends no ``Content-Length``.
ProgressFn = Callable[[str, str, int, int | None], None]

#: Whole-job progress: ``(unit, done, total)``, e.g. ``("shards", 12, 455)``.
#: Fired once the job's size is known and again as each unit finishes (skipped
#: ones included), so the CLI can draw the whole job beside the file streaming
#: now. Counts files, not bytes, because S2's listings carry no sizes; the
#: shards are similar enough (~1 GB each) for a count to track time.
OverallFn = Callable[[str, int, int], None]

#: Verify progress callback: ``(dataset, filename, index, total)``.
VerifyProgressFn = Callable[[str, str, int, int], None]


class _ShortRead(Exception):
    """A shard's body ended before ``Content-Length`` was satisfied.

    Private and always handled inside this module: it means "the socket died
    mid-shard", which is a retry, not a failure. Carries the counts so the log
    line can say how much of the shard actually arrived.
    """

    def __init__(self, received: int, expected: int) -> None:
        """Record how much of the body arrived against how much was promised.

        Args:
            received: Bytes actually written to the ``.part``.
            expected: Bytes the server's ``Content-Length`` promised.
        """
        super().__init__(f"body ended at {received} of {expected} bytes")
        self.received = received
        self.expected = expected


class _SlowConnection(Exception):
    """A connection stayed under the speed floor; resume on a fresh one.

    Raised from inside the transfer, so the ``.part`` keeps everything that
    arrived and the next attempt asks only for the rest.
    """

    def __init__(self, received: int, bytes_per_second: float) -> None:
        """Record where the transfer stood and how slow it was.

        Args:
            received: Bytes in the ``.part`` when the connection was dropped.
            bytes_per_second: The speed measured over the last window.
        """
        super().__init__(f"{bytes_per_second / 1e6:.2f} MB/s at {received} bytes")
        self.received = received
        self.bytes_per_second = bytes_per_second


@dataclass(frozen=True)
class ShardProblem:
    """One shard that failed verification.

    Attributes:
        dataset: ``"papers"`` or ``"citations"``.
        filename: The shard's stable ``.gz`` filename.
        kind: ``"missing"`` (not on disk), ``"short"`` (fewer bytes than the
            server advertises — the truncation this module now prevents), or
            ``"corrupt"`` (right size, but the gzip stream doesn't decode).
        detail: A human-readable explanation for the CLI to print.
        expected: The size the server advertises, when it was probed — carried
            so a repair can requeue a short shard without probing again.
    """

    dataset: str
    filename: str
    kind: str
    detail: str
    expected: int | None = None


def _load_state(paths: ReleasePaths) -> dict:
    """The download checkpoint, or a fresh empty one when none exists yet."""
    state_file = paths.download_state
    if not state_file.exists():
        return {}
    try:
        loaded = json.loads(state_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        log.warning("download checkpoint %s unreadable; starting fresh", state_file)
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _save_state(paths: ReleasePaths, state: dict) -> None:
    """Persist the checkpoint atomically (write-temp-then-rename)."""
    paths.download_state.parent.mkdir(parents=True, exist_ok=True)
    tmp = paths.download_state.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(paths.download_state)


def _part_path(target: Path) -> Path:
    """The in-progress ``.part`` file beside a shard's final ``.gz`` path."""
    return target.with_suffix(target.suffix + ".part")


def _remote_size(url: str) -> int | None:
    """The object's true size, via a one-byte ranged GET.

    A ranged GET rather than a HEAD because these are **pre-signed S3 URLs**:
    the signature covers the HTTP method, so a HEAD against a GET-signed URL is
    rejected. Asking for ``bytes=0-0`` costs one byte and comes back with a
    ``Content-Range: bytes 0-0/<total>`` header carrying the full length. The
    body is never read — the context manager closes the response — so a server
    that ignores the range and starts streaming a gigabyte doesn't cost one.

    Args:
        url: The (signed) shard URL.

    Returns:
        The object's size in bytes, or None when the server reports neither a
        ``Content-Range`` nor a ``Content-Length``.

    Raises:
        urllib.error.HTTPError: Propagated so callers can detect an expired URL.
        CorpusError: On a non-recoverable network failure.
    """
    request_headers = {"User-Agent": "curious-astronaut/1.0", "Range": "bytes=0-0"}
    http_request = urllib.request.Request(url, headers=request_headers, method="GET")
    try:
        with urllib.request.urlopen(http_request, timeout=300) as response:
            content_range = response.headers.get("Content-Range")
            if content_range and "/" in content_range:
                total = content_range.rsplit("/", 1)[-1].strip()
                return int(total) if total.isdigit() else None
            # Range ignored: the response is the whole object, so its
            # Content-Length is the size (we still never read the body).
            length = response.headers.get("Content-Length")
            return int(length) if length is not None else None
    except urllib.error.URLError as exc:
        if isinstance(exc, urllib.error.HTTPError):
            raise
        raise CorpusError(f"size probe {url} -> {exc.reason}") from exc


def _download_shard(
    url: str,
    target: Path,
    on_progress: Callable[[int, int | None], None],
    *,
    enforce_speed: bool = True,
) -> int | None:
    """Stream one shard to ``target``, resuming a partial ``.part`` if present.

    The rename to the final ``.gz`` happens **only** once the byte count matches
    the ``Content-Length`` the server promised — see this module's docstring for
    why a short body cannot be detected any other way.

    Args:
        url: The (signed) shard URL.
        target: The final ``.gz`` path; bytes accumulate in ``<target>.part``
            and it's renamed here on completion.
        on_progress: Called with ``(bytes_done, total_bytes)`` as data streams.
        enforce_speed: Drop the connection when it stays under the speed floor
            (see :data:`_SLOW_BYTES_PER_SECOND`). Off once a shard has used up
            its restarts.

    Returns:
        The shard's total size in bytes as advertised by the server, or None
        when it sent no ``Content-Length`` (in which case completeness can't be
        checked and the body is taken at face value).

    Raises:
        _ShortRead: When the body ended early. The ``.part`` is left in place so
            the next attempt resumes the missing tail.
        _SlowConnection: When the connection stayed under the speed floor for a
            whole window. The ``.part`` likewise keeps what arrived.
        urllib.error.HTTPError: Propagated so the caller can detect an expired
            URL (403) or a range past EOF (416).
        CorpusError: On a non-recoverable network failure.
    """
    part = _part_path(target)
    part.parent.mkdir(parents=True, exist_ok=True)
    have = part.stat().st_size if part.exists() else 0

    request_headers = {"User-Agent": "curious-astronaut/1.0"}
    if have:
        request_headers["Range"] = f"bytes={have}-"  # resume from where we stopped
    http_request = urllib.request.Request(url, headers=request_headers, method="GET")
    try:
        with urllib.request.urlopen(http_request, timeout=300) as response:
            # Content-Length is the *remaining* bytes on a 206 range response;
            # add what we already have for a true total.
            remaining = response.headers.get("Content-Length")
            total = (have + int(remaining)) if remaining is not None else None
            mode = "ab" if have and response.status == 206 else "wb"
            if mode == "wb":
                have = 0  # server ignored our Range — restart the file cleanly
            window_start = time.monotonic()
            window_bytes = 0
            with part.open(mode) as sink:
                while True:
                    block = response.read(_CHUNK_BYTES)
                    if not block:
                        break
                    sink.write(block)
                    have += len(block)
                    window_bytes += len(block)
                    on_progress(have, total)
                    elapsed = time.monotonic() - window_start
                    if elapsed >= _SLOW_WINDOW_SECONDS:
                        speed = window_bytes / elapsed
                        if enforce_speed and speed < _SLOW_BYTES_PER_SECOND:
                            raise _SlowConnection(have, speed)
                        window_start, window_bytes = time.monotonic(), 0
    except urllib.error.URLError as exc:
        if isinstance(exc, urllib.error.HTTPError):
            raise
        raise CorpusError(f"download {url} -> {exc.reason}") from exc

    # The guard this module exists for: an empty read() is not proof of a whole
    # body, so compare against what was promised before promoting the .part.
    if total is not None and have < total:
        raise _ShortRead(have, total)
    part.replace(target)
    return total


def _settle_range_past_eof(url: str, target: Path) -> bool:
    """Resolve a 416 by comparing the ``.part`` against the object's real size.

    A 416 means our resume offset is at or past the end of the object, which is
    ambiguous: either the ``.part`` is already the whole shard (the previous run
    died between the last write and the rename) or it's longer than the object
    and therefore garbage. One size probe separates the two.

    Args:
        url: A currently-valid signed URL for the shard.
        target: The final ``.gz`` path.

    Returns:
        True when the ``.part`` was in fact complete and has been promoted to
        ``target``; False when it was discarded and the shard must be re-pulled.

    Raises:
        urllib.error.HTTPError: Propagated when the probe itself fails.
        CorpusError: On a non-recoverable network failure.
    """
    part = _part_path(target)
    have = part.stat().st_size if part.exists() else 0
    size = _remote_size(url)
    if size is not None and have == size:
        log.info("%s was already complete at %d bytes; promoting", target.name, have)
        part.replace(target)
        return True
    log.warning(
        "%s partial file is %d bytes against a %s-byte object; discarding and restarting",
        target.name,
        have,
        size,
    )
    part.unlink(missing_ok=True)
    return False


def _refreshed_url(release_id: str, dataset: str, filename: str) -> str:
    """Re-list the dataset and return a fresh signed URL for one shard.

    Args:
        release_id: The release being downloaded.
        dataset: ``"papers"`` or ``"citations"``.
        filename: The shard's stable filename.

    Returns:
        A newly signed URL for that shard.

    Raises:
        CorpusError: When the shard is absent from the refreshed listing.
    """
    fresh = {
        datasets.shard_filename(candidate): candidate
        for candidate in datasets.dataset_file_urls(release_id, dataset)
    }
    refreshed = fresh.get(filename)
    if not refreshed:
        raise CorpusError(f"shard {filename} vanished from refreshed listing")
    return refreshed


def fetch_shard(
    release_id: str,
    dataset: str,
    filename: str,
    url: str,
    target: Path,
    on_progress: Callable[[int, int | None], None],
    *,
    refresh_url: Callable[[], str] | None = None,
) -> int | None:
    """Download one shard whole, riding out short reads and expired URLs.

    The retry loop is what turns a flaky multi-day pull into a finishing one:
    a truncated body resumes from the surviving ``.part`` (so a retry costs the
    missing tail, not the shard), and an expired signature re-lists the dataset
    for a fresh URL and carries on from the same offset.

    Args:
        release_id: The release being downloaded.
        dataset: ``"papers"`` or ``"citations"``.
        filename: The shard's stable filename.
        url: The signed URL from the current listing.
        target: The final ``.gz`` path.
        on_progress: Called with ``(bytes_done, total_bytes)`` as data streams.
        refresh_url: How to get a freshly signed URL for this file once the
            current one expires. None re-lists the release's dataset, which is
            right for a release shard; a weekly diff file (``refresh.py``) lives
            in a different listing and passes its own.

    Returns:
        The shard's size as advertised by the server, or None when it sent no
        ``Content-Length``.

    Raises:
        CorpusError: When the shard still can't be fetched whole after
            :data:`_SHORT_READ_RETRIES` resumes, or on an unrecoverable HTTP
            status.
    """
    current_url = url
    last_short: _ShortRead | None = None
    slow_restarts = 0
    attempt = 0
    # Short reads and expired links share the retry budget, as they always
    # have; a slow connection has its own (see _SLOW_RESTARTS).
    while attempt <= _SHORT_READ_RETRIES:
        try:
            return _download_shard(
                current_url, target, on_progress, enforce_speed=slow_restarts < _SLOW_RESTARTS
            )
        except _SlowConnection as exc:
            slow_restarts += 1
            # A warning, not info: Python prints warnings with no logging set up,
            # so the CLI shows each restart (it shows nothing at info level).
            log.warning(
                "%s slowed to %.2f MB/s at %d bytes; resuming on a freshly signed link (%d/%d)",
                filename,
                exc.bytes_per_second / 1e6,
                exc.received,
                slow_restarts,
                _SLOW_RESTARTS,
            )
            # A new connection on the same link stayed slow; a new link didn't
            # (see the module docstring). A failed re-list keeps the old link
            # rather than ending the pull.
            try:
                current_url = (
                    refresh_url() if refresh_url else _refreshed_url(release_id, dataset, filename)
                )
            except CorpusError as listing_error:
                log.warning("couldn't re-list %s for a fresh link: %s", filename, listing_error)
            continue
        except _ShortRead as exc:
            last_short = exc
            log.warning(
                "%s ended at %d of %d bytes (attempt %d/%d); resuming the tail",
                filename,
                exc.received,
                exc.expected,
                attempt + 1,
                _SHORT_READ_RETRIES + 1,
            )
            # The .part is deliberately left in place — the next pass resumes.
            attempt += 1
        except urllib.error.HTTPError as exc:
            if exc.code not in (403, 416):
                raise CorpusError(f"download {filename} -> HTTP {exc.code}") from exc
            log.info("URL for %s needs refreshing (HTTP %d)", filename, exc.code)
            current_url = (
                refresh_url() if refresh_url else _refreshed_url(release_id, dataset, filename)
            )
            if exc.code == 416 and _settle_range_past_eof(current_url, target):
                # The .part matched the object exactly and has been promoted,
                # so what's on disk now *is* the shard's full size.
                return target.stat().st_size
            attempt += 1
    tail = (
        f"body ended short {_SHORT_READ_RETRIES + 1} times "
        f"(last: {last_short.received} of {last_short.expected} bytes)"
        if last_short
        else "exhausted retries without completing"
    )
    raise CorpusError(f"download {filename} -> {tail}")


def _requeue_incomplete(target: Path, actual: int, expected: int) -> None:
    """Stage a bad shard for re-download, keeping any usable prefix.

    A short shard's bytes are a valid *prefix* of the object (truncation only
    ever cuts the tail), so it's moved back to ``.part`` and the next fetch
    resumes with a ``Range`` request — repairing a 577 MB stub of a 1.07 GB
    shard costs the missing 500 MB, not the whole gigabyte. Anything *longer*
    than expected isn't a prefix of anything and is simply dropped.

    Args:
        target: The final ``.gz`` path holding the bad bytes.
        actual: Its size on disk.
        expected: The size the server advertises.
    """
    if actual < expected:
        target.replace(_part_path(target))
    else:
        target.unlink(missing_ok=True)
        _part_path(target).unlink(missing_ok=True)


def download_release(
    release_id: str,
    *,
    datasets_wanted: tuple[str, ...] = DATASETS,
    shards: int | None = None,
    on_progress: ProgressFn | None = None,
    on_overall: OverallFn | None = None,
) -> None:
    """Download (or resume) a release's shards into its ``raw/`` tree.

    Idempotent: shards the checkpoint marks done *and whose size still matches
    what the server advertised* are skipped, a partial shard resumes, and a
    fresh signed URL is fetched automatically when one expires. A shard the
    checkpoint records at the wrong size is re-fetched rather than trusted —
    that's the repair path for anything a pre-guard run left truncated.

    Args:
        release_id: The release to download (see :func:`datasets.latest_release_id`).
        datasets_wanted: Which datasets to pull — defaults to both. Pass a
            single-element tuple to grab only ``papers`` or ``citations``.
        shards: Cap the number of shards **per dataset** (for a quick sample —
            e.g. ``shards=1`` pulls ~1 GB to prove the pipeline before the full
            300 GB). None downloads every shard.
        on_progress: Optional per-shard streaming callback (see :data:`ProgressFn`).
        on_overall: Optional whole-job callback, counting shards across every
            wanted dataset (see :data:`OverallFn`).

    Raises:
        CorpusError: When the corpus root is unconfigured, or a shard fails even
            after refreshing its URL and retrying its tail.
    """
    if corpus_root() is None:
        raise CorpusError("config.storage.s2_corpus is not set — nowhere to download to")
    paths = release_paths(release_id)
    state = _load_state(paths)

    # Every dataset is listed before any shard downloads, so the whole job's
    # size is known up front. Each maps stable filename -> latest signed URL,
    # so a refresh re-keys cleanly.
    listings: dict[str, dict[str, str]] = {}
    for dataset in datasets_wanted:
        urls = datasets.dataset_file_urls(release_id, dataset)
        if shards is not None:
            urls = urls[:shards]
        listings[dataset] = {datasets.shard_filename(url): url for url in urls}
    total_shards = sum(len(by_name) for by_name in listings.values())
    finished = 0
    if on_overall:
        on_overall("shards", finished, total_shards)

    for dataset, by_name in listings.items():
        dataset_state = state.setdefault(dataset, {})
        target_dir = paths.raw_dataset(dataset)

        for index, (filename, url) in enumerate(by_name.items(), start=1):
            target = target_dir / filename
            recorded = dataset_state.get(filename, {})
            if recorded.get("done") and target.exists():
                expected = recorded.get("expected")
                actual = target.stat().st_size
                if expected is None or actual == expected:
                    finished += 1  # already have this shard whole
                    if on_overall:
                        on_overall("shards", finished, total_shards)
                    continue
                log.warning(
                    "%s is %d bytes on disk but %d were expected; re-fetching",
                    filename,
                    actual,
                    expected,
                )
                _requeue_incomplete(target, actual, expected)

            def report(done: int, total: int | None, *, _filename: str = filename) -> None:
                """Forward one shard's streaming progress to the caller's callback.

                Args:
                    done: Bytes written so far.
                    total: The shard's full size, or None when unknown.
                    _filename: Bound per iteration so the closure reports the
                        shard it was created for, not the loop's last one.
                """
                if on_progress:
                    on_progress(dataset, _filename, done, total)

            log.info("downloading %s shard %d/%d: %s", dataset, index, len(by_name), filename)
            expected_size = fetch_shard(release_id, dataset, filename, url, target, report)

            dataset_state[filename] = {
                "bytes": target.stat().st_size,
                "expected": expected_size,
                "done": True,
            }
            _save_state(paths, state)
            finished += 1
            if on_overall:
                on_overall("shards", finished, total_shards)


def _gzip_is_readable(path: Path) -> str | None:
    """Decompress a shard end to end, reporting the first failure.

    The definitive local check — it needs no network and catches every kind of
    damage, including the quiet one a size check can't see on a file that was
    never size-checked. It reads the whole shard, so it's the expensive half of
    :func:`verify_release`.

    Args:
        path: The ``.gz`` shard to test.

    Returns:
        None when the stream decodes cleanly, else a description of the failure.
    """
    try:
        with gzip.open(path, "rb") as source:
            while source.read(_CHUNK_BYTES):
                pass
    except (OSError, EOFError, gzip.BadGzipFile) as exc:
        return f"gzip stream unreadable: {exc}"
    return None


def _discard_progress(bytes_done: int, total_bytes: int | None) -> None:
    """Swallow streaming progress — a repair reports per shard, not per chunk.

    Args:
        bytes_done: Bytes written so far (ignored).
        total_bytes: The shard's full size, or None (ignored).
    """


def _inspect_shard(
    dataset: str, filename: str, target: Path, url: str, deep: bool
) -> ShardProblem | None:
    """Check one downloaded shard against the object the server holds.

    Args:
        dataset: ``"papers"`` or ``"citations"``.
        filename: The shard's stable filename.
        target: Its path on disk.
        url: A currently-valid signed URL for the shard.
        deep: Also decompress the shard when its size checks out.

    Returns:
        The problem found, or None when the shard is intact.

    Raises:
        CorpusError: When the size probe hits an unrecoverable network failure.
    """
    if not target.exists():
        return ShardProblem(dataset, filename, "missing", "not on disk")
    actual = target.stat().st_size
    expected = _remote_size(url)
    if expected is not None and actual != expected:
        return ShardProblem(
            dataset,
            filename,
            "short",
            f"{actual} bytes on disk, {expected} advertised",
            expected=expected,
        )
    if deep and (failure := _gzip_is_readable(target)) is not None:
        return ShardProblem(dataset, filename, "corrupt", failure)
    return None


def verify_release(
    release_id: str,
    *,
    datasets_wanted: tuple[str, ...] = DATASETS,
    deep: bool = False,
    repair: bool = False,
    on_progress: VerifyProgressFn | None = None,
) -> list[ShardProblem]:
    """Audit a downloaded release's shards, optionally re-fetching bad ones.

    Written for corpora pulled before the completeness guard in
    :func:`_download_shard` existed, where a dropped connection could leave a
    truncated shard checkpointed as done. The loud failure mode is an ingest
    that dies on malformed JSON; the quiet one is a truncation landing exactly
    on a line boundary, which ingests cleanly and silently drops every row
    after the cut. Only a verification pass finds the second.

    Two checks, cheapest first: every shard's size is compared against what the
    Datasets API says the object actually is, and — with ``deep`` — the gzip
    stream is decompressed end to end, which reads the whole corpus (~400 GB,
    minutes) but needs no network and catches damage a size match can hide.

    Args:
        release_id: The downloaded release to audit.
        datasets_wanted: Which datasets to check — defaults to both.
        deep: Also decompress each shard (slow, thorough).
        repair: Re-download every shard found bad, resuming a usable prefix
            where one exists. Off by default: verification is read-only unless
            asked otherwise.
        on_progress: Optional per-shard callback (see :data:`VerifyProgressFn`).

    Returns:
        One :class:`ShardProblem` per bad shard, empty when the release is
        intact. When ``repair`` is set these are the shards that *were* bad and
        have since been re-fetched.

    Raises:
        CorpusError: When the corpus root is unconfigured, or a repair download
            fails.
    """
    if corpus_root() is None:
        raise CorpusError("config.storage.s2_corpus is not set — no corpus to verify")
    paths = release_paths(release_id)
    state = _load_state(paths)
    problems: list[ShardProblem] = []

    for dataset in datasets_wanted:
        by_name = {
            datasets.shard_filename(url): url
            for url in datasets.dataset_file_urls(release_id, dataset)
        }
        target_dir = paths.raw_dataset(dataset)
        dataset_state = state.setdefault(dataset, {})

        for index, (filename, url) in enumerate(by_name.items(), start=1):
            if on_progress:
                on_progress(dataset, filename, index, len(by_name))
            target = target_dir / filename
            try:
                problem = _inspect_shard(dataset, filename, target, url, deep)
            except urllib.error.HTTPError as exc:
                if exc.code not in (403, 416):
                    raise CorpusError(f"verify {filename} -> HTTP {exc.code}") from exc
                # A full verify outlasts the signatures it started with; the
                # listing is cheap next to re-probing hundreds of shards.
                url = _refreshed_url(release_id, dataset, filename)
                problem = _inspect_shard(dataset, filename, target, url, deep)
            if problem is None:
                continue
            problems.append(problem)
            if not repair:
                continue

            if problem.kind == "short" and problem.expected is not None:
                # A truncation only cuts the tail, so the bytes on disk are a
                # valid prefix — keep them and resume.
                _requeue_incomplete(target, target.stat().st_size, problem.expected)
            elif problem.kind == "corrupt":
                # Right size but undecodable: no prefix worth keeping.
                target.unlink(missing_ok=True)
                _part_path(target).unlink(missing_ok=True)
            log.info("repairing %s shard %s (%s)", dataset, filename, problem.kind)
            expected_size = fetch_shard(
                release_id, dataset, filename, url, target, _discard_progress
            )
            dataset_state[filename] = {
                "bytes": target.stat().st_size,
                "expected": expected_size,
                "done": True,
            }
            _save_state(paths, state)

    return problems
