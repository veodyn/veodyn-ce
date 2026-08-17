"""Every renamed connector still answers to its old type string.

A data source row stores the runner's type. Until the migration has run
everywhere and the release after it has shipped, both strings must resolve
for the connectors that were pure renames. riits_gtfsrt and riits_geojson are
NOT pure renames and must stay out of this resolution path entirely: their
runners moved into veodyn-pack-riits instead, so they are in
legacy_types.PACK_PROVIDED_TYPES and are provided by the pack rather than
aliased to anything here.
"""

from redash.query_runner import get_query_runner, legacy_types, query_runners, register
from redash.query_runner.legacy_types import (
    NEEDS_MANUAL_MIGRATION,
    PACK_PROVIDED_TYPES,
    TYPE_RENAMES,
)


def test_every_old_type_still_resolves():
    for old, new in TYPE_RENAMES.items():
        assert get_query_runner(old, {}) is not None, old


def test_every_alias_maps_to_the_renamed_runner():
    for old, new in TYPE_RENAMES.items():
        alias = get_query_runner(old, {})
        assert isinstance(alias, type(get_query_runner(new, {})))


def test_every_alias_is_deprecated():
    for old in TYPE_RENAMES:
        alias_class = query_runners[old]
        assert alias_class.deprecated is True, f"{old} alias must be deprecated so it is not offered for new data sources"


def test_lossy_renames_are_absent_from_type_renames():
    assert "riits_gtfsrt" not in TYPE_RENAMES
    assert "riits_geojson" not in TYPE_RENAMES


def test_lossy_renames_are_provided_by_the_pack():
    # These two were in NEEDS_MANUAL_MIGRATION until the preflight ran against
    # a real database and blocked on them. Migrating would have cost one data
    # source split in two, twelve queries repointed and rewritten, and two
    # scheduled queries failing unattended if missed; keeping the runners and
    # moving them into the pack costs none of that.
    for old in ("riits_gtfsrt", "riits_geojson"):
        assert old not in NEEDS_MANUAL_MIGRATION, f"{old} no longer needs a manual migration"
        assert old in PACK_PROVIDED_TYPES, f"{old} must be declared pack-provided or the preflight blocks it"
        # Operator-facing text, not a placeholder, and it must name the pack
        # and the import path: without them the message says a deploy is
        # broken without saying what to install.
        reason = PACK_PROVIDED_TYPES[old]
        assert "veodyn-pack-riits" in reason
        assert f"veodyn_pack_riits.query_runner.{old}" in reason


def test_needs_manual_migration_is_empty_and_the_mechanism_survives():
    # Empty is the current state, not the permanent one. Asserting it keeps a
    # future addition visible in review rather than letting one appear
    # silently, and legacy_types must keep exporting the name either way.
    assert NEEDS_MANUAL_MIGRATION == {}


def test_lossy_renames_are_not_aliased():
    # Neither runner is in THIS image: they live in veodyn-pack-riits, which a
    # deployment installs on top. legacy_types only builds aliases for entries
    # in TYPE_RENAMES, so neither old string resolves here. On a node with the
    # pack installed they resolve because the pack registers them directly,
    # which is a different path from aliasing and is not what this file tests.
    assert query_runners.get("riits_gtfsrt") is None
    assert query_runners.get("riits_geojson") is None
    assert get_query_runner("riits_gtfsrt", {}) is None
    assert get_query_runner("riits_geojson", {}) is None


def test_alias_is_not_created_when_target_is_missing_from_the_registry():
    """register_legacy_aliases() must look targets up in the registry, not
    import their module, so a runner disabled via REDASH_DISABLED_QUERY_RUNNERS
    stays disabled instead of legacy_types re-registering it anyway.
    """
    # Waze is registered by the normal test setup. Remove it (and its
    # existing alias) from the registry to simulate it having been disabled
    # and never imported, then rebuild aliases and confirm no alias for it
    # is recreated.
    saved_waze = query_runners.pop("waze", None)
    query_runners.pop("riits_waze", None)
    try:
        legacy_types.register_legacy_aliases()
        assert "riits_waze" not in query_runners, (
            "register_legacy_aliases() must not alias a type whose target is absent from the registry"
        )
    finally:
        # Restore real state for the rest of the suite.
        if saved_waze is not None:
            register(saved_waze)
        legacy_types.register_legacy_aliases()


def test_pack_provided_types_are_reported_not_silently_dropped():
    # riits_api left the image with the customer pack. A deployment that does
    # not install the pack still has its data source rows, and the runner is
    # simply absent, so the preflight has to name it rather than let a deploy
    # look clean.
    from redash.query_runner.legacy_types import PACK_PROVIDED_TYPES

    assert "riits_api" in PACK_PROVIDED_TYPES
    assert "veodyn-pack-riits" in PACK_PROVIDED_TYPES["riits_api"]


def test_alias_is_created_when_target_registers_after_legacy_types_is_imported():
    """Regression test for the ordering bug: aliasing used to happen as a
    side effect of legacy_types' own import, so a target listed AFTER
    legacy_types in REDASH_ENABLED_QUERY_RUNNERS had not registered yet and
    silently got no alias, orphaning any existing data source rows of the
    old type.

    legacy_types is already imported at module scope above (well before this
    test runs), which stands in for it sitting early in an operator's import
    order. Remove its target from the registry to simulate that target not
    having registered yet, confirm the registry genuinely lacks it, then
    register the target late (as it would when its own runner module imports
    after legacy_types) and confirm register_legacy_aliases() still creates
    the alias. It must not matter that legacy_types was "imported" first.
    """
    saved_waze = query_runners.pop("waze", None)
    query_runners.pop("riits_waze", None)
    try:
        assert "waze" not in query_runners, "test setup: target must be absent to simulate late registration"

        # The target registers only now, as if its runner module were being
        # imported after legacy_types.
        assert saved_waze is not None, "waze must have been registered by the normal test setup"
        register(saved_waze)

        legacy_types.register_legacy_aliases()

        assert "riits_waze" in query_runners, (
            "a target that registers after legacy_types is imported must still get its alias"
        )
        assert isinstance(get_query_runner("riits_waze", {}), type(get_query_runner("waze", {})))
    finally:
        legacy_types.register_legacy_aliases()
