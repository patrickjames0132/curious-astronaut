"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
CLI entry point for Curious Astronaut (the ``astronaut`` console script).

Usage:
    uv run astronaut serve              # start the API + Curious Astronaut frontend
    uv run astronaut serve --port 5050  # ...on a different port (or --host)
    uv run astronaut --version          # the installed version
    uv run astronaut --help             # see all commands

Every command imports lazily so ``--help`` (and each command) never pays
the import cost of the parts it doesn't touch.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

import click


# ``package_name`` makes click read the version from installed package metadata
# (importlib.metadata) rather than a second copy of the number in the source, so
# there is exactly one place a release bumps: pyproject.toml. It resolves for an
# editable install too, so `--version` reports the same string in a checkout as
# from a wheel. Added in v8.3.0: `--version` is the first thing anyone tries when
# reporting a bug against a published package, and it did not exist.
@click.group(help="Curious Astronaut — interactive citation/similarity graph explorer.")
@click.version_option(package_name="curious-astronaut", prog_name="astronaut")
def cli() -> None:
    """The click command group; subcommands attach below."""


@cli.command(help="Run the Flask API + Curious Astronaut frontend.")
@click.option("--host", default=None, help="Interface to bind (default: config.server.host).")
@click.option(
    "--port", type=int, default=None, help="Port to bind (default: config.server.port)."
)
def serve(host: str | None, port: int | None) -> None:
    """Start the Flask dev server (API + built frontend).

    Args:
        host: Interface to bind; overrides ``config.server.host`` when given —
            e.g. ``0.0.0.0`` to expose the server on the network.
        port: Port to bind; overrides ``config.server.port`` when given — handy
            for a second instance or when 5000 is busy.

    Returns:
        None (blocks until the server exits).
    """
    from curious_astronaut import app as app_module

    app_module.main(host=host, port=port)


# --- Bring-your-own sources (the local semantic library) ---------------------


@cli.command(help="Ingest a PDF file or URL into the source library.")
@click.argument("target")
@click.option("--title", default=None, help="Override the source title.")
def ingest(target: str, title: str | None) -> None:
    """Ingest a PDF file or a URL into the local source library.

    Args:
        target: A filesystem path to a PDF, or an http(s) URL.
        title: Optional display title (defaults to the filename / page title).

    Raises:
        click.ClickException: When ingestion fails — the ``SourceError``
            text is the message (unavailable embeddings, scanned PDF,
            unreachable URL), shown cleanly instead of a traceback.
    """
    from curious_astronaut.services import sources

    try:
        if target.startswith(("http://", "https://")):
            src = sources.ingest_url(target, title=title)
        else:
            src = sources.ingest_pdf(target, title=title)
    except sources.SourceError as exc:
        raise click.ClickException(str(exc)) from exc
    pages = f", {src['pages']} pages" if src.get("pages") else ""
    click.echo(f"Ingested [{src['kind']}] “{src['title']}” — {src['n_chunks']} chunks{pages}")
    click.echo(f"  id: {src['id']}")


@cli.command("sources", help="List sources in the library.")
def sources_list() -> None:
    """Print every source in the library, one row per source."""
    from curious_astronaut.services import sources

    rows = sources.list_sources()
    if not rows:
        click.echo("No sources yet. Add one with:  ingest <pdf-or-url>")
        return
    for source in rows:
        pages = f"{source['pages']}p" if source.get("pages") else "—"
        click.echo(
            f"{source['id']}  [{source['kind']:3}] {pages:>5} "
            f"{source['n_chunks']:>5}ch  {source['title']}"
        )


@cli.command("search-sources", help="Semantic search over the library.")
@click.argument("query")
@click.option("--source", default=None, help="Restrict to one source id.")
@click.option("-k", "top_k", type=int, default=None, help="Number of passages.")
def search_sources(query: str, source: str | None, top_k: int | None) -> None:
    """Semantic-search the library and print the top passages.

    Args:
        query: What to look for — a concept or question.
        source: Restrict retrieval to one source's id (optional).
        top_k: Number of passages (defaults to ``config.sources.retrieval.search_k``).
    """
    from curious_astronaut.services import sources

    hits = sources.search(query, top_k=top_k, source_ids=[source] if source else None)
    if not hits:
        click.echo("No matches (library empty, or embeddings unavailable).")
        return
    for number, hit in enumerate(hits, 1):
        location = f"p.{hit['page']}" if hit.get("page") else "web"
        snippet = " ".join(hit["text"].split())[:280]
        click.echo(f"\n[{number}] {hit['source_title']} · {location} · score={hit['score']:.3f}")
        click.echo(f"    {snippet}…")


