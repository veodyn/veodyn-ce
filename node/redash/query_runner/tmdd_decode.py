"""
TMDD v3.03d response documents to record dicts.

Decode only. Nothing here opens a socket; the transport hands this module the
response body it read. `tmdd_rows` holds the column and enumeration tables,
and `tmdd_xml` holds the namespace rule and the scalar readers, which is
where the parsing hazards are written up.

**Where a repeat is collapsed into a flat column, the full cardinality is
kept beside it.** `event-element-detail` repeats 0..64 and `event-location`
20 times within each, so `severity`, `status`, `direction` and the
coordinates can only ever hold one of many. Each is taken from the first
carrier, and `descriptions`, `locations` and `update_times` carry every
repeat as JSON so nothing is lost.

**Every record carries every column.** A TMDD response commonly leads with
its sparsest device, so a column set inferred from record one would drop
`route-designator` and `link-direction` for the whole table.
"""

import json

from redash.query_runner.tmdd_request import DEVICE_TYPE_DMS
from redash.query_runner.tmdd_rows import RESOURCE_COLUMNS
from redash.query_runner.tmdd_xml import (
    TMDDResponseError,
    branches,
    coordinates,
    enumerated,
    first_text,
    root_message,
    text,
    timestamp,
    verbatim_text,
)

__all__ = ["TMDDResponseError", "decode"]

# resource -> (root message element, the repeating record inside it).
RESOURCE_MESSAGES = {
    "events": ("fEUMsg", "FEU"),
    "dms_inventory": ("dMSInventoryMsg", "dms-inventory-item"),
    "dms_status": ("dMSStatusMsg", "dms-status-item"),
}


def _decode_dms_inventory(item):
    header = item.find("device-inventory-header")
    if header is None:
        raise TMDDResponseError("TMDD: a dms-inventory-item carries no device-inventory-header.")
    record = {
        "device_id": text(header, "device-id"),
        "device_name": text(header, "device-name"),
        # Echoed from the request discriminator, because the response never
        # restates it: DeviceInventoryHeader has no device-type element, and
        # dms-sign-type is sign hardware technology (vmsFull, bos, the
        # portable variants), a different enumeration that must not be
        # conflated with Device-type. Every record in a DMS inventory
        # response is a DMS by construction of the call.
        "device_type": DEVICE_TYPE_DMS,
        # The DEVICE paths, not the event ones. A DMS record has no
        # location-on-link structure, so the event precedence would return
        # None for every device. Designator first: a roadway column means the
        # route number, not a free-text link label.
        "roadway": first_text(header, "route-designator", "link-name"),
        "direction": enumerated(
            "Link-direction", text(header, "link-direction"), "device-inventory-header/link-direction"
        ),
    }
    record.update(coordinates(header.find("device-location"), "device-inventory-header/device-location"))
    return record


def _decode_dms_status(item):
    header = item.find("device-status-header")
    if header is None:
        raise TMDDResponseError("TMDD: a dms-status-item carries no device-status-header.")
    beacon = text(item, "message-beacon")
    if beacon is not None and beacon not in ("0", "1"):
        raise TMDDResponseError(
            f"TMDD: message-beacon carries {beacon!r}. DmsMessageBeacon is an unsignedByte "
            "restricted to 0 or 1, not an xs:boolean."
        )
    return {
        "device_id": text(header, "device-id"),
        "oper_status": enumerated(
            "Device-operational-status", text(header, "device-status"), "device-status-header/device-status"
        ),
        # verbatim_text, not text. The documentation promises this column is
        # returned exactly as the center sent it, and the shared reader trims
        # and folds an empty element into None. MULTI markup carries
        # significant whitespace, and a blank sign is a value, not an
        # absence.
        "current_message": verbatim_text(item, "current-message"),
        # The schema guarantees only "0 or 1", so this mapping is ours.
        "beacon_on": None if beacon is None else beacon == "1",
        # last-comm-time, the DEVICE-scoped timestamp. The org-scoped
        # organization-information/last-update-time describes the center that
        # reported the sign, not the sign.
        "last_update": timestamp(header, "last-comm-time"),
    }


def _event_headline(feu):
    """The branch local name is the taxonomy; its content is the ITIS code."""
    headline = feu.find("event-headline/headline")
    branch = next(iter(headline), None) if headline is not None else None
    if branch is None:
        return None, None
    return branch.tag, (branch.text or "").strip() or None


