"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The incremental refresh (corpus/refresh.py): a two-step diff chain applied to
the synthetic release, with the Datasets API and the downloader stubbed so no
byte leaves the machine.

The chain, from the fixture's ``2026-07-07`` to ``2026-07-21``:

* step 0 (→ ``2026-07-14``): BERT's citation count rises; a new survey (6)
  arrives citing the seed; a short-lived paper (7) arrives; the recent paper
  (3) is deleted. Edges: the survey's (301) is added, BERT's first copy (101)
  is updated to not-influential, GPT-3's second copy (202) is deleted.
* step 1 (→ ``2026-07-21``): paper 3 comes back (a delete undone by a later
  update), paper 7 is deleted (an add undone by a later delete), and GPT-3's
  other copy (102) is deleted, so GPT-3 stops citing the seed.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import json
import shutil

import duckdb
import pytest

from curious_astronaut.integrations.semantic_scholar.corpus import refresh, source
from curious_astronaut.integrations.semantic_scholar.corpus.datasets import CorpusError, DiffStep
from curious_astronaut.integrations.semantic_scholar.corpus.ingest import NBUCKETS
from curious_astronaut.integrations.semantic_scholar.corpus.paths import release_paths

from .conftest import RELEASE_ID, write_gzip_jsonl

TARGET = "2026-07-21"


def paper(corpus_id: int, title: str, citations: int, **extra) -> dict:
    """A raw ``papers`` row as a diff ships it (the whole record)."""
    return {
        "corpusid": corpus_id, "externalids": extra.pop("externalids", {}), "title": title,
        "year": 2026, "publicationdate": "2026-07-10", "citationcount": citations,
        "authors": [{"name": "Author"}], "publicationtypes": extra.pop("types", None), **extra,
    }


#: Each diff file by its URL: ``(rows)``. The URL's last segment is its name.
FILES = {
    "https://s2/0/papers/update/p0.gz": [
        paper(2, "BERT", 85000, externalids={"ArXiv": "1810.04805"}, types=["JournalArticle"]),
        paper(6, "A survey of attention", 900, externalids={"ArXiv": "2607.00001"},
              types=["Review"]),
        paper(7, "Gone by next week", 1),
    ],
    "https://s2/0/papers/delete/p0d.gz": [{"corpusid": 3}],
    "https://s2/1/papers/update/p1.gz": [paper(3, "A recent applied paper", 7)],
    "https://s2/1/papers/delete/p1d.gz": [{"corpusid": 7}],
    "https://s2/0/citations/update/c0.gz": [
        {"citationid": 301, "citingcorpusid": 6, "citedcorpusid": 1, "isinfluential": True},
        {"citationid": 101, "citingcorpusid": 2, "citedcorpusid": 1, "isinfluential": False},
    ],
    "https://s2/0/citations/delete/c0d.gz": [{"citationid": 202}],
    "https://s2/1/citations/delete/c1d.gz": [{"citationid": 102}],
}


def chain(dataset: str) -> list[DiffStep]:
    """The two-step chain for one dataset, from :data:`FILES`."""
    steps = []
    for index, (start, end) in enumerate(((RELEASE_ID, "2026-07-14"), ("2026-07-14", TARGET))):
        prefix = f"https://s2/{index}/{dataset}/"
        steps.append(DiffStep(
            from_release=start, to_release=end,
            update_files=[url for url in FILES if url.startswith(prefix + "update/")],
            delete_files=[url for url in FILES if url.startswith(prefix + "delete/")],
        ))
    return steps


@pytest.fixture()
def fake_s2(monkeypatch):
    """Stub the Datasets API's diff listing and the downloader.

    Returns:
        The list of URLs "downloaded", in order (to assert a resume skips them).
    """
    fetched: list[str] = []

    def release_diffs(start, end, dataset):
        assert (start, end) == (RELEASE_ID, TARGET)
        return chain(dataset)

    def fetch_shard(release_id, dataset, filename, url, target, on_progress, *, refresh_url=None):
        fetched.append(url)
        write_gzip_jsonl(target, FILES[url])
        return target.stat().st_size

    monkeypatch.setattr(refresh.datasets, "release_diffs", release_diffs)
    monkeypatch.setattr(refresh.download, "fetch_shard", fetch_shard)
    return fetched


