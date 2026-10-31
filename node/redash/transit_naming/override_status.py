OVERRIDE_STATUS_COLUMNS = [
    "kind",
    "carrier_code",
    "target_id",
    "public_name",
    "note",
    "status",
    "matched_stop_id",
    "hint",
]

APPLIED = "applied"
NO_MATCH = "no_match"


def _text(value):
    return str(value if value is not None else "").strip()


class _CarrierRecords:
    def __init__(self, fetch):
        self.fetch = fetch
        self.loaded = {}

    def get(self, path, carrier):
        key = (path, carrier)
        if key not in self.loaded:
            self.loaded[key] = self.fetch(path, {"carrier_code": carrier}) or []
        return self.loaded[key]


def _stop_status(carrier, target, records):
    stops = records.get("stops", carrier)
    if any(_text(stop.get("stop_id")) == target for stop in stops):
        return APPLIED, target, ""
    owners = [_text(stop.get("stop_id")) for stop in stops if _text(stop.get("511_id")) == target]
    if owners:
        listed = ", ".join(owners)
        return NO_MATCH, "", f"{target} is the 511 id of {carrier} stop {listed}; enter {owners[0]} as the stop id"
    return NO_MATCH, "", f"{carrier} has no stop with id {target}"


def _route_status(carrier, target, records):
    if any(_text(route.get("route_code")) == target for route in records.get("routes", carrier)):
        return APPLIED, "", ""
    return NO_MATCH, "", f"{carrier} has no route with code {target}"


def override_status(extra_overrides, fetch):
    records = _CarrierRecords(fetch)
    rows = []
    for carrier in sorted(extra_overrides):
        for (kind, target), override in sorted(extra_overrides[carrier].items()):
            check = _stop_status if kind == "stop" else _route_status
            status, matched_stop_id, hint = check(carrier, target, records)
            rows.append(
                {
                    "kind": kind,
                    "carrier_code": carrier,
                    "target_id": target,
                    "public_name": override.public_name,
                    "note": override.note,
                    "status": status,
                    "matched_stop_id": matched_stop_id,
                    "hint": hint,
                }
            )
    return rows
