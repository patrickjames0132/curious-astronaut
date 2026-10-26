"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
The citing-sentences table (corpus/contexts.py) and its query
(``source.citing_sentences``), over the synthetic release.

The fixture's edges into the seed carry sentences: BERT's (twice, once per
export batch, as S2 ships it), GPT-3's two, and one from a paper with 5
citations, which is under the threshold and must not be kept. The refresh
half (a refreshed release's table built from the diffs) lives in
``test_refresh.py``, beside the diff fixtures it needs.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import shutil

import duckdb
import pytest

from curious_astronaut.integrations.semantic_scholar.corpus import contexts, source
from curious_astronaut.integrations.semantic_scholar.corpus.datasets import CorpusError
from curious_astronaut.integrations.semantic_scholar.corpus.paths import release_paths

from .conftest import RELEASE_ID, write_gzip_jsonl

SEED = {"arxiv_id": "1706.03762"}


def stored_rows(release_id: str) -> dict[int, tuple]:
    """A release's contexts rows, by citationid."""
    contexts_glob = release_paths(release_id).parquet_dataset("contexts") / "bucket=*" / "*.parquet"
    rows = duckdb.sql(
        f"SELECT citationid, citingcorpusid, contexts FROM read_parquet('{contexts_glob.as_posix()}')"
    ).fetchall()
    return {row[0]: row[1:] for row in rows}


def test_ingest_keeps_only_sentences_from_cited_enough_citers(synthetic_corpus):
    paths = release_paths(RELEASE_ID)
    assert contexts.is_complete(paths)
    rows = stored_rows(RELEASE_ID)
    # 103's citer has 5 citations; 202 has no sentence.
    assert set(rows) == {101, 102, 201}
    assert rows[102] == (4, ["We use the Transformer [7].", "Its  decoder is  autoregressive [7]."])
    # The staging is cleaned up once the table is whole.
    assert not (paths.parquet / "_contexts_staging").exists()


def test_a_citationid_shipped_in_two_shards_is_kept_once(synthetic_corpus):
    paths = release_paths(RELEASE_ID)
    # S2's real duplicates share a citationid across export batches.
    write_gzip_jsonl(paths.raw_dataset("citations") / "citations002.gz", [
        {"citationid": 101, "citingcorpusid": 2, "citedcorpusid": 1, "isinfluential": False,
         "contexts": ["However, self-attention is quadratic in the sequence length [12]."]},
    ])
    shutil.rmtree(paths.parquet_dataset("contexts"))
    contexts.build_from_raw(paths)
    rows = duckdb.sql(
        "SELECT count(*) FROM read_parquet("
        f"'{(paths.parquet_dataset('contexts') / 'bucket=*' / '*.parquet').as_posix()}') "
        "WHERE citationid = 101"
    ).fetchone()
    assert rows == (1,)


def test_a_complete_table_is_not_rebuilt(synthetic_corpus, monkeypatch):
    def fail(*args, **kwargs):
        raise AssertionError("restaged a complete table")

    monkeypatch.setattr(contexts, "_stage_shard", fail)
    contexts.build_from_raw(release_paths(RELEASE_ID))
    assert contexts.build_contexts(RELEASE_ID) == "complete"


def test_an_interrupted_build_resumes_from_its_staged_shards(synthetic_corpus, monkeypatch):
    paths = release_paths(RELEASE_ID)
    shutil.rmtree(paths.parquet_dataset("contexts"))
    real_finalize = contexts._finalize_pass

    def crash(*args):
        raise RuntimeError("power cut")

    monkeypatch.setattr(contexts, "_finalize_pass", crash)
    with pytest.raises(RuntimeError):
        contexts.build_from_raw(paths)
    assert not contexts.is_complete(paths)
    assert len(list((paths.parquet / "_contexts_staging").glob("*.parquet"))) == 2

    staged = []
    monkeypatch.setattr(contexts, "_stage_shard", lambda *args: staged.append(args))
    monkeypatch.setattr(contexts, "_finalize_pass", real_finalize)
    contexts.build_from_raw(paths)
    assert staged == []  # both shards were already staged
    assert set(stored_rows(RELEASE_ID)) == {101, 102, 201}


def test_build_contexts_refuses_a_release_with_no_route_to_its_sentences(synthetic_corpus):
    paths = release_paths(RELEASE_ID)
    shutil.rmtree(paths.parquet_dataset("contexts"))
    shutil.rmtree(paths.raw_dataset("citations"))
    with pytest.raises(CorpusError, match="nothing to read its sentences from"):
        contexts.build_contexts(RELEASE_ID)


def test_citing_sentences_ranks_citers_and_dedupes_their_sentences(synthetic_corpus):
    entries = source.citing_sentences(SEED, "arXiv:1706.03762", limit=10)
    assert [entry["node"]["title"] for entry in entries] == ["BERT", "GPT-3"]
    # BERT's sentence arrived twice (once per batch); whitespace is normalised.
    assert entries[0]["sentences"] == [
        "However, self-attention is quadratic in the sequence length [12]."
    ]
    assert entries[1]["sentences"] == ["We use the Transformer [7].", "Its decoder is autoregressive [7]."]
    assert entries[0]["node"]["id"] == "CorpusId:2"
    assert source.citing_sentences(SEED, "arXiv:1706.03762", limit=1)[0]["node"]["title"] == "BERT"


def test_citing_sentences_falls_back_without_a_complete_table(synthetic_corpus):
    paths = release_paths(RELEASE_ID)
    (paths.parquet_dataset("contexts") / contexts.COMPLETE_MARKER).unlink()
    assert source.citing_sentences(SEED, "arXiv:1706.03762", limit=10) is None


def test_citing_sentences_is_empty_for_a_paper_nobody_cites(synthetic_corpus):
    assert source.citing_sentences({"arxiv_id": "1810.04805"}, "arXiv:1810.04805", limit=10) == []


def test_cli_contexts_reports_a_complete_table(synthetic_corpus):
    from click.testing import CliRunner

    from curious_astronaut.cli import cli

    result = CliRunner().invoke(cli, ["corpus", "contexts"])
    assert result.exit_code == 0, result.output
    assert "Already complete." in result.output
    assert "contexts=True" in CliRunner().invoke(cli, ["corpus", "status"]).output
