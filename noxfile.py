"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Quality gate for Curious Astronaut — run every check with ``uv run nox``.

Five sessions, all run by default: ``precommit`` (pre-commit hooks, incl. ruff
and the frontend's prettier/oxlint), ``mypy`` (type checks), ``tests``
(pytest), ``vitest`` (the frontend suite in ``frontend/test``), and
``security`` (a Trivy filesystem scan). Sessions reuse the active uv
environment (``venv_backend="none"``) rather than building their own, so
``uv run nox`` needs no per-session installs — the Python tools come from the
``dev`` dependency group; vitest comes from ``frontend/node_modules`` (the
session-start ``bin/setup`` installs it).

Trivy is an external binary (not a Python package); the ``security`` session
skips itself cleanly when ``trivy`` isn't on PATH (as ``vitest`` does without
npm), so ``uv run nox`` stays green on machines that don't have it installed.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import shutil

import nox

# Reuse the uv-managed env; don't spin up a venv per session.
nox.options.default_venv_backend = "none"
# Bare `uv run nox` runs all five gates, in this order.
nox.options.sessions = ["precommit", "mypy", "tests", "vitest", "security"]


@nox.session
def precommit(session: nox.Session) -> None:
    """Run every pre-commit hook (file hygiene + ruff lint) over the whole tree."""
    session.run("pre-commit", "run", "--all-files", external=True)


@nox.session
def mypy(session: nox.Session) -> None:
    """Type-check the backend package (config in ``pyproject.toml``)."""
    session.run("mypy")


@nox.session
def tests(session: nox.Session) -> None:
    """Run the unit-test suite (``test/``), passing through any extra args."""
    session.run("pytest", *session.posargs)


@nox.session
def vitest(session: nox.Session) -> None:
    """Run the frontend test suite (``frontend/test``, Vitest; skipped without npm).

    Args:
        session: The nox session (pass-through args go to vitest).
    """
    if shutil.which("npm") is None:
        session.skip("npm not on PATH — install Node to enable the frontend tests")
    session.run(
        "npm", "run", "test", "--prefix", "frontend", "--silent", "--", *session.posargs,
        external=True,
    )


@nox.session
def security(session: nox.Session) -> None:
    """Scan for vulnerable dependencies and committed secrets with Trivy.

    Two runs, not one, because the two scanners need opposite failure
    policies. **Vulnerabilities fail the gate** at HIGH or above: until
    v8.2.0 this session called ``trivy fs`` with no ``--exit-code``, so it
    reported findings and then exited 0 — which meant a CRITICAL CVE in
    ``anyio`` printed inside a run whose summary said ``security: success``,
    and it shipped. A check that cannot fail is documentation, not a gate.
    MEDIUM and LOW still print without blocking, so the bar stays at the
    severities worth interrupting work for.

    **Secrets only report**, and deliberately skip ``config.json`` and
    ``.env``. Both are gitignored and both are *supposed* to hold live API
    keys, so failing on them would leave the gate permanently red on every
    machine that has ever run the app. What we actually want to catch is a
    key in a *tracked* file, and those are still scanned and reported.

    To waive a specific finding, add it to a ``.trivyignore`` with a comment
    saying why and when to revisit — don't reach for ``--severity`` or drop
    the exit code.

    Args:
        session: The nox session.
    """
    if shutil.which("trivy") is None:
        session.skip("trivy not on PATH — install it to enable the security scan")
    session.run(
        "trivy", "fs", "--scanners", "vuln", "--exit-code", "1",
        "--severity", "HIGH,CRITICAL", ".", external=True,
    )
    session.run(
        "trivy", "fs", "--scanners", "secret",
        "--skip-files", "config.json", "--skip-files", ".env", ".", external=True,
    )