@cli.command(help="Delete a source by id.")
@click.argument("source_id")
def forget(source_id: str) -> None:
    """Delete a source (and its chunks/vectors) by id.

    Args:
        source_id: The source's id, as shown by the ``sources`` command.
    """
    from curious_astronaut.services import sources

    click.echo("Deleted." if sources.delete_source(source_id) else "No such source.")


# --- Offline S2 citations corpus (the real Field-Landmarks fix) --------------


class _CorpusProgress(logging.Handler):
    """The corpus commands' progress bars, kept clear of log messages.

    Two tqdm bars: the **whole job** on top (shards, diff files, or buckets,
    counted done of total) and the **file streaming now** below it, in bytes.
    A long pull runs for hours, so the top bar's rate and ETA are what answer
    "how long is left"; the bottom one shows a single shard isn't stuck.

    It is also the corpus package's log handler, because a warning printed
    mid-transfer (a 429 backoff, a short read) used to land on the end of the
    progress line and be overwritten by its next redraw. Messages go through
    ``tqdm.write``, which lifts the bars, prints on a line of its own and
    redraws them below.
    """

    def __init__(self) -> None:
        """Handle warnings and up, as Python's no-config fallback did."""
        super().__init__(logging.WARNING)
        self._overall: Any = None
        self._overall_unit: str | None = None
        self._file: Any = None
        self._file_name: str | None = None

    def overall(self, unit: str, done: int, total: int, *, note: str | None = None) -> None:
        """Move the whole-job bar, starting a new one when the unit changes.

        Args:
            unit: What's being counted (``shards``, ``diff files``, ``buckets``).
            done: How many are finished.
            total: How many there are.
            note: Optional text shown after the bar, e.g. the current file.
        """
        from tqdm import tqdm

        if self._overall is None or unit != self._overall_unit:
            self.close()
            self._overall = tqdm(
                total=total, initial=done, unit=f" {unit}", desc="overall", dynamic_ncols=True
            )
            self._overall_unit = unit
        else:
            self._overall.total = total
            self._overall.update(done - self._overall.n)
        if note is not None:
            self._overall.set_postfix_str(note)

    def file(self, dataset: str, filename: str, done: int, total: int | None) -> None:
        """Move the current file's byte bar, starting a new one per file.

        Args:
            dataset: The file's dataset.
            filename: The file streaming now.
            done: Bytes written so far (a resumed file starts part-way).
            total: The file's full size, or None when the server didn't say.
        """
        from tqdm import tqdm

        if self._file is None or filename != self._file_name:
            if self._file is not None:
                self._file.close()
            self._file = tqdm(
                total=total,
                initial=done,
                unit="B",
                unit_scale=True,
                unit_divisor=1024,
                desc=f"{dataset} {filename[:24]}",
                leave=False,
                dynamic_ncols=True,
            )
            self._file_name = filename
        else:
            self._file.update(done - self._file.n)

    def message(self, text: str) -> None:
        """Print a line above the bars.

        Args:
            text: The line to print.
        """
        from tqdm import tqdm

        tqdm.write(text)

    def close(self) -> None:
        """Finish every open bar, leaving the whole-job bar's final state on screen."""
        if self._file is not None:
            self._file.close()
            self._file, self._file_name = None, None
        if self._overall is not None:
            self._overall.close()
            self._overall, self._overall_unit = None, None

    def emit(self, record: logging.LogRecord) -> None:
        """Print a log message on a line of its own, above the bars.

        Args:
            record: The log record to print.
        """
        from tqdm import tqdm

        tqdm.write(self.format(record), file=sys.stderr)


_PROGRESS = _CorpusProgress()


@cli.group(help="Download/ingest the offline Semantic Scholar citations corpus.")
def corpus() -> None:
    """Command group for the offline S2 citations corpus.

    The bulk ``citations`` + ``papers`` Datasets releases are ~300 GB, so this is
    an operator workflow (run on your own machine, resumable), not a request-path
    action: ``download`` pulls the shards, ``ingest`` builds the queryable
    Parquet, and ``activate`` flips the app over to a finished release. See
    ``integrations/semantic_scholar/corpus/README.md``.
    """
    corpus_log = logging.getLogger("curious_astronaut.integrations.semantic_scholar.corpus")
    if _PROGRESS not in corpus_log.handlers:
        corpus_log.addHandler(_PROGRESS)


