"""Every renamed connector still answers to its old type string.

A data source row stores the runner's type. Until the migration has run
everywhere and the release after it has shipped, both strings must resolve
for the connectors that were pure renames. riits_gtfsrt and riits_geojson are
NOT pure renames (see legacy_types.NEEDS_MANUAL_MIGRATION) and must stay out
of this resolution path entirely.
"""

from redash.query_runner import get_query_runner, legacy_types, query_runners, register
from redash.query_runner.legacy_types import NEEDS_MANUAL_MIGRATION, TYPE_RENAMES


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


def test_lossy_renames_need_manual_migration():
    assert "riits_gtfsrt" in NEEDS_MANUAL_MIGRATION
    assert "riits_geojson" in NEEDS_MANUAL_MIGRATION
    # Each explanation is operator-facing text, not a placeholder.
    assert len(NEEDS_MANUAL_MIGRATION["riits_gtfsrt"]) > 20
    assert len(NEEDS_MANUAL_MIGRATION["riits_geojson"]) > 20


def test_lossy_renames_are_not_aliased():
    # No runner module named riits_gtfsrt.py or riits_geojson.py exists any
    # more (the rename replaced them), and legacy_types only builds aliases
    # for entries in TYPE_RENAMES, so neither old string should resolve to
    # anything at all.
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
