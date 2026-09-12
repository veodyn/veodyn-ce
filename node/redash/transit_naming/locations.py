from collections import Counter, defaultdict

from redash.transit_naming import provenance

CONSENSUS = "consensus"
TIEBREAK = "tiebreak"
KIND_RANK = {"station": 0, "intersection": 1, "named_place": 2, "unparsed": 3}
LOCATION_COLUMNS = (
    "511_id",
    "public_name",
    "public_name_source",
    "chosen_carrier",
    "chosen_stop_id",
    "agreeing_stops",
    "source_stops",
    "carriers",
    "source_stop_ids",
    "names",
    "stop_kind",
    "retired_stops",
    "lat",
    "lng",
    "normalization_revision",
)


def _id511(stop):
    return str(stop.get("511_id") or "").strip()


def _curated(profiles, carrier):
    return not profiles.for_carrier(carrier).is_default


def _candidate_key(stop, count, profiles):
    return (
        -count,
        KIND_RANK.get(stop.get("stop_kind"), len(KIND_RANK)),
        0 if _curated(profiles, stop["carrier_code"]) else 1,
        stop["carrier_code"],
        str(stop["stop_id"]),
    )


def _override(members, profiles, id511):
    for stop in members:
        override = profiles.for_carrier(stop["carrier_code"]).override_for("location", id511)
        if override is not None and override.public_name:
            return override
    return None


def _choose(members, profiles):
    counts = Counter(stop["public_name"] for stop in members if stop.get("public_name"))
    named = [stop for stop in members if stop.get("public_name")] or members
    chosen = min(named, key=lambda stop: _candidate_key(stop, counts.get(stop.get("public_name"), 0), profiles))
    agreeing = counts.get(chosen.get("public_name"), 0)
    top = max(counts.values()) if counts else 0
    contested = sum(1 for count in counts.values() if count == top) > 1
    return chosen, agreeing, TIEBREAK if contested else CONSENSUS


def _mean(values):
    return round(sum(values) / len(values), 6) if values else None


def _location_row(id511, members, profiles):
    chosen, agreeing, source = _choose(members, profiles)
    public_name = chosen.get("public_name") or ""
    override = _override(members, profiles, id511)
    if override is not None:
        public_name, source = override.public_name, provenance.OVERRIDE
    ordered = sorted(members, key=lambda stop: (stop["carrier_code"], str(stop["stop_id"])))
    active = [stop for stop in members if not stop.get("retired")] or members
    names = []
    for stop in ordered:
        if stop.get("public_name") and stop["public_name"] not in names:
            names.append(stop["public_name"])
    return {
        "511_id": id511,
        "public_name": public_name,
        "public_name_source": source,
        "chosen_carrier": chosen["carrier_code"],
        "chosen_stop_id": str(chosen["stop_id"]),
        "agreeing_stops": agreeing,
        "source_stops": len(members),
        "carriers": len({stop["carrier_code"] for stop in members}),
        "source_stop_ids": ", ".join(f"{stop['carrier_code']} {stop['stop_id']}" for stop in ordered),
        "names": "; ".join(names),
        "stop_kind": chosen.get("stop_kind") or "",
        "retired_stops": sum(1 for stop in members if stop.get("retired")),
        "lat": _mean([stop["lat"] for stop in active if stop.get("lat") is not None]),
        "lng": _mean([stop["lng"] for stop in active if stop.get("lng") is not None]),
        "normalization_revision": members[0].get("normalization_revision") or profiles.revision,
    }


def location_rows(stops, profiles, params):
    wanted = str(params.get("stop_511_id") or "").strip()
    grouped = defaultdict(list)
    for stop in stops:
        id511 = _id511(stop)
        if id511 and (not wanted or id511 == wanted):
            grouped[id511].append(stop)
    return [_location_row(id511, grouped[id511], profiles) for id511 in sorted(grouped)]