def _require_corpus_root() -> Path:
    """The corpus root, or a clean CLI error when it isn't configured.

    Returns:
        The configured ``storage.s2_corpus`` root.

    Raises:
        click.ClickException: When it's unset — the command has nowhere to
            read or write.
    """
    from curious_astronaut.config import config

    root = config.storage.s2_corpus
    if root is None:
        raise click.ClickException(
            'config.storage.s2_corpus is not set — point it at a roomy drive '
            '(outside the repo) first, e.g. "E:\\\\s2corpus".'
        )
    return root


@corpus.command("status", help="Show the corpus root, releases, and active pointer.")
def corpus_status() -> None:
    """Print the corpus root, its releases, and which one is active."""
    from curious_astronaut.config import config
    from curious_astronaut.integrations.semantic_scholar.corpus import contexts
    from curious_astronaut.integrations.semantic_scholar.corpus import paths as corpus_paths

    root = config.storage.s2_corpus
    click.echo(f"corpus root: {root or '(unset — corpus off, using live S2)'}")
    if root is None:
        return
    click.echo(f"exists:      {root.exists()}")
    active = corpus_paths.read_current_release(root) if root.exists() else None
    click.echo(f"active release (CURRENT): {active or '(none)'}")

    # A release can be downloaded-not-ingested (raw subtree only) or
    # ingested-and-shards-deleted (parquet subtree only). Show them all.
    releases_dir = root / "releases"
    releases = (
        sorted(child.name for child in releases_dir.iterdir() if child.is_dir())
        if releases_dir.exists()
        else []
    )
    for release in releases:
        paths = corpus_paths.release_paths(release)
        papers_done = paths.parquet_dataset("papers").exists()
        cites_done = paths.parquet_dataset("citations").exists()
        contexts_done = contexts.is_complete(paths)
        shards = paths.raw.exists()
        # A refreshed release says where it came from, and whether it's whole.
        origin = ""
        if paths.refresh_state.exists():
            refresh_state = json.loads(paths.refresh_state.read_text(encoding="utf-8"))
            finished = "complete" if refresh_state.get("complete") else "in progress"
            origin = f" refreshed-from={refresh_state.get('base')} ({finished})"
        click.echo(
            f"  {release}: shards={shards} papers-parquet={papers_done} "
            f"citations-parquet={cites_done} contexts={contexts_done}{origin}"
        )


@corpus.command("download", help="Download (or resume) a release's shards.")
@click.option("--release", "release_id", default=None, help="Release id (default: latest).")
@click.option(
    "--dataset",
    "datasets_opt",
    type=click.Choice(["papers", "citations"]),
    multiple=True,
    help="Restrict to one dataset (repeatable). Default: both.",
)
@click.option(
    "--shards",
    type=int,
    default=None,
    help="Cap shards per dataset — a quick sample (e.g. 1 ≈ 1 GB) before the full ~300 GB.",
)
def corpus_download(release_id: str | None, datasets_opt: tuple[str, ...], shards: int | None) -> None:
    """Download a release's shards, resuming any partial pull.

    Args:
        release_id: The release to download; defaults to the latest release.
        datasets_opt: Datasets to pull (``papers``/``citations``); both by default.
        shards: Optional per-dataset shard cap for a quick sample.

    Raises:
        click.ClickException: When the corpus root is unset or a download fails.
    """
    _require_corpus_root()
    from curious_astronaut.integrations.semantic_scholar.corpus import datasets, download
    from curious_astronaut.integrations.semantic_scholar.corpus.datasets import CorpusError
    from curious_astronaut.integrations.semantic_scholar.corpus.paths import DATASETS

    release_id = release_id or datasets.latest_release_id()
    wanted = datasets_opt or DATASETS
    click.echo(f"Downloading release {release_id} ({', '.join(wanted)})" + (f", {shards} shard(s) each" if shards else ""))

    try:
        download.download_release(
            release_id,
            datasets_wanted=tuple(wanted),
            shards=shards,
            on_progress=_PROGRESS.file,
            on_overall=_PROGRESS.overall,
        )
    except CorpusError as exc:
        raise click.ClickException(str(exc)) from exc
    finally:
        _PROGRESS.close()
    click.echo("Download complete.")


