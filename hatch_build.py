"""Copyright (c) 2026 Charles Patrick James <charles.patrick.james@gmail.com>. MIT License — see LICENSE.

Description:
Hatchling build hook that bundles the built React frontend into the wheel.

`astronaut serve` has to work from an installed wheel, with no checkout
anywhere nearby, so the contents of ``frontend/dist`` ship *inside* the
package as ``curious_astronaut/_frontend/`` and ``app.py`` prefers that copy
over the checkout's ``frontend/dist``.

**Why a hook rather than a plain ``force-include`` entry.** ``frontend/dist``
is a build artifact and is gitignored, so it does not exist in a fresh clone —
and hatchling *fails the build* when a ``force-include`` source is missing.
That would break `uv sync`, which runs this backend to make the editable
install **before** `bin/setup` has had a chance to run `npm run build`. A hook
can look first and skip quietly, so the frontend is bundled when it has been
built and simply absent when it has not.

The consequence worth knowing: **a wheel built without running `npm run build`
first serves the "Frontend not built yet" hint instead of the app.** Release
automation must build the frontend before building the wheel; there is a test
(`test/test_packaging.py`) asserting the hook picks the files up when the
directory is present.

Authors:
Charles Patrick James <charles.patrick.james@gmail.com>
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

#: Where the built frontend is read from, relative to the repo root.
FRONTEND_DIST = Path("frontend") / "dist"

#: Where it lands inside the wheel, relative to site-packages.
BUNDLE_TARGET = "curious_astronaut/_frontend"


def frontend_force_includes(root: Path) -> dict[str, str]:
    """Map every built frontend file to its path inside the wheel.

    Args:
        root: The repo root the build is running from.

    Returns:
        A ``{source path: path inside the wheel}`` mapping, empty when the
        frontend has not been built.
    """
    dist = root / FRONTEND_DIST
    if not dist.is_dir():
        return {}
    return {
        str(item): f"{BUNDLE_TARGET}/{item.relative_to(dist).as_posix()}"
        for item in sorted(dist.rglob("*"))
        if item.is_file()
    }


class CustomBuildHook(BuildHookInterface):  # type: ignore[type-arg]
    """Adds the built frontend to the wheel when it is present."""

    def initialize(self, version: str, build_data: dict[str, Any]) -> None:
        """Merge the frontend's files into the build's force-include map.

        Args:
            version: The build target's version (unused; hatchling's hook API
                passes it to every hook).
            build_data: The mutable build description; its ``force_include``
                entry is what actually places extra files in the wheel.

        Returns:
            None (mutates ``build_data`` in place).
        """
        build_data.setdefault("force_include", {}).update(frontend_force_includes(Path(self.root)))