def _event_indicator(feu, field, type_name):
    # EventIndicator is an xs:choice on FullEventUpdate ITSELF, not inside
    # event-element-detail, so each repeat carries exactly one field and the
    # first repeat carrying this one is the only candidate for a flat column.
    for indicator in feu.findall("event-indicators/event-indicator"):
        value = text(indicator, field)
        if value is not None:
            return enumerated(type_name, value, f"event-indicator/{field}")
    return None


def _event_roadway(details):
    # Designator first, for the same reason as the DMS column. The first
    # element-detail carrying any of the three wins; a later one describing a
    # different link does not overwrite it.
    for detail in details:
        for location in detail.findall("event-locations/event-location"):
            value = first_text(
                location,
                "location-on-link/link-designator",
                "location-on-link/link-name",
                "location-on-link/primary-location/link-name",
            )
            if value is not None:
                return value
    return None


def _event_place(details):
    """Direction and coordinates from the first location that carries them.

    A center may repeat event-element-detail 64 times and event-location 20
    times within each, and these columns hold one value. The FIRST
    element-detail is the one read, and within it the first location that
    carries the field. Full cardinality is already in the `locations` column.
    """
    place = {"direction": None, **coordinates(None, "")}
    if not details:
        return place
    for location in details[0].findall("event-locations/event-location"):
        if place["direction"] is None:
            place["direction"] = enumerated(
                "Link-direction",
                text(location, "location-on-link/link-direction"),
                "event-location/location-on-link/link-direction",
            )
        if place["latitude_raw"] is not None:
            continue
        # EventLocation is a choice, and three of its four branches can carry
        # a GeoLocation at a different depth.
        for path in ("geo-location", "location-on-link/primary-location/geo-location", "landmark/geo-location"):
            geo = location.find(path)
            if geo is not None:
                place.update(coordinates(geo, f"event-location/{path}"))
                break
    return place


def _decode_event(feu):
    details = feu.findall("event-element-details/event-element-detail")
    descriptions, locations, update_times = [], [], []
    for detail in details:
        # Not a decoded column. It is validated because the decoder already
        # walks this element, and a value outside a 3-value enum means the
        # response is malformed, which is better refused than half-read.
        enumerated("Event-category", text(detail, "event-category"), "event-element-detail/event-category")
        descriptions.extend(branches(detail, "event-descriptions/event-description"))
        locations.extend(branches(detail, "event-locations/event-location"))
        update_times.append(timestamp(detail, "event-times/update-time"))
    event_type, event_type_code = _event_headline(feu)
    record = {
        "event_id": text(feu, "event-reference/event-id"),
        "event_type": event_type,
        "event_type_code": event_type_code,
        "severity": _event_indicator(feu, "severity", "Event-severity"),
        "status": _event_indicator(feu, "status", "Event-incident-status"),
        # The only flat free-text field on the record. Every other candidate
        # is an ITIS code or is buried in a repeating array.
        "description": text(feu, "event-comments/event-comment"),
        "descriptions": json.dumps(descriptions),
        "locations": json.dumps(locations),
        # The per-detail times repeat 0..64 and can legitimately diverge, so
        # they are preserved rather than dropped in favour of the flat one.
        "update_times": json.dumps(update_times),
        "roadway": _event_roadway(details),
        "start_time": next((t for t in (timestamp(d, "event-times/start-time") for d in details) if t), None),
        # The record-level value, one per event, not the per-detail array.
        "update_time": timestamp(feu, "event-reference/update-time"),
    }
    record.update(_event_place(details))
    return record


_DECODERS = {
    "events": _decode_event,
    "dms_inventory": _decode_dms_inventory,
    "dms_status": _decode_dms_status,
}


def decode(resource, xml):
    """Every record in `xml`, each carrying exactly `RESOURCE_COLUMNS[resource]`.

    An unknown resource is a programming error and raises ValueError, the
    same as `tmdd_request.build_request` does. Everything a center can get
    wrong raises TMDDResponseError.
    """
    if resource not in RESOURCE_MESSAGES:
        known = ", ".join(sorted(RESOURCE_MESSAGES))
        raise ValueError(f"TMDD: no response is defined for resource {resource!r}. Known resources: {known}.")
    message_name, item_name = RESOURCE_MESSAGES[resource]
    root = root_message(xml, message_name)
    # Started from a template so a record missing an optional field still
    # carries the key. to_fixed_table would fill the gap in the table, but a
    # decoder that only sometimes returns a column makes every caller guess.
    template = dict.fromkeys(RESOURCE_COLUMNS[resource])
    return [{**template, **_DECODERS[resource](item)} for item in root.findall(item_name)]
