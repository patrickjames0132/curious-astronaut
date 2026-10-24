# `services/reader`

The Reader card's backend services, beyond the document itself (parsed in
`integrations/arxiv/document.py`) and its PDF (served by `services/pdf`):
what joins the paper being read to the rest of the app.

## `citations.py` — the citation cards (v8.43.0)

`get_citations(arxiv_id, provider)` matches each entry of the paper's
bibliography to the paper it names, so a `[12]` in the Reader can show that
paper and open it (`GET /api/paper/<arxiv_id>/cited`). It returns
`{bibliography entry id: node}`, cached a day as
`readercites:v1:<provider>:<arxiv_id>`.

- **Matched against the provider's own reference list** for the paper: Semantic
  Scholar's, or OpenAlex's for an OpenAlex thread, so a matched paper's id is
  one that thread's Citation Graph, detail panel and `openPaper` all know.
  The reference list and the bibliography are the same papers; matching them
  is the job (settled with Patrick, 2026-10-23).
- **By evidence in the entry's text, strongest first:** an arXiv id written
  in it (`arXiv:1607.06450`, `abs/1409.0473`, or in a link) equal to a
  reference's, then the reference's whole title found in it, compared as
  lowercase words. Titles under three words aren't matched on alone: "Adam"
  or "Dropout" appear in other entries. Each reference matches one entry at
  most.
- **Hydrated in one batch on S2** (`get_papers`, the detail fields), so a
  card has authors, venue and TL;DR without a request of its own. OpenAlex's
  reference nodes go out as they come; the card shows what they carry.
- **A nicety, never an error:** the route answers `{papers: {}}` for a paper
  not on arXiv or a provider that's down, and the card shows the
  bibliography's own text. A failed lookup isn't cached.
- **The PDF view has no cards.** Its citations are drawn text; parsing a
  PDF's reference list properly needs something like GROBID, a Java service,
  wrong for an easy install (OnePager, settled 2026-10-23).

Verified by `test/curious_astronaut/services/reader/test_citations.py`
(matching on the real shapes of Attention's and SAC's bibliographies, the
cache, the providers, all offline) and the route's tests.
