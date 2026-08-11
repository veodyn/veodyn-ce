"""
Every registered, non-deprecated query runner needs a logo asset in the app.

data-source-logo.tsx
(app/src/components/data-sources/data-source-logo.tsx) builds the logo
path directly from the data source's type string: `/db-logos/${type}.png`.
It falls back to a generic icon on load failure, but a registered type with
no matching file still shows that generic icon where every other connector
shows its real logo.

The logo files were vendored into app/public/db-logos/ when this fork's
client/ was deleted (they used to ship from PreviewCard.jsx and
QuerySourceTypeIcon.jsx, both deleted with it). This test's own container
cannot reach them: it is a bind mount of node/ only (see ../../compose.yaml
and ../../.ci/compose.ci.yaml, neither of which mounts or builds anything
from outside node/), so there is no path from here into app/, in
`docker exec` or in CI.

So the guard is split at that boundary, and each half runs where it can see
what it checks:

  - This half (the fork) asserts the live query runner registry against
    db_logo_manifest.txt, a committed list, one type per line: every
    registered, non-deprecated type must appear in the manifest, and the
    manifest must contain no type that is not registered, so it cannot rot
    in either direction.
  - The other half,
    app/src/components/data-sources/db-logo-manifest.test.ts, asserts
    every manifest entry has a matching PNG in app/public/db-logos/.

Each file names the other, so a reader who finds only one of them knows the
check is not weaker than it looks.

This caught the nine connectors renamed off a customer prefix: their assets
were still named for the old type (riits_airnow.png, ...), so the new type
string (airnow, ...) had nothing to load. It is written against the live
query runner registry, not a fixed list of nine names, so it also catches
the next rename.
"""

from pathlib import Path
from unittest import TestCase

from redash import settings
from redash.query_runner import query_runners

MANIFEST_PATH = Path(__file__).resolve().parent / "db_logo_manifest.txt"

# settings.default_query_runners is the module list the app ships with.
# (settings.QUERY_RUNNERS is a funcy-lazy generator built from it that
# import_query_runners() drains once at app startup; reading it here would
# see an already-exhausted iterator, not the runner list.) query_runners
# itself is a module-global dict that also picks up anything any other test
# file happens to import directly (e.g. script.py's "insecure_script", never
# shipped by default) - checking against that would make this test's outcome
# depend on pytest's collection order rather than on what the product ships.
PRODUCTION_RUNNER_MODULES = set(settings.default_query_runners)


def registered_types():
    return {
        runner_type
        for runner_type, cls in query_runners.items()
        if cls.__module__ in PRODUCTION_RUNNER_MODULES and not getattr(cls, "deprecated", False)
    }


def manifest_types():
    if not MANIFEST_PATH.exists():
        raise AssertionError(f"db logo manifest not found at {MANIFEST_PATH}")
    lines = MANIFEST_PATH.read_text().splitlines()
    return {line.strip() for line in lines if line.strip() and not line.strip().startswith("#")}


class TestDbLogoAssets(TestCase):
    def test_manifest_matches_the_live_registry(self):
        registered = registered_types()
        manifest = manifest_types()

        missing_from_manifest = sorted(registered - manifest)
        stale_in_manifest = sorted(manifest - registered)

        self.assertEqual(
            missing_from_manifest,
            [],
            f"registered but missing from {MANIFEST_PATH.name}: {', '.join(missing_from_manifest)}",
        )
        self.assertEqual(
            stale_in_manifest,
            [],
            f"in {MANIFEST_PATH.name} but no longer registered: {', '.join(stale_in_manifest)}",
        )

    def test_registry_is_not_trivially_empty(self):
        # A broken import_query_runners call would make the assertion above
        # vacuously true; guard against that.
        #
        # The floor is a vacuity guard, not a pin on the count. It read 50
        # while this fork still shipped upstream's whole connector surface;
        # the curation recorded in docs/connector-curation.md takes the
        # registered, non-deprecated set to 43, so a floor above that would
        # fail on the intended state rather than on a broken import.
        self.assertGreater(len(registered_types()), 30)
