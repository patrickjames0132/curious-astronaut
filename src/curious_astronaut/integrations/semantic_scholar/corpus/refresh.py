"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Bring the corpus up to date from S2's weekly diffs instead of re-downloading it.

A full release is ~439 GB (2026-10-13: papers 52.6 GB, citations 386.2 GB);
one week's diff is ~1% of that (3.2 GB of paper updates, 1.7 GB of citation
updates, a few MB of deletes). The Datasets API publishes the chain of weekly
steps between any two releases (``datasets.release_diffs``), each step a set of
**update files** (whole rows, upserted by key) and **delete files** (just the
key: ``corpusid`` for papers, ``citationid`` for citations).

**The refresh writes a new release; it never edits the one being served.**
The next release is built in its own subtree as *the current release plus
every step between it and the target*, and the CLI flips ``CURRENT`` only once
it's complete. That keeps the per-release isolation the rest of the package
relies on, and it sidesteps the hole the README warns about (an in-place edit
would expose a half-applied state live). The price is disk space for a second
copy of the Parquet while it runs; the old release can be deleted afterwards.

The build, in stages, each recorded in ``refresh.json`` so an interrupted run
resumes where it stopped:

1. **Download** every step's files into ``diffs/`` (resumable, with the same
   short-read and expired-link handling as a release download).
2. **Papers.** Across all steps, each ``corpusid``'s *latest* event wins: an
   update replaces the row, a delete drops it, and a later update re-adds a
   deleted paper. The base rows minus every touched id, plus the surviving
   updates, are written **globally sorted by ``corpusid``**, so the release is
   as clustered as a fresh ingest (see ``ingest.compact_papers``). Then the
   arXiv index is rebuilt from it.
3. **Citations.** The same latest-event rule, keyed by ``citationid``. A
   delete names only the ``citationid``, so which bucket its row lives in is
   unknown until one scan of the base finds every touched id's bucket (the
   *tombstones*). Then each of the ``NBUCKETS`` buckets is rewritten on its
   own: base rows minus its tombstones, plus its updates, sorted by
   ``citedcorpusid``. A marker per bucket makes this stage resumable, and each
   bucket lands as one file, where ingest left one per shard.

**A base release must carry ``citationid``** (and ``publicationtypes``),
which ingest only keeps since this module exists. An older release can't be
refreshed: its citation deletes would have nothing to match. Download and
ingest one full release, then refresh from it.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import functools
import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from .... import optional
from . import datasets, download
from .datasets import CorpusError, DiffStep
from .ingest import (
    CITATIONS_COLUMNS,
    NBUCKETS,
    PAPERS_COLUMNS,
    build_arxiv_index,
    citations_projection,
    connect,
    papers_projection,
    read_json,
)
from .paths import DATASETS, ReleasePaths, corpus_root, release_paths

if TYPE_CHECKING:  # duckdb is an optional extra; annotations only here
    import duckdb

log = logging.getLogger(__name__)

#: Stage-level progress: ``(message)``, one line per stage.
StageFn = Callable[[str], None]

#: The stored papers columns, in order — what a refreshed release writes, so it
#: matches a freshly ingested one column for column.
_PAPER_COLUMNS = (
    "corpusid, arxiv_id, doi, title, year, publicationdate, citationcount, authors, "
    "publicationtypes"
)

#: The stored citations columns (the bucket is the directory, not a column).
_CITATION_COLUMNS = "citationid, citingcorpusid, citedcorpusid, isinfluential"

#: Prefix of the refreshed papers files, matching ingest's clustered output so
#: a later ``compact`` treats them as already clustered.
_CLUSTERED_PREFIX = "clustered_"


def _load_state(paths: ReleasePaths) -> dict:
    """The refresh checkpoint, or an empty one.

    Args:
        paths: The release being built.

    Returns:
        The decoded state.
    """
    if not paths.refresh_state.exists():
        return {}
    return json.loads(paths.refresh_state.read_text(encoding="utf-8"))


def _save_state(paths: ReleasePaths, state: dict) -> None:
    """Persist the refresh checkpoint atomically.

    Args:
        paths: The release being built.
        state: The state to write.
    """
    paths.refresh_state.parent.mkdir(parents=True, exist_ok=True)
    tmp = paths.refresh_state.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(paths.refresh_state)