@corpus.command("verify", help="Audit downloaded shards for truncation or corruption.")
@click.option("--release", "release_id", default=None, help="Release id (default: latest).")
@click.option(
    "--dataset",
    "datasets_opt",
    type=click.Choice(["papers", "citations"]),
    multiple=True,
    help="Restrict to one dataset (repeatable). Default: both.",
)
@click.option(
    "--deep/--no-deep",
    default=False,
    help="Also decompress every shard — catches damage a size match hides. Slow (reads ~400 GB).",
)
@click.option(
    "--repair/--no-repair",
    default=False,
    help="Re-download every bad shard, resuming a usable prefix. Default: report only.",
)
def corpus_verify(
    release_id: str | None, datasets_opt: tuple[str, ...], deep: bool, repair: bool
) -> None:
    """Check a downloaded release's shards against what the server actually holds.

    The audit for corpora pulled before the downloader enforced completeness,
    when a dropped connection could leave a truncated shard checkpointed as
    done. Its loud failure is an ingest dying on malformed JSON hours in; its
    quiet one is a cut landing on a line boundary, which ingests cleanly and
    silently drops rows — only this pass finds that.

    Args:
        release_id: The release to verify; defaults to the latest release.
        datasets_opt: Datasets to check; both by default.
        deep: Also decompress each shard end to end (slow, thorough).
        repair: Re-download the shards found bad instead of only listing them.

    Raises:
        click.ClickException: When the corpus root is unset or verification
            fails.
    """
    _require_corpus_root()
    from curious_astronaut.integrations.semantic_scholar.corpus import datasets, download
    from curious_astronaut.integrations.semantic_scholar.corpus.datasets import CorpusError
    from curious_astronaut.integrations.semantic_scholar.corpus.paths import DATASETS

    release_id = release_id or datasets.latest_release_id()
    wanted = datasets_opt or DATASETS
    click.echo(
        f"Verifying release {release_id} ({', '.join(wanted)})"
        + (", deep" if deep else "")
        + (", repairing" if repair else "")
        + "…"
    )

    def on_progress(dataset: str, filename: str, index: int, total: int) -> None:
        # Fired as each shard starts, so the ones before it are the finished ones.
        _PROGRESS.overall(f"{dataset} shards", index - 1, total, note=filename)

    try:
        problems = download.verify_release(
            release_id,
            datasets_wanted=tuple(wanted),
            deep=deep,
            repair=repair,
            on_progress=on_progress,
        )
    except CorpusError as exc:
        raise click.ClickException(str(exc)) from exc
    finally:
        _PROGRESS.close()

    if not problems:
        click.echo("All shards intact.")
        return
    verb = "Repaired" if repair else "Found"
    click.echo(f"{verb} {len(problems)} bad shard(s):")
    for problem in problems:
        click.echo(f"  {problem.dataset:9} {problem.kind:8} {problem.filename} — {problem.detail}")
    if not repair:
        click.echo("\nRe-run with --repair to re-download them.")


