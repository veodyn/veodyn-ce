from typing import Any

import pytest
from google.transit import gtfs_realtime_pb2

from veodyn_api.services.gtfs_rt_serializer import (
    SUPPORTED_ENTITY_KINDS,
    SerializationError,
    alert_enum_values,
    serialize_service_alerts,
)

STAMP = 1_756_000_000


def an_alert(**overrides: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "entity_id": "detour-42",
        "severity": "WARNING",
        "cause": "CONSTRUCTION",
        "effect": "DETOUR",
        "informed_entities": [{"kind": "route", "id": "r1"}],
        "header": [{"language": "en", "text": "Route 1 is on detour"}],
        "description": [{"language": "en", "text": "Buses run via Oak Street."}],
    }
    row.update(overrides)
    return row


def _parse(payload: bytes) -> gtfs_realtime_pb2.FeedMessage:
    message = gtfs_realtime_pb2.FeedMessage()
    message.ParseFromString(payload)
    return message


def _refusal(rows: list[dict[str, Any]]) -> str:
    with pytest.raises(SerializationError) as raised:
        serialize_service_alerts(rows, feed_timestamp=STAMP)
    return raised.value.reason


def test_the_feed_is_one_full_dataset_stamped_by_the_caller() -> None:
    message = _parse(serialize_service_alerts([an_alert()], feed_timestamp=STAMP))

    assert message.header.gtfs_realtime_version == "2.0"
    assert message.header.incrementality == gtfs_realtime_pb2.FeedHeader.FULL_DATASET
    assert message.header.timestamp == STAMP


def test_a_row_becomes_an_alert_entity_keyed_by_the_id_it_carries() -> None:
    message = _parse(serialize_service_alerts([an_alert()], feed_timestamp=STAMP))

    assert [entity.id for entity in message.entity] == ["detour-42"]
    alert = message.entity[0].alert
    assert alert.severity_level == gtfs_realtime_pb2.Alert.WARNING
    assert alert.cause == gtfs_realtime_pb2.Alert.CONSTRUCTION
    assert alert.effect == gtfs_realtime_pb2.Alert.DETOUR
    assert [(t.language, t.text) for t in alert.header_text.translation] == [("en", "Route 1 is on detour")]


def test_the_enum_names_are_the_protobuf_ones_so_nothing_is_translated() -> None:
    assert alert_enum_values("severity") == frozenset({"UNKNOWN_SEVERITY", "INFO", "WARNING", "SEVERE"})
    assert "CONSTRUCTION" in alert_enum_values("cause")
    assert "ACCESSIBILITY_ISSUE" in alert_enum_values("effect")


def test_each_entity_kind_reaches_its_own_selector_field() -> None:
    rows = [
        an_alert(
            informed_entities=[
                {"kind": "agency", "id": "a1"},
                {"kind": "route", "id": "r1"},
                {"kind": "stop", "id": "s1"},
                {"kind": "trip", "id": "t1"},
            ]
        )
    ]

    selectors = _parse(serialize_service_alerts(rows, feed_timestamp=STAMP)).entity[0].alert.informed_entity

    assert selectors[0].agency_id == "a1"
    assert selectors[1].route_id == "r1"
    assert selectors[2].stop_id == "s1"
    assert selectors[3].trip.trip_id == "t1"
    assert SUPPORTED_ENTITY_KINDS == frozenset({"agency", "route", "stop", "trip"})


def test_an_active_period_carries_only_the_bounds_it_was_given() -> None:
    rows = [an_alert(active_periods=[{"start": STAMP, "end": None}, {"start": None, "end": STAMP + 60}])]

    periods = _parse(serialize_service_alerts(rows, feed_timestamp=STAMP)).entity[0].alert.active_period

    assert (periods[0].HasField("start"), periods[0].HasField("end")) == (True, False)
    assert periods[0].start == STAMP
    assert (periods[1].HasField("start"), periods[1].HasField("end")) == (False, True)
    assert periods[1].end == STAMP + 60


def test_an_unstated_url_and_window_stay_absent() -> None:
    alert = _parse(serialize_service_alerts([an_alert()], feed_timestamp=STAMP)).entity[0].alert

    assert alert.HasField("url") is False
    assert list(alert.active_period) == []


def test_the_description_the_spec_requires_is_written_on_every_alert() -> None:
    alert = _parse(serialize_service_alerts([an_alert()], feed_timestamp=STAMP)).entity[0].alert

    assert alert.HasField("description_text") is True
    assert [t.text for t in alert.description_text.translation] == ["Buses run via Oak Street."]


