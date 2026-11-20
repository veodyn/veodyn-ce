from collections import defaultdict

from redash.transit_naming.locations import location_rows, stop_511_id

PLACE_COLUMNS = (
    "value",
    "name",
    "place",
    "public_name",
    "names",
    "providers",
    "member_stops",
    "provider_stop_ids",
    "lat",
    "lng",
    "stop_kind",
    "normalization_revision",
)


def stop_key(stop):
    return f"{stop['carrier_code']}:{stop['stop_id']}"


def _unique(values):
    return list(dict.fromkeys(value for value in values if value))


def _place_row(place, public_name, members, anchor, provider_of, revision):
    members = sorted(members, key=stop_key)
    keys = _unique(stop_key(stop) for stop in members)
    providers = ", ".join(_unique(provider_of(str(stop["carrier_code"])) for stop in members))
    return {
        "value": ",".join(keys),
        "name": f"{public_name} ({providers})" if providers else public_name,
        "place": place,
        "public_name": public_name,
        "names": "; ".join(_unique(stop.get("public_name") for stop in members)),
        "providers": providers,
        "member_stops": ",".join(keys),
        "provider_stop_ids": ", ".join(_unique(str(stop["stop_id"]) for stop in members)),
        "lat": anchor.get("lat"),
        "lng": anchor.get("lng"),
        "stop_kind": anchor.get("stop_kind"),
        "normalization_revision": revision,
    }


def place_rows(stops, profiles, provider_of):
    grouped = defaultdict(list)
    single = []
    for stop in stops:
        id511 = stop_511_id(stop)
        if id511:
            grouped[id511].append(stop)
        else:
            single.append(stop)
    located = {row["511_id"]: row for row in location_rows(stops, profiles, {})}
    rows = [
        _place_row(id511, located[id511]["public_name"], members, located[id511], provider_of, profiles.revision)
        for id511, members in sorted(grouped.items())
    ]
    rows.extend(
        _place_row(stop_key(stop), stop.get("public_name") or "", [stop], stop, provider_of, profiles.revision)
        for stop in sorted(single, key=stop_key)
    )
    return rows
