"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Keep the sentences in which citing papers cite a paper: the corpus's contexts table.

The raw ``citations`` dataset carries, per edge, the sentence(s) where the
citing paper cites the cited one (``contexts``). Ingest drops them: the graph
only needs the edge. The Peer Reviews card needs them, and it needs them for
the *most-cited* citers, which is the ranking only the corpus can serve (the
live endpoint returns citers newest-first). So this module stores them, in a
table of its own beside ``citations``:

    parquet/contexts/bucket=<N>/contexts_<i>.parquet
    parquet/contexts/_COMPLETE.json

**Only citers with at least** :data:`MIN_CITER_CITATIONS` **citations are
kept.** All the sentences would be ~258 GB of Parquet (~140 GB once
deduplicated); the card reads only each paper's ~200 most-cited citers. N = 50
was chosen 2026-10-25 from a measurement on four random raw shards plus the
real corpus: it keeps ~248M sentence rows (~42 GB as shipped, ~23 GB
deduplicated), and it keeps 100% of the top-200 citers of every landmark
measured (Attention, ResNet, Adam, BERT, DDPM, DQN: the 200th citer has
376–3,762 citations), 99% for papers cited 2,000–10,000 times, and 85% for
500–2,000. Below ~500 citations a paper has too few critiques to fill a card
at any N, and the card says so. The threshold is applied with the citation
counts of the release being built; a citer that crosses it later only gains
its sentences at the next full ingest.

**The build, in two stages, both resumable:**

1. **Stage** each raw citations shard: keep edges with a sentence whose citer
   is eligible, sorted by bucket, one file per shard. A plain single-file COPY,
   not a 1024-way ``PARTITION_BY``, which slows as its process ages (see
   ``ingest._SHARDS_PER_WORKER``); the output is ~15% of the edges anyway.
2. **Finalize** the staged rows into buckets, :data:`_BUCKETS_PER_PASS` at a
   time, **deduplicated by ``citationid``**. S2 ships each edge about twice
   (overlapping export batches; see ``docs/bugs.md``), and the copies share a
   ``citationid``, but they sit in different shards, so only a pass over all
   the staged shards can collapse them. ``citations`` leaves that to the query;
   here it halves the table, so it's done once.

``_COMPLETE.json`` is written last, and the query side reads the table only
when it's there: a half-built table is "no contexts", never a partial answer
labelled complete. A release built by ``refresh`` gets its table from the base
release's plus the diffs (``refresh.py``); :func:`build_contexts` picks the
path from what the release has.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from .datasets import CorpusError
from .ingest import NBUCKETS, connect, read_json
from .paths import ReleasePaths

if TYPE_CHECKING:  # duckdb is an optional extra; annotations only here
    import duckdb

log = logging.getLogger(__name__)

#: A citer needs at least this many citations for its sentences to be kept.
#: Measured, not guessed: see the module docstring for the table it came from.
MIN_CITER_CITATIONS = 50

#: The raw read schema: the edge's keys plus its sentences. ``intents`` is
#: left behind: it has no "disagrees" value and is mostly null.
CONTEXTS_COLUMNS = (
    "{'citationid': 'BIGINT', 'citingcorpusid': 'BIGINT', 'citedcorpusid': 'BIGINT', "
    "'contexts': 'VARCHAR[]'}"
)

#: The stored columns, in order (the bucket is the directory, not a column).
STORED_COLUMNS = "citationid, citingcorpusid, citedcorpusid, contexts"

#: The dataset's directory under ``parquet/``.
DATASET = "contexts"

#: Written last; the table is served only when it exists.
COMPLETE_MARKER = "_COMPLETE.json"

#: Buckets finalized per pass. Each pass rereads every staged shard (pruned to
#: its bucket range by the shard's sort order), so fewer, wider passes read
#: less; 64 keeps each pass's partitioned write far below the open-file limit.
_BUCKETS_PER_PASS = 64

#: The temp table of eligible citer ids, built once per connection.
_ELIGIBLE_TABLE = "eligible_citers"

#: Progress callback: ``(unit, done, total)``, like ``download.OverallFn``.
OverallFn = Callable[[str, int, int], None]