def _columns_of(connection: duckdb.DuckDBPyConnection, parquet_glob: str) -> set[str]:
    """The column names of a Parquet dataset (empty when it has no files).

    Args:
        connection: The DuckDB connection.
        parquet_glob: The dataset's files.

    Returns:
        The column names.
    """
    try:
        rows = connection.execute(f"DESCRIBE SELECT * FROM read_parquet('{parquet_glob}')").fetchall()
    except optional.require("duckdb", "corpus").IOException:  # no files match
        return set()
    return {row[0] for row in rows}


def _require_refreshable(connection: duckdb.DuckDBPyConnection, base: ReleasePaths) -> None:
    """Refuse a base release ingested before the refresh existed.

    Args:
        connection: The DuckDB connection.
        base: The release to refresh from.

    Raises:
        CorpusError: When the base lacks ``citationid`` or ``publicationtypes``.
    """
    papers = _columns_of(connection, (base.parquet_dataset("papers") / "*.parquet").as_posix())
    citations = _columns_of(
        connection, (base.parquet_dataset("citations") / "bucket=*" / "*.parquet").as_posix()
    )
    if "publicationtypes" not in papers or "citationid" not in citations:
        raise CorpusError(
            f"release {base.release_id} was ingested before refresh existed (it has no "
            "citationid, which a citation delete names alone). Download and ingest one "
            "full release, then refresh from it."
        )


def _step_dir(paths: ReleasePaths, dataset: str, index: int, step: DiffStep) -> Path:
    """Where one diff step's files are kept.

    Args:
        paths: The release being built.
        dataset: ``papers`` or ``citations``.
        index: The step's position in the chain (zero-padded, so steps sort).
        step: The step.

    Returns:
        ``diffs/<dataset>/<NN>_<to_release>``.
    """
    return paths.diffs / dataset / f"{index:03d}_{step.to_release}"


def _fresh_diff_url(
    base_release: str, target_release: str, dataset: str, index: int, kind: str, filename: str
) -> str:
    """Re-list a diff chain and return a freshly signed URL for one of its files.

    Args:
        base_release: The chain's start.
        target_release: The chain's end.
        dataset: ``papers`` or ``citations``.
        index: The step's position in the chain.
        kind: ``update`` or ``delete``.
        filename: The file's stable name.

    Returns:
        The new URL.

    Raises:
        CorpusError: When the file is no longer listed.
    """
    step = datasets.release_diffs(base_release, target_release, dataset)[index]
    urls = step.update_files if kind == "update" else step.delete_files
    for url in urls:
        if datasets.shard_filename(url) == filename:
            return url
    raise CorpusError(f"diff file {filename} vanished from the refreshed listing")


def _download_diffs(
    base_release: str,
    target: ReleasePaths,
    state: dict,
    on_download: download.ProgressFn | None,
    on_overall: download.OverallFn | None,
) -> dict[str, list[DiffStep]]:
    """Download every diff file between the base and the target (resumable).

    Args:
        base_release: The release being refreshed from.
        target: The release being built.
        state: The refresh checkpoint (updated and saved per file).
        on_download: Optional per-file streaming callback.
        on_overall: Optional whole-job callback, counting diff files across
            both datasets' chains.

    Returns:
        Each dataset's chain of steps.

    Raises:
        CorpusError: When a chain doesn't run from the base to the target, or a
            file can't be fetched whole.
    """
    chains: dict[str, list[DiffStep]] = {}
    files_state = state.setdefault("files", {})
    # Both chains are listed before any file downloads, so the whole job's
    # size is known up front.
    for dataset in DATASETS:
        chain = datasets.release_diffs(base_release, target.release_id, dataset)
        if not chain or chain[0].from_release != base_release or chain[-1].to_release != target.release_id:
            raise CorpusError(
                f"the {dataset} diff from {base_release} doesn't reach {target.release_id}"
            )
        chains[dataset] = chain
    total_files = sum(
        len(step.update_files) + len(step.delete_files)
        for chain in chains.values()
        for step in chain
    )
    finished = 0
    if on_overall:
        on_overall("diff files", finished, total_files)
    for dataset, chain in chains.items():
        for index, step in enumerate(chain):
            for kind, urls in (("update", step.update_files), ("delete", step.delete_files)):
                for url in urls:
                    filename = datasets.shard_filename(url)
                    path = _step_dir(target, dataset, index, step) / kind / filename
                    key = path.relative_to(target.diffs).as_posix()
                    recorded = files_state.get(key, {})
                    if recorded.get("done") and path.exists() and (
                        recorded.get("expected") in (None, path.stat().st_size)
                    ):
                        finished += 1
                        if on_overall:
                            on_overall("diff files", finished, total_files)
                        continue

                    def report(done: int, total: int | None, *, _name: str = filename,
                               _dataset: str = dataset) -> None:
                        """Forward one file's streaming progress.

                        Args:
                            done: Bytes written so far.
                            total: The file's full size, or None when unknown.
                            _name: Bound per iteration (the file reported).
                            _dataset: Bound per iteration (its dataset).
                        """
                        if on_download:
                            on_download(_dataset, _name, done, total)

                    expected = download.fetch_shard(
                        target.release_id, dataset, filename, url, path, report,
                        refresh_url=functools.partial(
                            _fresh_diff_url,
                            base_release, target.release_id, dataset, index, kind, filename,
                        ),
                    )
                    files_state[key] = {"done": True, "expected": expected}
                    _save_state(target, state)
                    finished += 1
                    if on_overall:
                        on_overall("diff files", finished, total_files)
    return chains


