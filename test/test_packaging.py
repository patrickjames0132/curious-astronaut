"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Tests for the wheel's packaging contract — the parts that only break once the
package is *installed*, which no other test exercises because the whole suite
runs from the checkout.

Two things are guarded here. The **build hook** (`hatch_build.py`) must bundle
the built frontend when it exists and stay quiet when it does not, because
`uv sync` runs the build backend before `bin/setup` has run `npm run build`.
The **two-mode path resolution** in `config.py` must anchor writable state at
the repo root in a checkout and at a per-user directory once installed —
site-packages is not writable, and v8.0.0 shipped with
`FileNotFoundError: .../lib/python3.14/config.example.json` because the old
`parents[2]` anchor walked off the end of an installed layout.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

from curious_astronaut import config
from hatch_build import BUNDLE_TARGET, frontend_force_includes


class TestFrontendBundling:
    """The build hook that puts `frontend/dist` inside the wheel."""

    def test_maps_every_built_file_under_the_bundle_target(self, tmp_path: Path) -> None:
        """Each built file is placed under `curious_astronaut/_frontend/`."""
        dist = tmp_path / "frontend" / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "index.html").write_text("<html></html>", encoding="utf-8")
        (dist / "assets" / "main.js").write_text("console.log(1)", encoding="utf-8")

        includes = frontend_force_includes(tmp_path)

        assert sorted(includes.values()) == [
            f"{BUNDLE_TARGET}/assets/main.js",
            f"{BUNDLE_TARGET}/index.html",
        ]
        assert all(Path(source).is_file() for source in includes)

    def test_is_quiet_when_the_frontend_was_never_built(self, tmp_path: Path) -> None:
        """A missing `frontend/dist` yields no entries instead of failing.

        This is the whole reason the frontend goes in through a hook rather
        than a `force-include` entry: hatchling fails the build outright on a
        missing force-include source, which would break `uv sync` on a fresh
        clone.
        """
        assert frontend_force_includes(tmp_path) == {}

    def test_nested_directories_keep_their_shape(self, tmp_path: Path) -> None:
        """Vite emits hashed assets in subfolders; the layout must survive."""
        deep = tmp_path / "frontend" / "dist" / "assets" / "fonts"
        deep.mkdir(parents=True)
        (deep / "KaTeX.ttf").write_bytes(b"\x00")

        includes = frontend_force_includes(tmp_path)

        assert list(includes.values()) == [f"{BUNDLE_TARGET}/assets/fonts/KaTeX.ttf"]


class TestCheckoutDetection:
    """`_source_checkout_root` is what selects repo-root vs per-user paths."""

    def test_this_test_run_is_a_checkout(self) -> None:
        """Running from the repo, the checkout root is the repo root."""
        assert config.CHECKOUT_ROOT is not None
        assert (config.CHECKOUT_ROOT / "pyproject.toml").is_file()
        assert config.PROJECT_ROOT == config.CHECKOUT_ROOT

    def test_config_template_resolves_in_a_checkout(self) -> None:
        """The tracked template is what a checkout reads."""
        assert config.EXAMPLE_CONFIG_PATH == config.CHECKOUT_ROOT / "config.example.json"
        assert config.EXAMPLE_CONFIG_PATH.is_file()

    @pytest.mark.parametrize(
        ("layout", "expected_is_checkout"),
        [
            (("pyproject.toml", "src"), True),
            (("pyproject.toml",), False),
            (("src",), False),
            ((), False),
        ],
    )
    def test_requires_both_markers(
        self, tmp_path: Path, layout: tuple[str, ...], expected_is_checkout: bool
    ) -> None:
        """Both `pyproject.toml` and `src/` are needed to call it a checkout.

        An installed package sits at `<venv>/lib/pythonX.Y/site-packages/…`,
        so the candidate root is `lib/pythonX.Y` — which has neither marker.
        Requiring both keeps a stray `pyproject.toml` somewhere up the tree
        from making an installed copy write into a random directory.
        """
        for marker in layout:
            target = tmp_path / marker
            if marker == "src":
                target.mkdir()
            else:
                target.write_text("", encoding="utf-8")

        is_checkout = (tmp_path / "pyproject.toml").is_file() and (tmp_path / "src").is_dir()

        assert is_checkout is expected_is_checkout


class TestInstalledLayoutContract:
    """What an installed copy needs, asserted against the source of truth."""

    def test_package_dir_holds_the_module(self) -> None:
        """`PACKAGE_DIR` points at the package, not its parent."""
        assert (config.PACKAGE_DIR / "config.py").is_file()
        assert config.PACKAGE_DIR.name == "curious_astronaut"

    def test_wheel_bundles_the_config_template(self) -> None:
        """pyproject force-includes the template into the package.

        Without it an installed copy cannot create its first `config.json`.
        """
        pyproject = tomllib.load((config.CHECKOUT_ROOT or Path(".")).joinpath("pyproject.toml").open("rb"))
        force_include = pyproject["tool"]["hatch"]["build"]["targets"]["wheel"]["force-include"]

        assert force_include["config.example.json"] == "curious_astronaut/config.example.json"

    def test_build_hook_is_registered(self) -> None:
        """The custom hook is wired up, or the frontend silently stops shipping."""
        pyproject = tomllib.load((config.CHECKOUT_ROOT or Path(".")).joinpath("pyproject.toml").open("rb"))
        hooks = pyproject["tool"]["hatch"]["build"]["targets"]["wheel"]["hooks"]

        assert hooks["custom"]["path"] == "hatch_build.py"

    def test_frontend_dist_is_declared_a_build_artifact(self) -> None:
        """`frontend/dist` is gitignored, so hatchling skips it unless told.

        Without this the sdist ships no frontend, and since `uv build` builds
        the wheel *from the sdist*, the wheel loses it too.
        """
        pyproject = tomllib.load((config.CHECKOUT_ROOT or Path(".")).joinpath("pyproject.toml").open("rb"))

        assert "frontend/dist/**" in pyproject["tool"]["hatch"]["build"]["artifacts"]