def bucket_rows(release_id: str, bucket: int = 1) -> dict[int, tuple]:
    """A release's rows in one citations bucket, by citationid."""
    bucket_glob = (release_paths(release_id).parquet_dataset("citations") / f"bucket={bucket}" / "*.parquet")
    rows = duckdb.sql(
        "SELECT citationid, citingcorpusid, isinfluential "
        f"FROM read_parquet('{bucket_glob.as_posix()}', hive_partitioning=false)"
    ).fetchall()
    return {row[0]: row[1:] for row in rows}


def papers(release_id: str) -> list[tuple]:
    """A release's papers as stored, in file order."""
    papers_glob = (release_paths(release_id).parquet_dataset("papers") / "*.parquet").as_posix()
    return duckdb.sql(
        f"SELECT corpusid, citationcount, publicationtypes FROM read_parquet('{papers_glob}')"
    ).fetchall()


def test_papers_take_each_ids_latest_event_and_stay_clustered(synthetic_corpus, fake_s2):
    refresh.refresh_release(RELEASE_ID, TARGET)
    rows = papers(TARGET)
    assert [row[0] for row in rows] == [1, 2, 3, 4, 6]  # sorted: still clustered
    by_id = {row[0]: row for row in rows}
    assert by_id[2][1] == 85000  # updated
    assert by_id[3][1] == 7  # deleted in step 0, back in step 1
    assert 7 not in by_id  # added in step 0, deleted in step 1
    assert by_id[6][2] == ["Review"]


def test_the_arxiv_index_is_rebuilt(synthetic_corpus, fake_s2):
    refresh.refresh_release(RELEASE_ID, TARGET)
    index_glob = (release_paths(TARGET).parquet / "arxiv_index" / "*.parquet").as_posix()
    found = duckdb.sql(
        f"SELECT corpusid FROM read_parquet('{index_glob}') WHERE arxiv_id = '2607.00001'"
    ).fetchall()
    assert found == [(6,)]


def test_citations_apply_updates_and_deletes_named_only_by_citationid(synthetic_corpus, fake_s2):
    refresh.refresh_release(RELEASE_ID, TARGET)
    rows = bucket_rows(TARGET)
    assert set(rows) == {101, 103, 201, 301}  # 102 and 202 deleted, 301 added
    assert rows[101] == (2, False)  # updated in place: no longer influential
    assert rows[301] == (6, True)


def test_the_refreshed_release_serves_and_knows_its_surveys(synthetic_corpus, fake_s2):
    refresh.refresh_release(RELEASE_ID, TARGET)
    citers = source.DuckDBCitationSource(release_paths(TARGET)).landmark_citers(
        1, max_landmark_year=2100
    )
    by_id = {entry["node"]["id"]: entry["node"] for entry in citers}
    assert "CorpusId:4" not in by_id  # both of GPT-3's edges were deleted
    assert by_id["CorpusId:2"]["citation_count"] == 85000
    assert by_id["CorpusId:6"]["is_survey"] is True


def test_the_base_release_is_never_touched(synthetic_corpus, fake_s2):
    before = bucket_rows(RELEASE_ID), papers(RELEASE_ID)
    refresh.refresh_release(RELEASE_ID, TARGET)
    assert (bucket_rows(RELEASE_ID), papers(RELEASE_ID)) == before


def test_an_interrupted_refresh_resumes_without_redoing_work(synthetic_corpus, fake_s2, monkeypatch):
    real_rewrite = refresh._rewrite_bucket
    calls = {"count": 0}

    def crash_once(connection, base, target, scratch, bucket):
        if bucket == 1 and calls["count"] == 0:
            calls["count"] += 1
            raise RuntimeError("power cut")
        real_rewrite(connection, base, target, scratch, bucket)

    monkeypatch.setattr(refresh, "_rewrite_bucket", crash_once)
    with pytest.raises(RuntimeError):
        refresh.refresh_release(RELEASE_ID, TARGET)
    state = json.loads(release_paths(TARGET).refresh_state.read_text())
    assert state["papers"] is True and state["buckets_done"] == [0]
    downloads = len(fake_s2)

    refresh.refresh_release(RELEASE_ID, TARGET)
    assert len(fake_s2) == downloads  # nothing re-downloaded
    assert set(bucket_rows(TARGET)) == {101, 103, 201, 301}
    final = json.loads(release_paths(TARGET).refresh_state.read_text())
    assert final["complete"] is True and len(final["buckets_done"]) == NBUCKETS