def _event_sources(
    target: ReleasePaths, dataset: str, chain: list[DiffStep], kind: str
) -> list[tuple[int, str]]:
    """Each step's downloaded files of one kind, as ``(step, glob)`` pairs.

    Args:
        target: The release being built.
        dataset: ``papers`` or ``citations``.
        chain: The dataset's steps.
        kind: ``update`` or ``delete``.

    Returns:
        The steps that have files of that kind, with a glob over them.
    """
    sources = []
    for index, step in enumerate(chain):
        directory = _step_dir(target, dataset, index, step) / kind
        if any(directory.glob("*.gz")):
            sources.append((index, (directory / "*.gz").as_posix()))
    return sources


def _latest_events_sql(
    updates: list[tuple[int, str]],
    deletes: list[tuple[int, str]],
    *,
    key: str,
    columns: str,
    projection: Callable[[str], str],
) -> str:
    """SQL for each key's latest event across a diff chain.

    Every update and delete is tagged with its step; per key, the latest step
    wins, and within one step a delete outranks an update (the conservative
    reading of a step that does both). The result keeps a ``deleted`` flag, so
    callers can drop the keys whose last word was a delete.

    Args:
        updates: ``(step, glob)`` of the update files.
        deletes: ``(step, glob)`` of the delete files.
        key: The row key (``corpusid`` or ``citationid``).
        columns: The raw read schema for update rows.
        projection: Turns raw update rows into stored columns.

    Returns:
        A SELECT yielding ``deleted`` plus the stored columns (NULL for deletes).
    """
    parts = [
        f"SELECT {step} AS step, false AS deleted, * FROM ({projection(read_json(glob, columns))})"
        for step, glob in updates
    ]
    parts += [
        f"SELECT {step} AS step, true AS deleted, {key} "
        f"FROM {read_json(glob, '{' + repr(key) + ': ' + repr('BIGINT') + '}')}"
        for step, glob in deletes
    ]
    if not parts:
        # Nothing changed in this dataset: an empty, correctly keyed result.
        return f"SELECT NULL::BIGINT AS {key}, false AS deleted WHERE false"
    union = " UNION ALL BY NAME ".join(f"({part})" for part in parts)
    return (
        f"SELECT * EXCLUDE (step) FROM ({union}) "
        f"QUALIFY row_number() OVER (PARTITION BY {key} ORDER BY step DESC, deleted DESC) = 1"
    )


def _build_papers(
    connection: duckdb.DuckDBPyConnection,
    base: ReleasePaths,
    target: ReleasePaths,
    chain: list[DiffStep],
) -> None:
    """Write the target's papers: base minus touched ids plus surviving updates, clustered.

    Args:
        connection: The DuckDB connection.
        base: The release refreshed from.
        target: The release being built.
        chain: The papers diff chain.
    """
    papers_dir = target.parquet_dataset("papers")
    staging = target.parquet / "_papers_staging"
    shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(papers_dir, ignore_errors=True)
    staging.mkdir(parents=True)
    latest = _latest_events_sql(
        _event_sources(target, "papers", chain, "update"),
        _event_sources(target, "papers", chain, "delete"),
        key="corpusid",
        columns=PAPERS_COLUMNS,
        projection=papers_projection,
    )
    connection.execute(f"CREATE OR REPLACE TEMP TABLE paper_events AS {latest}")
    base_glob = (base.parquet_dataset("papers") / "*.parquet").as_posix()
    generation = uuid.uuid4().hex[:8]
    connection.execute(
        f"""
        COPY (
            SELECT {_PAPER_COLUMNS} FROM (
                SELECT {_PAPER_COLUMNS} FROM read_parquet('{base_glob}') base
                WHERE NOT EXISTS (
                    SELECT 1 FROM paper_events event WHERE event.corpusid = base.corpusid
                )
                UNION ALL
                SELECT {_PAPER_COLUMNS} FROM paper_events WHERE NOT deleted
            )
            ORDER BY corpusid
        ) TO '{staging.as_posix()}'
        (FORMAT parquet, COMPRESSION zstd, FILE_SIZE_BYTES '2GB',
         FILENAME_PATTERN '{_CLUSTERED_PREFIX}{generation}_{{i}}')
        """
    )
    connection.execute("DROP TABLE paper_events")
    staging.replace(papers_dir)


