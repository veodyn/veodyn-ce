"""The sixth seam: where a dataset the warehouse did not capture comes from.

Same shape as tests/test_registry_providers.py. Register a fake provider, assert
it resolves, and assert that a build with nothing registered degrades to "no
datasets from anywhere" rather than to a built-in default.
"""

from typing import Any

import pytest

from veodyn_api.registry import (
    DatasetSource,
    dataset_sources,
    empty_registries,
    register_dataset_source_provider,
    restored_registries,
)


class FakeWarehouse:
    """Stands in for ClickHouseClient. A provider is handed one and may ignore it."""

    def query(self, statement: str, params: dict[str, str] | None = None) -> list[dict[str, Any]]:
        return []


def restrooms() -> DatasetSource:
    return DatasetSource(
        table="restrooms",
        database="historical",
        name="Restroom locations",
        origin="contributed",
        writable=True,
    )


def test_a_registered_provider_contributes_its_datasets() -> None:
    with empty_registries():
        register_dataset_source_provider(lambda client, database: [restrooms()])
        sources = dataset_sources(FakeWarehouse(), "historical")
    assert [source.table for source in sources] == ["restrooms"]


def test_providers_concatenate_in_registration_order() -> None:
    first = DatasetSource(table="a", database="historical", name="A")
    second = DatasetSource(table="b", database="historical", name="B")
    with empty_registries():
        register_dataset_source_provider(lambda client, database: [first])
        register_dataset_source_provider(lambda client, database: [second])
        sources = dataset_sources(FakeWarehouse(), "historical")
    assert [source.table for source in sources] == ["a", "b"]


def test_no_provider_means_no_datasets() -> None:
    """Register a provider, confirm it resolves, then confirm empty_registries()
    actually clears it while the block is open. The original version of this
    test never registered anything anywhere, so it could not tell "the sixth
    registry got cleared" apart from "the sixth registry was never touched"."""
    with restored_registries():
        register_dataset_source_provider(lambda client, database: [restrooms()])
        assert [source.table for source in dataset_sources(FakeWarehouse(), "historical")] == ["restrooms"]
        with empty_registries():
            assert dataset_sources(FakeWarehouse(), "historical") == []


def test_the_registry_is_restored_after_the_block() -> None:
    """The failure this catches is a sixth registry that leaks between tests,
    which is exactly what registry.py's own header warns about."""
    with restored_registries():
        register_dataset_source_provider(lambda client, database: [restrooms()])
    with restored_registries():
        assert [source.table for source in dataset_sources(FakeWarehouse(), "historical")] == []


def test_defaults_describe_a_captured_dataset() -> None:
    """A provider that says nothing extra is describing a capture, because that
    is what every dataset in this platform was until this seam existed."""
    source = DatasetSource(table="q_trips_9", database="historical", name="Trips")
    assert source.origin == "capture"
    assert source.shadows is None
    assert source.row_count is None
    assert source.description is None
    assert source.writable is False


def test_build_catalog_reads_every_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """A pack-contributed dataset reaches the catalog without the pack touching
    build_catalog, which is the whole point of the seam."""
    from veodyn_api.services import catalog as catalog_service

    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_span", lambda client, source: (None, None))

    with empty_registries():
        register_dataset_source_provider(lambda client, database: [restrooms()])
        datasets = catalog_service.build_catalog(FakeWarehouse(), database="historical", stale_after_minutes=60)
    assert [dataset.id for dataset in datasets] == ["restrooms"]


