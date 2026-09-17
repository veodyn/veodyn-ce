from __future__ import annotations

from pathlib import Path

import pytest

from tests.fixtures import (
    entity_archive_bytes,
    entity_archive_with_generated_stops_bytes,
    entity_archive_without_a_table_bytes,
)
from validator_service.entities import (
    DEFAULT_LIMIT,
    KINDS,
    MAX_ENTITIES_PER_KIND,
    MAX_LIMIT,
    Entity,
    clamp_limit,
    search,
)
from validator_service.entity_archive import EntityIndexError, build_entity_index, has_supported_scheme


def _archive(tmp_path: Path, payload: bytes) -> Path:
    path = tmp_path / "gtfs.zip"
    path.write_bytes(payload)
    return path


def _ids(entities: list[Entity]) -> list[str]:
    return [entity.id for entity in entities]


def test_every_kind_is_indexed_from_one_archive_read(tmp_path: Path) -> None:
    index = build_entity_index(_archive(tmp_path, entity_archive_bytes()))

    assert set(index.by_kind) == set(KINDS)
    assert _ids(list(index.of_kind("agency"))) == ["a1", "a2"]
    assert _ids(list(index.of_kind("route"))) == ["9", "10", "11", "12"]
    assert _ids(list(index.of_kind("trip"))) == ["t1", "t2"]


def test_route_label_joins_short_and_long_name_and_falls_back_to_the_route_id(tmp_path: Path) -> None:
    index = build_entity_index(_archive(tmp_path, entity_archive_bytes()))

    labels = {entity.id: entity.label for entity in index.of_kind("route")}
    assert labels == {"9": "9 Elm Street", "10": "Riverside Loop", "11": "11", "12": "12"}


def test_stop_trip_and_agency_labels_fall_back_to_the_id_when_the_name_is_blank(tmp_path: Path) -> None:
    index = build_entity_index(_archive(tmp_path, entity_archive_bytes()))

    stops = {entity.id: entity.label for entity in index.of_kind("stop")}
    trips = {entity.id: entity.label for entity in index.of_kind("trip")}
    agencies = {entity.id: entity.label for entity in index.of_kind("agency")}
    assert stops["s5"] == "s5"
    assert stops["s1"] == "Elm Street & Main"
    assert trips == {"t1": "Elmwood", "t2": "t2"}
    assert agencies == {"a1": "Elmwood Transit", "a2": "a2"}


def test_feed_version_is_read_from_feed_info(tmp_path: Path) -> None:
    index = build_entity_index(_archive(tmp_path, entity_archive_bytes()))

    assert index.feed_version == "2026-08-01"


def test_archive_without_feed_info_yields_an_empty_feed_version(tmp_path: Path) -> None:
    payload = entity_archive_without_a_table_bytes("feed_info.txt")

    index = build_entity_index(_archive(tmp_path, payload))

    assert index.feed_version == ""
    assert _ids(list(index.of_kind("route"))) == ["9", "10", "11", "12"]


def test_missing_table_yields_no_entities_of_that_kind_rather_than_an_error(tmp_path: Path) -> None:
    payload = entity_archive_without_a_table_bytes("trips.txt")

    index = build_entity_index(_archive(tmp_path, payload))

    assert index.of_kind("trip") == ()
    assert _ids(list(index.of_kind("stop"))) == ["s2", "s1", "elm-3", "s4", "s5"]


def test_unreadable_archive_raises_entity_index_error(tmp_path: Path) -> None:
    with pytest.raises(EntityIndexError):
        build_entity_index(_archive(tmp_path, b"this is not a zip file"))


def test_entities_per_kind_stop_at_the_bound(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("validator_service.entity_archive.MAX_ENTITIES_PER_KIND", 3)
    payload = entity_archive_with_generated_stops_bytes(50)

    index = build_entity_index(_archive(tmp_path, payload))

    assert len(index.of_kind("stop")) == 3
    assert _ids(list(index.of_kind("route"))) == ["9", "10", "11"]
    assert _ids(list(index.of_kind("agency"))) == ["a1", "a2"]


def test_the_bound_is_declared_and_finite() -> None:
    assert 0 < MAX_ENTITIES_PER_KIND < 1_000_000


def test_search_matches_id_and_label_case_insensitively() -> None:
    entities = (
        Entity(kind="stop", id="s1", label="Elm Street & Main"),
        Entity(kind="stop", id="ELM-3", label="Riverside Plaza"),
        Entity(kind="stop", id="s4", label="Riverside Depot"),
    )

    assert _ids(search(entities, q="elm", limit=10)) == ["s1", "ELM-3"]
    assert _ids(search(entities, q="RIVERSIDE", limit=10)) == ["ELM-3", "s4"]


def test_search_puts_starts_with_before_merely_contains() -> None:
    entities = (
        Entity(kind="stop", id="s2", label="North Elm Depot"),
        Entity(kind="stop", id="s1", label="Elm Street & Main"),
        Entity(kind="stop", id="elm-3", label="Riverside Plaza"),
        Entity(kind="stop", id="s4", label="Riverside Depot"),
    )

    assert _ids(search(entities, q="elm", limit=10)) == ["s1", "elm-3", "s2"]


def test_search_without_a_term_returns_the_archive_order_head() -> None:
    entities = tuple(Entity(kind="stop", id=f"s{n}", label=f"Stop {n}") for n in range(10))

    assert _ids(search(entities, q="", limit=3)) == ["s0", "s1", "s2"]


def test_search_never_returns_more_than_the_limit() -> None:
    entities = tuple(Entity(kind="stop", id=f"elm{n}", label=f"Elm {n}") for n in range(10))

    assert len(search(entities, q="elm", limit=4)) == 4


def test_clamp_limit_defaults_and_clamps_at_both_ends() -> None:
    assert clamp_limit(None) == DEFAULT_LIMIT
    assert clamp_limit("") == DEFAULT_LIMIT
    assert clamp_limit("0") == 1
    assert clamp_limit("-5") == 1
    assert clamp_limit("1000") == MAX_LIMIT
    assert clamp_limit(str(MAX_LIMIT + 1)) == MAX_LIMIT
    assert clamp_limit("7") == 7


def test_clamp_limit_falls_back_to_the_default_instead_of_rejecting_a_non_integer() -> None:
    assert clamp_limit("abc") == DEFAULT_LIMIT
    assert clamp_limit("3.5") == DEFAULT_LIMIT


def test_only_http_and_https_are_supported_schemes() -> None:
    assert has_supported_scheme("https://example.org/gtfs.zip")
    assert has_supported_scheme("http://example.org/gtfs.zip")
    assert not has_supported_scheme("file:///etc/passwd")
    assert not has_supported_scheme("ftp://example.org/gtfs.zip")
    assert not has_supported_scheme("/etc/passwd")
