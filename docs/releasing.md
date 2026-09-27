# Releasing — cutting a version and publishing it

The runbook for shipping a release, end to end. Written 2026-09-27, the day
`curious-astronaut` first reached PyPI, because the pipeline's knowledge was
spread across a workflow file's comments, two sections of `CLAUDE.md`, and two
web UIs that no diff can see.

> **The headline, if you read nothing else: pushing a `v*` tag publishes to
> PyPI.** `git push origin main --follow-tags` — the command `CLAUDE.md` gives
> for a release — therefore publishes as a side effect. A PyPI version can
> **never be replaced**, only yanked, so that push is the irreversible step.

## What a tag push actually does

`.github/workflows/release.yml` runs four jobs in order. Any failure stops the
ones after it.

| Job | Does | Fails when |
| --- | --- | --- |
| `version-matches-tag` | Asserts the tag equals `pyproject.toml`'s `version` | You tagged without bumping, or bumped without re-tagging |
| `build` | `npm ci` → `npm run build` → `uv build` → **verify artifacts** | The frontend didn't build, or an artifact looks wrong (below) |
| `testpypi` | Uploads to TestPyPI (`skip-existing: true`) | The version is new but the upload is rejected |
| `pypi` | Uploads to **PyPI**. `if: github.ref_type == 'tag'` | Anything above failed |

`pypi` declares `needs: testpypi`, and both download the **same artifact** from
the one `build` job. That is the property the whole design exists to protect:
what gets rehearsed on TestPyPI is byte-for-byte what lands on PyPI. Don't
restructure this into separate builds — the rehearsal stops meaning anything.

**`skip-existing` is on TestPyPI only, deliberately.** It lets a re-run pass
when TestPyPI already holds that version. It is *not* on the `pypi` job: a
duplicate upload there should be a loud failure, not a silent skip.

### The ordering that is easy to break

**`npm run build` must precede `uv build`.** `hatch_build.py` bundles
`frontend/dist` into the wheel *when it exists* and skips quietly when it
doesn't — it has to, because `frontend/dist` is gitignored and hatchling
hard-fails on a missing `force-include` source, which would break `uv sync` on a
fresh clone. The price of that tolerance: a wheel built in the wrong order is a
**valid** wheel that serves "Frontend not built yet" instead of the app.

Also note **`uv build` builds the wheel from the sdist**, so anything the sdist
excludes vanishes from the wheel too. That's why `pyproject.toml` carries
`artifacts = ["frontend/dist/**"]` *and* lists `frontend/dist` in the sdist
`include`.

### What `verify artifacts` checks

Encoded from a hand audit, because every one of these is permanent once
uploaded:

- the wheel contains `curious_astronaut/_frontend/index.html` (the ordering trap)
- the wheel contains `config.example.json` (without it a fresh install can't
  write its first `config.json`)
- the sdist still carries `frontend/src` (so work can rebuild the frontend)
- **neither** archive contains `config.json`, `.env`, `.pypirc`, anything under
  `data/`, or a `.db`/`.log` file. `config.json` is the dangerous one: it holds
  live API keys, it's gitignored, and the sdist's allowlist `include` is the only
  thing keeping it out.

## The ritual

1. Bump `version` in `pyproject.toml`, then `uv lock`. SemVer — see
   `CLAUDE.md`.
2. Commit on the feature branch, merge `--no-ff` into `main`.
3. Annotated tag `vX.Y.Z` on the merge commit.
4. `git push origin main --follow-tags` — **this publishes.** To push the code
   without publishing, `git push origin main` alone and hold the tag.
5. `git switch --detach main`, delete the feature branch.
6. **Read the run**: `gh run list`, `gh run view <id> --log-failed`. Don't assume
   it passed.

**Rehearsing without releasing:** Actions → Release → *Run workflow* from
`main`. It takes no inputs and publishes to **TestPyPI only**. Use this after
changing anything about packaging or the workflow.

## Setup that lives outside the repo

Nothing here is in version control, nothing reviews it, and it is what breaks
after an account change. Recorded so it can be recreated.

