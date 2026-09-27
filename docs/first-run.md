# First run — scoping the options

*Written 2026-08-28, scoping the Reach & access ticket "Make first-run possible
for someone who is not a developer." This exists so the build decision is made
once, with numbers, instead of re-argued each time the ticket comes up. **Two
of its steps have since shipped** — the dependency split in v7.15.0 and
Option A's packaging in v8.1.0 — and the sections below are annotated where
that changes the picture; the numbers and the reasoning are kept as written.*

Today's path to a running Curious Astronaut: install mise → it installs Python 3.14, uv,
Node and trivy → `uv sync --all-groups` → `npm install && npm run build` →
`uv run astronaut serve`. Reasonable for the person who wrote it. A wall for a
student who wants to learn something.

## The finding that reframes the question

**The install is 1.0 GB, and the app uses almost none of it.** Measured on
macOS, 2026-08-28:

| Install | Size |
| --- | --- |
| Today's `.venv` (`uv sync --all-groups`) | **1.0 GB** |
| Core only — Flask, Pydantic, PydanticAI, the vendor SDKs, sqlite-vec, huggingface-hub | **83 MB** |
| Core + PyMuPDF (PDF figure mining) | 137 MB |
| Core + PyMuPDF + DuckDB (the S2 corpus) | 181 MB |

The gap is `torch` (418 MB on its own) and what it drags with it —
`transformers`, `scipy`, `sympy`, `numpy`. On **Linux** it is worse than the
table shows: the lockfile resolves 37 `nvidia-*` CUDA packages there, which is
why CI sets `CA_SKIP_TORCH=1` rather than pay for them.

None of it is needed to explore a graph or hear a lecture. `torch` arrives via
`sentence-transformers`, which is imported in exactly one place —
`services/sources/embeddings.py:82`, inside `_get_model`, lazily — and serves
only **search over your own uploaded sources**. Likewise `fitz` (PyMuPDF, 58 MB,
and AGPL) is lazy in `services/pdf/floats.py`, and `duckdb` (43 MB) is imported
only by the two S2-corpus modules.

Three dependencies are worse than optional: **`scikit-learn`, `joblib` and
`numpy` are declared in `pyproject.toml` and imported nowhere in the repo.**
They are leftovers from the `ml_pipelines/`+`research/` plumbing deleted
2026-07-22. (`torch` is declared directly for a real reason — routing the
Windows build to the CUDA index — not because anything imports it.)

**So the first move is the same whichever distribution shape wins:** make the
heavy capabilities optional extras. It shrinks every option below by an order
of magnitude, and it is the only item here that is pure subtraction.

## What "not a developer" actually has to get past

Four separate walls, and they are not equally hard:

1. **A toolchain** — Python 3.14, uv, Node, mise. The one everybody thinks of.
2. **A build step** — `npm run build`, because `frontend/dist` is gitignored.
3. **Config** — *less broken than the ticket assumes, and **fixed outright in
   v8.1.0**.* `load_settings` already created a missing default `config.json`
   from the tracked example, so a fresh **checkout** always booted keyless with
   no config step. What was broken was the anchor: `PROJECT_ROOT = parents[2]`
   of the package file, which for an installed wheel walks past
   `site-packages/` entirely. It now resolves two ways, so an installed copy
   keeps its state in a `platformdirs` per-user dir. **This wall is gone.**
4. **Credentials** — needed for the teacher, not the explorer. Since v7.14.0
   the app runs with none.

## The three options, priced

### A. Prebuilt release artifact (`pip install`, then `astronaut serve`)

**Cost — all of it paid in v8.1.0.** Config discovery had to move off
`PROJECT_ROOT`, `frontend/dist` had to ship as package data, and
`config.example.json` with it. All three shipped: `PROJECT_ROOT` now resolves
two ways (repo root in a checkout, a `platformdirs` per-user dir once
installed), the built frontend is bundled as `curious_astronaut/_frontend/`,
and the example config is force-included. See
[history.md](history.md) for the mechanics and [bugs.md](bugs.md) for the
`parents[2]` anchor that made it necessary. **This option now works** —
`pip install .` into a clean venv serves the real SPA.

**Leaves standing:** wall 1, partly — still needs a Python and a `pip`. Nothing
else.

**Note it does *not* need PyPI.** A GitHub release asset installs with
`pip install <url>`, which sidesteps both the distribution-name question and
the PyMuPDF/AGPL blocker recorded in the PyPI ticket.
Worth separating: the packaging work is useful immediately, publishing is a
separate decision.