@pytest.mark.parametrize("absent", [None, []])
def test_an_alert_with_no_description_is_refused_rather_than_published_without_one(absent: Any) -> None:
    assert "description is empty" in _refusal([an_alert(description=absent)])


def test_a_url_is_written_when_it_is_there() -> None:
    rows = [an_alert(url=[{"language": "en", "text": "https://example.org/detour"}])]

    alert = _parse(serialize_service_alerts(rows, feed_timestamp=STAMP)).entity[0].alert

    assert [t.text for t in alert.url.translation] == ["https://example.org/detour"]


def test_every_language_of_a_string_is_carried() -> None:
    rows = [an_alert(header=[{"language": "en", "text": "Detour"}, {"language": "es", "text": "Desvio"}])]

    alert = _parse(serialize_service_alerts(rows, feed_timestamp=STAMP)).entity[0].alert

    assert [(t.language, t.text) for t in alert.header_text.translation] == [("en", "Detour"), ("es", "Desvio")]


def test_the_same_rows_serialize_to_the_same_bytes() -> None:
    first = serialize_service_alerts([an_alert()], feed_timestamp=STAMP)
    second = serialize_service_alerts([an_alert()], feed_timestamp=STAMP)

    assert first == second


def test_no_alerts_is_an_empty_feed_rather_than_a_refusal() -> None:
    message = _parse(serialize_service_alerts([], feed_timestamp=STAMP))

    assert list(message.entity) == []
    assert message.header.timestamp == STAMP


def test_a_blank_entity_id_is_refused() -> None:
    assert "entity_id is empty" in _refusal([an_alert(entity_id="  ")])


def test_two_rows_cannot_share_an_entity_id() -> None:
    assert "duplicate entity_id 'detour-42'" in _refusal([an_alert(), an_alert()])


def test_a_key_the_serializer_does_not_write_is_refused_rather_than_ignored() -> None:
    assert "quietly incomplete" in _refusal([an_alert(headline="Detour")])


@pytest.mark.parametrize("field", ["severity", "cause", "effect"])
def test_a_value_outside_the_gtfs_realtime_enum_is_refused(field: str) -> None:
    assert "is not a GTFS-Realtime" in _refusal([an_alert(**{field: "VERY_BAD"})])


@pytest.mark.parametrize("field", ["severity", "cause", "effect"])
def test_an_absent_enum_is_refused_rather_than_published_as_its_zero_value(field: str) -> None:
    assert f"{field} is empty" in _refusal([an_alert(**{field: None})])


def test_an_alert_that_names_nothing_it_affects_is_refused() -> None:
    assert "informed_entities is empty" in _refusal([an_alert(informed_entities=[])])


def test_an_entity_kind_this_serializer_cannot_select_on_is_refused() -> None:
    assert "is not one this serializer selects on" in _refusal(
        [an_alert(informed_entities=[{"kind": "shape", "id": "sh1"}])]
    )


def test_an_informed_entity_with_no_id_is_refused() -> None:
    assert "carries no id" in _refusal([an_alert(informed_entities=[{"kind": "route", "id": ""}])])


def test_an_empty_header_is_refused() -> None:
    assert "header is empty" in _refusal([an_alert(header=[])])


def test_a_translation_with_no_language_is_refused() -> None:
    assert "names no language" in _refusal([an_alert(header=[{"text": "Detour"}])])


def test_a_translation_with_no_text_is_refused() -> None:
    assert "carries no text" in _refusal([an_alert(header=[{"language": "en", "text": "   "}])])


def test_an_active_period_bounded_at_neither_end_is_refused() -> None:
    assert "covers all of time" in _refusal([an_alert(active_periods=[{"start": None, "end": None}])])


def test_an_active_period_that_ends_before_it_starts_is_refused() -> None:
    assert "before it starts" in _refusal([an_alert(active_periods=[{"start": STAMP, "end": STAMP - 1}])])


def test_an_active_period_bound_that_is_not_whole_seconds_is_refused() -> None:
    assert "whole number of seconds" in _refusal([an_alert(active_periods=[{"start": STAMP + 0.5}])])


def test_an_active_period_bound_that_is_not_a_time_at_all_is_refused() -> None:
    assert "is not a number" in _refusal([an_alert(active_periods=[{"start": "soon"}])])


def test_an_unknown_key_inside_an_active_period_is_refused() -> None:
    assert "unknown key(s): until" in _refusal([an_alert(active_periods=[{"start": STAMP, "until": STAMP}])])