@corpus.command("ingest", help="Ingest downloaded shards into queryable Parquet.")
@click.option("--release", "release_id", default=None, help="Release id (default: latest).")
@click.option(
    "--dataset",
    "datasets_opt",
    type=click.Choice(["papers", "citations", "contexts"]),
    multiple=True,
    help="Restrict to one dataset (repeatable). Default: all three; contexts are "
         "the citing sentences, read from the raw citations shards.",
)
@click.option(
    "--activate/--no-activate",
    default=True,
    help="On success, point CURRENT at this release (the app then queries it). Default: on.",
)
def corpus_ingest(release_id: str | None, datasets_opt: tuple[str, ...], activate: bool) -> None:
    """Ingest a downloaded release to Parquet and (by default) activate it.

    Args:
        release_id: The release to ingest; defaults to the latest release.
        datasets_opt: Datasets to ingest; all of ``ingest.INGEST_DATASETS`` by default.
        activate: Flip ``CURRENT`` to this release when the ingest succeeds.

    Raises:
        click.ClickException: When the corpus root is unset or the ingest fails.
    """
    corpus_root = _require_corpus_root()  # shards read, Parquet + CURRENT written
    from curious_astronaut.integrations.semantic_scholar.corpus import datasets, ingest
    from curious_astronaut.integrations.semantic_scholar.corpus.datasets import CorpusError
    from curious_astronaut.integrations.semantic_scholar.corpus.paths import (
        DATASETS,
        write_current_release,
    )

    release_id = release_id or datasets.latest_release_id()
    wanted = datasets_opt or ingest.INGEST_DATASETS
    click.echo(f"Ingesting release {release_id} ({', '.join(wanted)})…")

    def on_progress(dataset: str, filename: str, index: int, total: int) -> None:
        # Fired as each shard starts, so the ones before it are the finished ones.
        _PROGRESS.overall(f"{dataset} shards", index - 1, total, note=filename)

    try:
        ingest.ingest_release(release_id, datasets_wanted=tuple(wanted), on_progress=on_progress)
    except CorpusError as exc:
        raise click.ClickException(str(exc)) from exc
    finally:
        _PROGRESS.close()
    click.echo("Ingest complete.")
    if activate and set(DATASETS).issubset(wanted):
        write_current_release(corpus_root, release_id)
        click.echo(f"Activated {release_id} (CURRENT).")
    elif activate:
        click.echo("Not activated — activate only after both datasets are ingested "
                   "(`astronaut corpus activate`).")


@corpus.command("refresh", help="Bring the corpus up to date from S2's weekly diffs.")
@click.option("--release", "release_id", default=None, help="Release to build (default: latest).")
@click.option("--from", "base_id", default=None,
              help="Release to build it from (default: the active CURRENT release).")
@click.option(
    "--activate/--no-activate",
    default=True,
    help="On success, point CURRENT at the new release. Default: on.",
)
def corpus_refresh(release_id: str | None, base_id: str | None, activate: bool) -> None:
    """Build a newer release from the active one plus the diffs between them.

    Downloads only what changed (~5 GB a week, against ~439 GB for a full
    release) and writes the new release beside the old one, so the app keeps
    serving the old one until the new one is whole. Resumable: rerun after an
    interruption and it picks up where it stopped.

    Args:
        release_id: The release to build; defaults to the latest release.
        base_id: The release to build it from; defaults to the active one.
        activate: Flip ``CURRENT`` to the new release when it succeeds.

    Raises:
        click.ClickException: When the corpus root is unset, there's no base
            release, or the refresh fails.
    """
    corpus_root = _require_corpus_root()
    from curious_astronaut.integrations.semantic_scholar.corpus import datasets, refresh
    from curious_astronaut.integrations.semantic_scholar.corpus import paths as corpus_paths
    from curious_astronaut.integrations.semantic_scholar.corpus.datasets import CorpusError

    base_id = base_id or corpus_paths.read_current_release(corpus_root)
    if not base_id:
        raise click.ClickException(
            "no release to refresh from — ingest a full release first, or pass --from"
        )
    try:
        release_id = release_id or datasets.latest_release_id()
    except CorpusError as exc:
        raise click.ClickException(str(exc)) from exc
    if release_id == base_id:
        click.echo(f"Already up to date ({base_id}).")
        return
    click.echo(f"Refreshing {base_id} → {release_id}…")

    def on_stage(message: str) -> None:
        # A new stage retires the last one's bars; its line stays above.
        _PROGRESS.close()
        _PROGRESS.message(f"  {message}")

    try:
        refresh.refresh_release(
            base_id,
            release_id,
            on_stage=on_stage,
            on_download=_PROGRESS.file,
            on_overall=_PROGRESS.overall,
        )
    except CorpusError as exc:
        raise click.ClickException(str(exc)) from exc
    finally:
        _PROGRESS.close()
    click.echo("Refresh complete.")
    if activate:
        corpus_paths.write_current_release(corpus_root, release_id)
        click.echo(f"Activated {release_id} (CURRENT).")
    old = corpus_paths.release_paths(base_id)
    click.echo(
        f"To reclaim space: the old release ({old.parquet.parent}) and the new one's "
        f"diff files ({corpus_paths.release_paths(release_id).diffs}) can be deleted."
    )


@corpus.command("contexts", help="Build a release's citing-sentences table (Criticisms).")
@click.option("--release", "release_id", default=None,
              help="Release id (default: the active CURRENT release).")