### B. Docker image (`docker run`)

**Cost:** a Dockerfile, a base image choice, and a published image somewhere.
The torch question is the whole story — at today's dependency set a Linux
image carries the CUDA packages and lands in the multi-GB range; with the
extras split it is a ~100 MB image. **Do not attempt this before the
dependency split.**

**Leaves standing:** nothing on the toolchain side — this is the only option
that removes wall 1 entirely. Adds its own: Docker Desktop is itself an
install, data lives in a volume the user has to reason about, and `localhost`
port mapping is one more thing to explain.

### C. Guided first-run (the app writes its own config)

**Cost:** small. Most of it exists — the settings modal already writes
`config.json`, and a missing one is already created from the example. What is
missing is the *moment*: a first-launch state that says "you have no model
provider; here are four, two are free" and links to Settings, instead of the
teacher failing on first use with a message about `config.json`.

**Leaves standing:** walls 1 and 2 entirely. This does not make Curious Astronaut
installable — it makes it *usable once installed*.

## Recommendation

Sequence, not a choice — the options are not alternatives:

1. ~~**Split the dependencies into extras**~~ — **done in v7.15.0.**
   `curious-astronaut[sources]`, `[pdf]`, `[corpus]`; the three unused
   declarations deleted. Measured after: a core install is **83 MB** and boots,
   serves a graph, and reports each missing capability by name. CI dropped from
   1.0 GB to 304 MB. PyMuPDF is now optional, so the default dependency graph
   carries no AGPL at all — the shape the Xray question needed; what is still
   open is only whether *declared* extras are flagged too (the PyPI ticket).


   Two things surfaced while doing it, both worth carrying forward.
   `corpus/source.py` imported `duckdb` at module scope and
   `integrations/semantic_scholar/__init__.py` imports `corpus`, so a
   corpus-less install could not have served a graph at all — the same shape as
   the v7.14.0 keyless crash, now guarded by a test that walks the tree. And a
   `pip install .` into a clean venv **failed on config discovery exactly as
   predicted below** (`FileNotFoundError: .../lib/python3.14/config.example.json`),
   which is the next step's first task, not a new problem.
2. ~~**Option A's packaging half**~~ — **shipped in v8.1.0**: config
   discovery off `PROJECT_ROOT`, `frontend/dist` bundled into the wheel, PyPI
   metadata. What remains is only *distributing* the artifact — a PyPI publish
   or a GitHub release asset — which is the release-automation ticket. This was
   the largest reach gain per unit of work, and it is a prerequisite for B
   anyway (a Docker image wants an installable package, not a git clone).
3. **Option C**, whenever. It is small, independent, and helps under A and B
   equally.
4. **Option B** last, if at all. It removes the most friction and costs the
   most to maintain (base image, rebuilds, a registry, a data-volume story).
   Worth doing only if the ask is genuinely "people who cannot install Python."

## Open questions

- ~~**Where should config live for an installed Curious Astronaut?**~~
  **Answered in v8.1.0: `platformdirs.user_data_dir("curious-astronaut")`** —
  `~/Library/Application Support/curious-astronaut` on macOS,
  `~/.local/share/curious-astronaut` on Linux, `%LOCALAPPDATA%` on Windows.
  Not a hand-rolled `~/.config/…`, because platformdirs already encodes each
  platform's convention and the app is cross-platform. The framing that made
  it easy: the question is not "where does config go" but **which things are
  writable state and which are shipped assets** — state follows
  `PROJECT_ROOT` (now per-user when installed), assets follow `PACKAGE_DIR`
  (always inside the package). The `.config-location` sidecar and
  `StorageConfig`'s repo-root-relative paths still work, because an editable
  install still reads as a checkout.
- ~~**Does a torch-free install degrade honestly?**~~ **Answered in v7.15.0:
  yes.** `optional.require` raises a `MissingExtra` naming the capability and
  the command, and `optional.available` is the ask-before-doing half the
  embedder uses to log one line about falling back to lexical search instead of
  dumping a traceback. What is *not* yet verified is the full UI path — nobody
  has uploaded a PDF to a core-only install and watched what the browser shows.
- **Who is the reader?** "A student" is doing a lot of work in the ticket. A
  student with a laptop and no terminal experience needs B. A grad student who
  has used `pip` needs A. These have very different costs and the answer
  changes the sequencing above.