**Trusted publishing (OIDC) — no API token exists.** PyPI verifies a short-lived
token minted by the runner against a publisher config naming this repo, the
**workflow filename**, and the job's **environment**. So renaming `release.yml`
or an environment silently breaks publishing until PyPI is updated to match.
Don't "simplify" by adding a token.

**Pending publisher**, registered identically on **PyPI** and **TestPyPI**
(separate accounts, separate 2FA):

| Field | Value |
| --- | --- |
| PyPI Project Name | `curious-astronaut` |
| Owner | `patrickjames0132` ← the **GitHub** username |
| Repository name | `curious-astronaut` |
| Workflow name | `release.yml` |
| Environment name | `pypi` / `testpypi` |

The PyPI account is `patrickjames`; GitHub is `patrickjames0132`. Owner wants the
**GitHub** one — they differ by a suffix, and a mismatch surfaces as an opaque
OIDC rejection at upload time, not a clear error.

**GitHub environments** (repo Settings → Environments). *Deployment branches and
tags* needs a rule per **ref type**, and the type dropdown defaults to *Branch*:

| Environment | Rules | Why |
| --- | --- | --- |
| `testpypi` | branch `main` **and** tag `v*` | Serves both triggers — dispatch runs on a branch, release on a tag |
| `pypi` | tag `v*` only | Nothing but a tag should reach PyPI |

`pypi`'s rule and the `if: github.ref_type == 'tag'` on that job say the same
thing on purpose. Change one without the other and publishing either widens
silently or starts failing.

**Required reviewers** on `pypi` are what make the irreversible upload wait for a
human. As of 2026-09-27 none were set, and 8.3.0 published with no prompt —
check this rather than assuming a tag push pauses.

## When it goes wrong

**Before anything reached PyPI** — just fix and re-tag. Delete the local tag,
commit, re-tag, push. Cheap, and the reason `pypi` sits behind `testpypi`.

**`Tag "vX.Y.Z" is not allowed to deploy to <env> due to environment protection
rules`** — that environment has no tag rule. See the table above. This failed
twice (once against a `test` branch, once against `main`) and it fails *only* on
the real trigger, because the rehearsal runs on a branch and passes regardless.

**TestPyPI already holds the version you're fixing** — don't reuse it.
`skip-existing` will keep TestPyPI's *old* files, so the rehearsal would no
longer match what ships. Bump instead. This is exactly why v8.2.0 was abandoned
and 8.3.0 became the first published version; `v8.2.0` remains a git tag that
never reached PyPI.

**A bad version reached PyPI** — you cannot replace it. Two moves:

- **Yank it** (PyPI → Manage → the release → Yank). A yanked version stays
  installable by exact pin but is skipped by normal resolution, so it stops
  reaching new users without breaking anyone who pinned it. Yanking is
  reversible; deleting is not.
- **Ship the fix as a new version.** Never delete-and-reupload: PyPI refuses a
  filename it has seen before, even after deletion.

**The `gh` token expired** (2026-10-27) — `gh` stops reading runs, and if
`gh auth login` reconfigured git's credential helper, pushes 403 at the same
time. See the auth notes; a fine-grained PAT needs **Contents: Read and write**
to push code and **Workflows: Read and write** to push anything under
`.github/workflows/`.

## Invariants

Worth stating because each one has already cost something:

- **One build feeds both uploads.** Separate builds make the dry run worthless.
- **TestPyPI is not skippable.** There is no manual route to PyPI: the dispatch
  takes no inputs, and `pypi` only runs on a tag.
- **A tag is the only route to PyPI.**
- **Verify artifacts never gets relaxed.** It exists because the failure modes
  are permanent.
- **`uv build` must not see a cache directory inside the source tree** — that's
  why `release.yml` sets no `UV_CACHE_DIR` although `ci.yml` does. `ci.yml` only
  runs `uv sync`/`uv run`, which don't care. Don't tidy the inconsistency away.

Related: `CLAUDE.md` ("Release mechanics", "Quality gate"),
[history.md](history.md) for why the pipeline is shaped this way, and
[bugs.md](bugs.md) for the tag-vs-branch trap.