def test_dataset_ids_unions_every_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tagging a contributed dataset has to pass the same existence check a
    captured one does, or the tag write refuses a dataset that plainly exists."""
    from veodyn_api.services import catalog as catalog_service

    with empty_registries():
        register_dataset_source_provider(lambda client, database: [restrooms()])
        ids = catalog_service.dataset_ids(FakeWarehouse(), "historical")
    assert ids == {"restrooms"}


def test_a_shadowed_source_is_dropped() -> None:
    """After a pack renames a captured table and puts a view in its place, the
    registry still returns a row for the renamed table. Two entries for one
    dataset would leave every id-keyed consumer taking whichever came first."""
    from veodyn_api.services import catalog as catalog_service

    renamed = DatasetSource(table="_road_events_ingested", database="historical", name="Road events")
    view = DatasetSource(
        table="road_events",
        database="historical",
        name="Road events",
        shadows="_road_events_ingested",
        writable=True,
    )
    with empty_registries():
        register_dataset_source_provider(lambda client, database: [renamed])
        register_dataset_source_provider(lambda client, database: [view])
        surviving = catalog_service.apply_shadowing([renamed, view])
    assert [source.table for source in surviving] == ["road_events"]


def test_shadowing_a_name_nobody_registered_is_harmless() -> None:
    """A declaration whose rename has not run yet, or has been reversed, must
    not remove anything."""
    from veodyn_api.services import catalog as catalog_service

    view = DatasetSource(table="restrooms", database="historical", name="Restrooms", shadows="_restrooms_ingested")
    assert catalog_service.apply_shadowing([view]) == [view]


def test_a_provider_description_replaces_the_capture_sentence() -> None:
    """The catalog says "Captured from Redash" about every dataset. For one a
    person typed, that is a false statement about where the data came from."""
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(
        table="restrooms",
        database="historical",
        name="Restroom locations",
        origin="contributed",
        description="Maintained by hand. 12 records.",
    )
    assert catalog_service._describe(source, 12) == "Maintained by hand. 12 records."


def test_a_captured_dataset_keeps_its_sentence() -> None:
    """The control: a source with no description of its own still gets the
    existing capture sentence, unchanged by this task. 12,345 rather than 400,
    so the thousands separator in `{row_count:,}` is actually exercised: 400
    reads identically with or without it, which let a mutated format string
    pass unnoticed."""
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(table="q_trips_9", database="historical", name="Trips", query_id=9)
    expected = "Captured from Redash query 9 on every scheduled run. 12,345 rows so far."
    assert catalog_service._describe(source, 12345) == expected


def test_an_empty_description_still_falls_back_to_the_capture_sentence() -> None:
    """`""` is a description a provider explicitly set, not the absence of one,
    but it must be treated as absent: an `is not None` check would print a
    blank description instead of falling back."""
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(table="q_trips_9", database="historical", name="Trips", query_id=9, description="")
    expected = "Captured from Redash query 9 on every scheduled run. 12,345 rows so far."
    assert catalog_service._describe(source, 12345) == expected


def test_a_contributed_dataset_with_no_description_is_not_given_a_capture_one() -> None:
    """The empty string is where the two rules above meet, and it is the case
    that shipped wrong: a managed dataset declared without a description holds
    `""`, which is falsy, so it fell through to the capture sentence and its
    own page announced "Captured from Redash on every scheduled run" about rows
    a person had typed in by hand. Origin settles this, not the description."""
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(
        table="restrooms", database="historical", name="Restrooms", origin="contributed", description=""
    )
    assert catalog_service._describe(source, 12) == ""


def test_a_provider_row_count_wins_over_system_tables(monkeypatch: pytest.MonkeyPatch) -> None:
    """A view stores no rows, so system.tables reports null and the coercion
    turns it into 0. Every contributed dataset would read as empty."""
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(
        table="restrooms", database="historical", name="Restrooms", origin="contributed", row_count=12
    )
    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {"historical.restrooms": 0})
    monkeypatch.setattr(catalog_service, "_span", lambda client, s: (None, None))

    with empty_registries():
        register_dataset_source_provider(lambda client, database: [source])
        datasets = catalog_service.build_catalog(FakeWarehouse(), database="historical", stale_after_minutes=60)
    assert datasets[0].row_count == 12


def test_a_provider_zero_row_count_is_believed_over_system_tables(monkeypatch: pytest.MonkeyPatch) -> None:
    """The case the fixture above cannot separate: `source.row_count or
    row_counts.get(key, 0)` and the correct `is not None` check agree whenever
    the provider's count is truthy, so a provider legitimately reporting zero
    rows against a warehouse table that has rows is the only input that tells
    them apart. Contributed datasets are exactly where this can happen: the
    provider counts something the warehouse's total_rows does not."""
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(
        table="restrooms", database="historical", name="Restrooms", origin="contributed", row_count=0
    )
    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {"historical.restrooms": 500})
    monkeypatch.setattr(catalog_service, "_span", lambda client, s: (None, None))

    with empty_registries():
        register_dataset_source_provider(lambda client, database: [source])
        datasets = catalog_service.build_catalog(FakeWarehouse(), database="historical", stale_after_minutes=60)
    assert datasets[0].row_count == 0


def test_build_catalog_drops_a_shadowed_source(monkeypatch: pytest.MonkeyPatch) -> None:
    """The two tests above call apply_shadowing directly, which only proves the
    function is correct in isolation, not that build_catalog still calls it.
    This drives a shadower and its target through build_catalog itself, so
    deleting the apply_shadowing() line from build_catalog fails here instead
    of passing every other test in the suite."""
    from veodyn_api.services import catalog as catalog_service

    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_span", lambda client, source: (None, None))

    renamed = DatasetSource(table="_road_events_ingested", database="historical", name="Road events")
    view = DatasetSource(
        table="road_events", database="historical", name="Road events", shadows="_road_events_ingested"
    )
    with empty_registries():
        register_dataset_source_provider(lambda client, database: [renamed, view])
        datasets = catalog_service.build_catalog(FakeWarehouse(), database="historical", stale_after_minutes=60)
    assert [dataset.id for dataset in datasets] == ["road_events"]


def test_both_new_fields_default_to_a_captured_dataset(monkeypatch: pytest.MonkeyPatch) -> None:
    """A community build has no contributed datasets, so every dataset in a
    no-pack response must read as captured and not writable."""
    from veodyn_api.services import catalog as catalog_service

    source = DatasetSource(table="q_trips_9", database="historical", name="Trips", query_id=9)
    monkeypatch.setattr(catalog_service, "_columns_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_rows_by_table", lambda client, databases: {})
    monkeypatch.setattr(catalog_service, "_span", lambda client, s: (None, None))

    with empty_registries():
        register_dataset_source_provider(lambda client, database: [source])
        datasets = catalog_service.build_catalog(FakeWarehouse(), database="historical", stale_after_minutes=60)
    assert datasets[0].origin == "capture"
    assert datasets[0].writable is False