def test_overall_progress_counts_diff_files_then_buckets(synthetic_corpus, fake_s2):
    reported = []
    refresh.refresh_release(
        RELEASE_ID, TARGET, on_overall=lambda unit, done, total: reported.append((unit, done, total))
    )
    files = [entry for entry in reported if entry[0] == "diff files"]
    assert files[0] == ("diff files", 0, len(FILES))
    assert files[-1] == ("diff files", len(FILES), len(FILES))
    buckets = [entry for entry in reported if entry[0] == "buckets"]
    assert buckets[0] == ("buckets", 0, NBUCKETS)
    assert buckets[-1] == ("buckets", NBUCKETS, NBUCKETS)

def test_refuses_a_base_ingested_without_citationid(synthetic_corpus, fake_s2):
    """A legacy release can't apply a citation delete, so it isn't refreshed."""
    bucket_dir = release_paths(RELEASE_ID).parquet_dataset("citations") / "bucket=1"
    for parquet_file in bucket_dir.glob("*.parquet"):
        duckdb.sql(
            f"COPY (SELECT * EXCLUDE (citationid) FROM read_parquet('{parquet_file.as_posix()}', "
            f"hive_partitioning=false)) TO '{parquet_file.with_suffix('.tmp').as_posix()}' (FORMAT parquet)"
        )
        parquet_file.with_suffix(".tmp").replace(parquet_file)
    with pytest.raises(CorpusError, match="ingested before refresh existed"):
        refresh.refresh_release(RELEASE_ID, TARGET)


def test_refuses_to_overwrite_an_ingested_release(synthetic_corpus, fake_s2):
    shutil.copytree(release_paths(RELEASE_ID).parquet, release_paths(TARGET).parquet)
    with pytest.raises(CorpusError, match="already exists as an ingested release"):
        refresh.refresh_release(RELEASE_ID, TARGET)


def test_refuses_a_chain_that_does_not_reach_the_target(synthetic_corpus, fake_s2, monkeypatch):
    monkeypatch.setattr(refresh.datasets, "release_diffs", lambda start, end, dataset: chain(dataset)[:1])
    with pytest.raises(CorpusError, match="doesn't reach"):
        refresh.refresh_release(RELEASE_ID, TARGET)


def test_an_expired_diff_link_is_relisted_by_filename(monkeypatch):
    monkeypatch.setattr(refresh.datasets, "release_diffs", lambda start, end, dataset: [
        DiffStep(start, end, ["https://s2/x/a.gz?sig=new", "https://s2/x/b.gz?sig=new"], []),
    ])
    assert refresh._fresh_diff_url(RELEASE_ID, TARGET, "papers", 0, "update", "b.gz") == (
        "https://s2/x/b.gz?sig=new"
    )
    with pytest.raises(CorpusError, match="vanished"):
        refresh._fresh_diff_url(RELEASE_ID, TARGET, "papers", 0, "delete", "b.gz")


# --- the `astronaut corpus refresh` command (here for the corpus fixtures) ----


def test_cli_refresh_builds_activates_and_reports(synthetic_corpus, fake_s2, monkeypatch):
    from click.testing import CliRunner

    from curious_astronaut.cli import cli
    from curious_astronaut.integrations.semantic_scholar.corpus import datasets
    from curious_astronaut.integrations.semantic_scholar.corpus.paths import (
        corpus_root,
        read_current_release,
    )

    monkeypatch.setattr(datasets, "latest_release_id", lambda: TARGET)
    result = CliRunner().invoke(cli, ["corpus", "refresh"])
    assert result.exit_code == 0, result.output
    assert f"Refreshing {RELEASE_ID} → {TARGET}" in result.output
    assert read_current_release(corpus_root()) == TARGET
    status = CliRunner().invoke(cli, ["corpus", "status"]).output
    assert f"refreshed-from={RELEASE_ID} (complete)" in status


def test_cli_refresh_is_a_no_op_when_current(synthetic_corpus, monkeypatch):
    from click.testing import CliRunner

    from curious_astronaut.cli import cli
    from curious_astronaut.integrations.semantic_scholar.corpus import datasets

    monkeypatch.setattr(datasets, "latest_release_id", lambda: RELEASE_ID)
    result = CliRunner().invoke(cli, ["corpus", "refresh"])
    assert result.exit_code == 0 and "Already up to date" in result.output