def _build_citations_inputs(
    connection: duckdb.DuckDBPyConnection,
    base: ReleasePaths,
    target: ReleasePaths,
    chain: list[DiffStep],
    scratch: Path,
) -> None:
    """Stage the per-bucket inputs: surviving updates and the base's tombstones.

    Args:
        connection: The DuckDB connection.
        base: The release refreshed from.
        target: The release being built.
        chain: The citations diff chain.
        scratch: Where the staged inputs go (``updates/`` and ``tombstones/``,
            each partitioned by bucket).
    """
    shutil.rmtree(scratch, ignore_errors=True)
    scratch.mkdir(parents=True)
    latest = _latest_events_sql(
        _event_sources(target, "citations", chain, "update"),
        _event_sources(target, "citations", chain, "delete"),
        key="citationid",
        columns=CITATIONS_COLUMNS,
        projection=citations_projection,
    )
    events = scratch / "events.parquet"
    connection.execute(f"COPY ({latest}) TO '{events.as_posix()}' (FORMAT parquet)")
    if "bucket" in _columns_of(connection, events.as_posix()):
        connection.execute(
            f"""
            COPY (
                SELECT {_CITATION_COLUMNS}, bucket FROM read_parquet('{events.as_posix()}')
                WHERE NOT deleted
            ) TO '{(scratch / "updates").as_posix()}'
            (FORMAT parquet, PARTITION_BY (bucket), OVERWRITE_OR_IGNORE)
            """
        )
    # Every base row whose citationid has a newer event — replaced or deleted —
    # found in one scan, since a delete doesn't say which bucket its row is in.
    base_glob = (base.parquet_dataset("citations") / "bucket=*" / "*.parquet").as_posix()
    connection.execute(
        f"""
        COPY (
            SELECT base.citationid, base.bucket
            FROM read_parquet('{base_glob}', hive_partitioning=true) base
            SEMI JOIN read_parquet('{events.as_posix()}') event USING (citationid)
        ) TO '{(scratch / "tombstones").as_posix()}'
        (FORMAT parquet, PARTITION_BY (bucket), OVERWRITE_OR_IGNORE)
        """
    )


def _rewrite_bucket(
    connection: duckdb.DuckDBPyConnection,
    base: ReleasePaths,
    target: ReleasePaths,
    scratch: Path,
    bucket: int,
) -> None:
    """Write one bucket of the target: base rows minus tombstones plus updates, sorted.

    Args:
        connection: The DuckDB connection.
        base: The release refreshed from.
        target: The release being built.
        scratch: The staged inputs (see :func:`_build_citations_inputs`).
        bucket: The bucket.
    """
    base_dir = base.parquet_dataset("citations") / f"bucket={bucket}"
    tombstone_dir = scratch / "tombstones" / f"bucket={bucket}"
    update_dir = scratch / "updates" / f"bucket={bucket}"
    parts = []
    if any(base_dir.glob("*.parquet")):
        survivors = f"SELECT {_CITATION_COLUMNS} FROM read_parquet('{(base_dir / '*.parquet').as_posix()}', hive_partitioning=false) base"
        if any(tombstone_dir.glob("*.parquet")):
            survivors += (
                f" ANTI JOIN read_parquet('{(tombstone_dir / '*.parquet').as_posix()}', "
                "hive_partitioning=false) tombstone USING (citationid)"
            )
        parts.append(survivors)
    if any(update_dir.glob("*.parquet")):
        parts.append(
            f"SELECT {_CITATION_COLUMNS} FROM read_parquet('{(update_dir / '*.parquet').as_posix()}', "
            "hive_partitioning=false)"
        )
    out_dir = target.parquet_dataset("citations") / f"bucket={bucket}"
    shutil.rmtree(out_dir, ignore_errors=True)
    if not parts:
        return  # an empty bucket stays absent, as ingest leaves it
    out_dir.mkdir(parents=True)
    union = " UNION ALL ".join(f"({part})" for part in parts)
    connection.execute(
        f"""
        COPY (SELECT * FROM ({union}) ORDER BY citedcorpusid)
        TO '{(out_dir / "refreshed.parquet").as_posix()}' (FORMAT parquet, COMPRESSION zstd)
        """
    )