def corpus_contexts(release_id: str | None) -> None:
    """Build the contexts table for a release that predates it.

    New ingests and refreshes build it themselves; this is the backfill. It
    reads the release's raw citations shards when they're on disk, or else,
    for a refreshed release, the base release's table (built first from the
    base's raw shards if needed) plus the citation diffs still in ``diffs/``.
    Resumable, and a no-op once the table is complete.

    Args:
        release_id: The release; defaults to the active one.

    Raises:
        click.ClickException: When the corpus root is unset, there's no
            release, or neither route to the sentences is open.
    """
    corpus_root = _require_corpus_root()
    from curious_astronaut.integrations.semantic_scholar.corpus import contexts
    from curious_astronaut.integrations.semantic_scholar.corpus import paths as corpus_paths
    from curious_astronaut.integrations.semantic_scholar.corpus.datasets import CorpusError

    release_id = release_id or corpus_paths.read_current_release(corpus_root)
    if not release_id:
        raise click.ClickException("no active release — pass --release")
    click.echo(f"Building the contexts table for {release_id}…")
    try:
        route = contexts.build_contexts(release_id, on_overall=_PROGRESS.overall)
    except CorpusError as exc:
        raise click.ClickException(str(exc)) from exc
    finally:
        _PROGRESS.close()
    if route == "complete":
        click.echo("Already complete.")
    else:
        click.echo(f"Contexts complete (built from {'raw shards' if route == 'raw' else 'the refresh diffs'}).")


@corpus.command("compact", help="Cluster an ingested release's papers by corpusid.")
@click.option("--release", "release_id", default=None,
              help="Release id (default: the active CURRENT release).")
def corpus_compact(release_id: str | None) -> None:
    """Compact a release's papers dataset into the clustered (sorted) layout.

    The migration path for a release ingested before v5.12.0 (whose papers are
    one file per shard, so nothing prunes and citer hydration is a full scan),
    and the recovery path after an interrupted compaction. New ingests compact
    automatically — this exists for corpora that predate that. Needs only the
    parquet root; the raw shards can be long gone. Safe to rerun: an
    already-clustered release is a fast no-op.

    Args:
        release_id: The release to compact; defaults to the active ``CURRENT``
            release (this is a maintenance pass over what's being served, so it
            defaults to what's on disk — not to the network's latest release).

    Raises:
        click.ClickException: When the corpus root is unset, no release is
            named or active, or the compaction fails.
    """
    corpus_root = _require_corpus_root()
    from curious_astronaut.integrations.semantic_scholar.corpus import ingest
    from curious_astronaut.integrations.semantic_scholar.corpus import paths as corpus_paths
    from curious_astronaut.integrations.semantic_scholar.corpus.datasets import CorpusError

    release_id = release_id or corpus_paths.read_current_release(corpus_root)
    if not release_id:
        raise click.ClickException(
            "no release named and none active — pass --release or activate one first"
        )
    click.echo(f"Compacting release {release_id} (papers → clustered by corpusid)…")
    try:
        compacted = ingest.compact_release(release_id)
    except CorpusError as exc:
        raise click.ClickException(str(exc)) from exc
    if compacted:
        click.echo("Compacted (papers clustered; arXiv index rebuilt).")
    else:
        click.echo("Already clustered — nothing to do.")


@corpus.command("activate", help="Point CURRENT at a release so the app queries it.")
@click.option("--release", "release_id", default=None, help="Release id (default: latest).")
def corpus_activate(release_id: str | None) -> None:
    """Mark a release active (write the ``CURRENT`` pointer).

    Args:
        release_id: The release to activate; defaults to the latest release.

    Raises:
        click.ClickException: When the corpus root is unset or the release's
            papers Parquet is missing (nothing to activate).
    """
    corpus_root = _require_corpus_root()
    from curious_astronaut.integrations.semantic_scholar.corpus import datasets
    from curious_astronaut.integrations.semantic_scholar.corpus.paths import (
        release_paths,
        write_current_release,
    )

    release_id = release_id or datasets.latest_release_id()
    paths = release_paths(release_id)
    if not paths.parquet_dataset("papers").exists():
        raise click.ClickException(f"release {release_id} has no ingested papers Parquet — ingest first")
    write_current_release(corpus_root, release_id)
    click.echo(f"Activated {release_id} (CURRENT).")


if __name__ == "__main__":
    cli()