def contexts_projection(source_sql: str) -> str:
    """The SELECT that turns raw citation rows into contexts rows (with ``bucket``).

    Unfiltered: rows without a sentence, or from an ineligible citer, still
    come through, because the refresh needs every update as an event (a newer
    version of an edge must retire the old one even when the new one isn't
    kept). Callers filter with :func:`kept_sql`.

    Args:
        source_sql: A FROM-able source of raw rows read with :data:`CONTEXTS_COLUMNS`.

    Returns:
        The SELECT, without an ORDER BY.
    """
    return f"""
        SELECT
            citationid,
            citingcorpusid,
            citedcorpusid,
            contexts,
            citedcorpusid % {NBUCKETS} AS bucket
        FROM {source_sql}
        WHERE citedcorpusid IS NOT NULL AND citingcorpusid IS NOT NULL
    """


def kept_sql(alias: str = "") -> str:
    """The WHERE condition for a row worth keeping: a sentence and an eligible citer.

    Needs :func:`load_eligible_citers` to have run on the connection.

    Args:
        alias: The row's table alias, if the query uses one.

    Returns:
        A SQL boolean expression.
    """
    prefix = f"{alias}." if alias else ""
    return (
        f"len({prefix}contexts) > 0 AND {prefix}citingcorpusid IN "
        f"(SELECT corpusid FROM {_ELIGIBLE_TABLE})"
    )