def refresh_release(
    base_release: str,
    target_release: str,
    *,
    on_stage: StageFn | None = None,
    on_download: download.ProgressFn | None = None,
    on_overall: download.OverallFn | None = None,
) -> None:
    """Build ``target_release`` from ``base_release`` plus the diffs between them.

    Resumable: every downloaded file and finished stage is recorded in the
    target's ``refresh.json``, so rerunning after an interruption picks up
    where it stopped. Does **not** flip ``CURRENT`` (the CLI does that on
    success), so the app keeps serving the base until the target is whole.

    Args:
        base_release: An ingested release carrying ``citationid`` (usually the
            active one).
        target_release: The release to build (usually the latest).
        on_stage: Optional stage-level progress callback.
        on_download: Optional per-file download callback.
        on_overall: Optional whole-job callback: diff files while they
            download, then citation buckets while they're rewritten (see
            :data:`download.OverallFn`).

    Raises:
        CorpusError: When the corpus root is unset, the base can't be
            refreshed, the target already exists as an ingested release, or a
            download or stage fails.
    """
    if corpus_root() is None:
        raise CorpusError("config.storage.s2_corpus is not set — nothing to refresh")
    if base_release == target_release:
        raise CorpusError(f"release {base_release} is already the target — nothing to refresh")
    base = release_paths(base_release)
    target = release_paths(target_release)
    if target.parquet.exists() and not target.refresh_state.exists():
        raise CorpusError(
            f"release {target_release} already exists as an ingested release — "
            "activate it instead of refreshing"
        )

    def stage(message: str) -> None:
        """Report one stage.

        Args:
            message: What's happening.
        """
        log.info("refresh %s: %s", target_release, message)
        if on_stage:
            on_stage(message)

    connection = connect()
    try:
        _require_refreshable(connection, base)
        state = _load_state(target)
        if state.get("base", base_release) != base_release:
            raise CorpusError(
                f"release {target_release} is mid-refresh from {state['base']}, not "
                f"{base_release} — finish that refresh or delete the release first"
            )
        state["base"] = base_release
        _save_state(target, state)

        stage("downloading diffs")
        chains = _download_diffs(base_release, target, state, on_download, on_overall)

        spill = target.parquet / "_spill"
        spill.mkdir(parents=True, exist_ok=True)
        connection.execute(f"SET temp_directory='{spill.as_posix()}'")

        if not state.get("papers"):
            stage("papers: applying updates and deletes, re-clustering")
            _build_papers(connection, base, target, chains["papers"])
            stage("papers: rebuilding the arXiv index")
            shutil.rmtree(target.parquet / "arxiv_index", ignore_errors=True)
            build_arxiv_index(connection, target)
            state["papers"] = True
            _save_state(target, state)

        scratch = target.parquet / "_citations_staging"
        if not state.get("citations_inputs"):
            stage("citations: staging updates and finding replaced or deleted rows")
            _build_citations_inputs(connection, base, target, chains["citations"], scratch)
            state["citations_inputs"] = True
            state["buckets_done"] = []
            _save_state(target, state)
        stage("citations: rewriting buckets")
        done = set(state.get("buckets_done", []))
        if on_overall:
            on_overall("buckets", len(done), NBUCKETS)
        for bucket in range(NBUCKETS):
            if bucket in done:
                continue
            _rewrite_bucket(connection, base, target, scratch, bucket)
            done.add(bucket)
            # Saved per bucket: a resumed run never redoes a finished one.
            state["buckets_done"] = sorted(done)
            _save_state(target, state)
            if on_overall:
                on_overall("buckets", len(done), NBUCKETS)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(spill, ignore_errors=True)
        state["complete"] = True
        _save_state(target, state)
        stage("done")
    finally:
        connection.close()