def load_eligible_citers(connection: duckdb.DuckDBPyConnection, paths: ReleasePaths) -> None:
    """Load the ids of every paper cited at least :data:`MIN_CITER_CITATIONS` times.

    ~12M ids on the 2026-10-20 release (of 239M papers), so a temp table in
    memory, built once and reused by every shard.

    Args:
        connection: The DuckDB connection.
        paths: The release whose citation counts decide eligibility.
    """
    papers_glob = (paths.parquet_dataset("papers") / "*.parquet").as_posix()
    connection.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE {_ELIGIBLE_TABLE} AS
        SELECT corpusid FROM read_parquet('{papers_glob}')
        WHERE citationcount >= {MIN_CITER_CITATIONS}
        """
    )


def is_complete(paths: ReleasePaths) -> bool:
    """Whether a release's contexts table is whole.

    Args:
        paths: The release.

    Returns:
        True once the build has written its completion marker.
    """
    return (paths.parquet_dataset(DATASET) / COMPLETE_MARKER).exists()


def mark_complete(paths: ReleasePaths, source: str) -> None:
    """Write the completion marker: the table may now be served.

    Args:
        paths: The release.
        source: How it was built (``raw`` or ``refresh``), recorded for the
            operator alongside the threshold in force.
    """
    out_dir = paths.parquet_dataset(DATASET)
    out_dir.mkdir(parents=True, exist_ok=True)
    marker = {"min_citer_citations": MIN_CITER_CITATIONS, "source": source}
    (out_dir / COMPLETE_MARKER).write_text(json.dumps(marker), encoding="utf-8")


def _stage_shard(connection: duckdb.DuckDBPyConnection, shard: Path, staging: Path) -> None:
    """Write one raw shard's kept rows, sorted by bucket, as one staged file.

    Written under a temporary name and renamed into place, so a staged file's
    existence means it's whole: that is the stage's resume marker.

    Args:
        connection: The DuckDB connection (eligible citers loaded).
        shard: The raw ``.gz`` citations shard.
        staging: The staging directory.
    """
    out_file = staging / (shard.stem + ".parquet")
    partial = staging / (shard.stem + ".partial")
    rows = contexts_projection(read_json(shard.as_posix(), CONTEXTS_COLUMNS))
    connection.execute(
        f"""
        COPY (
            SELECT * FROM ({rows}) WHERE {kept_sql()}
            ORDER BY bucket, citedcorpusid
        ) TO '{partial.as_posix()}' (FORMAT parquet, COMPRESSION zstd)
        """
    )
    partial.replace(out_file)


def _finalize_pass(
    connection: duckdb.DuckDBPyConnection, staging: Path, out_dir: Path, first_bucket: int
) -> None:
    """Write one range of buckets from the staged rows, one copy per ``citationid``.

    Args:
        connection: The DuckDB connection.
        staging: The staged shards.
        out_dir: ``parquet/contexts``.
        first_bucket: The range's first bucket; it spans :data:`_BUCKETS_PER_PASS`.
    """
    last_bucket = min(first_bucket + _BUCKETS_PER_PASS, NBUCKETS) - 1
    for bucket in range(first_bucket, last_bucket + 1):
        # A rerun of an interrupted pass starts its buckets clean.
        shutil.rmtree(out_dir / f"bucket={bucket}", ignore_errors=True)
    staged_glob = (staging / "*.parquet").as_posix()
    connection.execute(
        f"""
        COPY (
            SELECT {STORED_COLUMNS}, bucket FROM read_parquet('{staged_glob}')
            WHERE bucket BETWEEN {first_bucket} AND {last_bucket}
            QUALIFY row_number() OVER (PARTITION BY citationid ORDER BY len(contexts) DESC) = 1
            ORDER BY bucket, citedcorpusid
        ) TO '{out_dir.as_posix()}'
        (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (bucket),
         FILENAME_PATTERN 'contexts_{{i}}', OVERWRITE_OR_IGNORE)
        """
    )


def build_from_raw(paths: ReleasePaths, *, on_overall: OverallFn | None = None) -> None:
    """Build a release's contexts table from its raw citations shards.

    A no-op on a release whose table is already complete (the staging is
    deleted on completion, so a rebuild would restage every shard); delete
    ``parquet/contexts`` to force one.

    Args:
        paths: The release (its raw citations shards and ingested papers are read).
        on_overall: Optional whole-job callback: shards staged, then bucket passes.

    Raises:
        CorpusError: When the release has no raw citations shards or no
            ingested papers.
    """
    if is_complete(paths):
        return
    shards = sorted(paths.raw_dataset("citations").glob("*.gz"))
    if not shards:
        raise CorpusError(f"no raw citations shards under {paths.raw_dataset('citations')}")
    if not any(paths.parquet_dataset("papers").glob("*.parquet")):
        raise CorpusError(f"release {paths.release_id} has no ingested papers to rank citers by")
    out_dir = paths.parquet_dataset(DATASET)
    staging = paths.parquet / "_contexts_staging"
    staging.mkdir(parents=True, exist_ok=True)
    pass_markers = staging / "_passes"
    connection = connect()
    try:
        spill = paths.parquet / "_spill"
        spill.mkdir(parents=True, exist_ok=True)
        connection.execute(f"SET temp_directory='{spill.as_posix()}'")
        load_eligible_citers(connection, paths)
        for index, shard in enumerate(shards):
            if on_overall:
                on_overall("shards staged", index, len(shards))
            if (staging / (shard.stem + ".parquet")).exists():
                continue
            _stage_shard(connection, shard, staging)
        if on_overall:
            on_overall("shards staged", len(shards), len(shards))
        out_dir.mkdir(parents=True, exist_ok=True)
        pass_markers.mkdir(exist_ok=True)
        passes = list(range(0, NBUCKETS, _BUCKETS_PER_PASS))
        for index, first_bucket in enumerate(passes):
            if on_overall:
                on_overall("bucket passes", index, len(passes))
            marker = pass_markers / f"{first_bucket}.ok"
            if marker.exists():
                continue
            _finalize_pass(connection, staging, out_dir, first_bucket)
            marker.touch()
        if on_overall:
            on_overall("bucket passes", len(passes), len(passes))
        mark_complete(paths, "raw")
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(spill, ignore_errors=True)
    finally:
        connection.close()


def build_contexts(release_id: str, *, on_overall: OverallFn | None = None) -> str:
    """Build a release's contexts table by whichever route the release allows.

    From the release's own raw shards when they're on disk. Otherwise, for a
    release built by ``refresh``, from its base release's table plus the
    citation diffs still in its ``diffs/`` (building the base's first, from
    the base's raw shards, when needed). A no-op when the table is complete.

    Args:
        release_id: The ingested release.
        on_overall: Optional whole-job callback.

    Returns:
        What was done: ``"complete"`` (already), ``"raw"`` or ``"refresh"``.

    Raises:
        CorpusError: When neither route is open: no raw shards, and no refresh
            base with a table (or raw shards to build one) and diffs.
    """
    from . import refresh
    from .paths import release_paths

    paths = release_paths(release_id)
    if is_complete(paths):
        return "complete"
    if any(paths.raw_dataset("citations").glob("*.gz")):
        build_from_raw(paths, on_overall=on_overall)
        return "raw"
    state = refresh.load_state(paths)
    base_id = state.get("base")
    if not state.get("complete") or not base_id:
        raise CorpusError(
            f"release {release_id} has no raw citations shards and wasn't built by a "
            "refresh, so there's nothing to read its sentences from"
        )
    base = release_paths(base_id)
    if not is_complete(base):
        log.info("building the base release %s's contexts first", base_id)
        build_contexts(base_id, on_overall=on_overall)
    refresh.refresh_contexts(base_id, release_id, on_overall=on_overall)
    return "refresh"
