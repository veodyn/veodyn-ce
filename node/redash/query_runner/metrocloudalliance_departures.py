"""
One row per departure out of MetroCloudAlliance's predictions payload.

`v2/realtime/predictions` answers one record per stop, each carrying a
`routes` list in which every route holds two timetables: `schedule.times_ts`
(the planned departures) and `predictions.times_ts` (what the realtime
provider currently expects). The `predictions` resource hands that through
as one row per stop with `routes` as a JSON string, which is right for a map
and useless for a departure board.

This turns it into the shape a board wants: a row per (stop, route, time),
with an absolute `departure_at`, a `is_realtime` flag, and for a prediction
that matches a planned slot, the `scheduled_at` it is standing in for. A
prediction is matched to the nearest unclaimed planned slot within
MATCH_WINDOW_SECONDS; a planned slot that has a prediction is not emitted a
second time, so a board does not show "3 min" and "12:15 pm" for one bus.
"""

from datetime import datetime, timezone

# A realtime departure more than this far from a planned slot is its own
# trip, not that slot running late or early. Three minutes matches what the
# realtime provider itself treats as "on time" for a bus stop.
MATCH_WINDOW_SECONDS = 180

DEPARTURE_COLUMNS = [
    "departure_at: string (ISO 8601 UTC)",
    "is_realtime: boolean - true for a realtime prediction, false for a planned slot",
    "scheduled_at: string (ISO 8601 UTC) or null - the planned slot a prediction stands in for",
    "route: string - short public name, e.g. 487",
    "headsign: string - destination sign, falling back to the route name",
    "direction: string - N/S/E/W as the carrier reports it",
    "pattern_code: string - carrier route+direction code, e.g. MT487 W",
    "line_name: string",
    "stop_id: string",
    "stop_name: string",
    "carrier: string - carrier_code",
    "carrier_id: integer",
    "lat: float",
    "lng: float",
    "dist: integer or null - metres from search_point",
    "rt_provider: string or null - who supplied the prediction",
]


def _iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _timestamps(block, now):
    """
    Epoch seconds out of a `schedule` or `predictions` block.

    `times_ts` is the list MCA fills in; `times_minutes` is a comma list the
    older clients read and is sometimes the literal false, so it is only a
    fallback when the timestamps are absent.
    """
    if not isinstance(block, dict):
        return []
    times = block.get("times_ts")
    if isinstance(times, list):
        return sorted(int(t) for t in times if isinstance(t, (int, float)))
    minutes = block.get("times_minutes")
    if isinstance(minutes, str) and now is not None:
        out = []
        for part in minutes.split(","):
            part = part.strip()
            if part.isdigit():
                out.append(int(now) + int(part) * 60)
        return sorted(out)
    return []


def _match(predicted, planned):
    """
    Pair each prediction with the nearest unclaimed planned slot inside the
    window. Returns (pairs, unmatched planned), where pairs is a list of
    (prediction_ts, planned_ts or None).
    """
    free = list(planned)
    pairs = []
    for p in predicted:
        best = None
        for s in free:
            if abs(s - p) <= MATCH_WINDOW_SECONDS and (best is None or abs(s - p) < abs(best - p)):
                best = s
        if best is not None:
            free.remove(best)
        pairs.append((p, best))
    return pairs, free


def flatten_departures(records, now=None):
    """
    The predictions records, as one row per departure, sorted by time.

    `now` (epoch seconds) is only consulted when a block carries
    `times_minutes` and no `times_ts`.
    """
    rows = []
    for stop in records:
        if not isinstance(stop, dict):
            continue
        routes = stop.get("routes")
        if not isinstance(routes, list):
            continue
        base = {
            "stop_id": stop.get("stop_id"),
            "stop_name": stop.get("stop_name"),
            "carrier": stop.get("carrier_code"),
            "carrier_id": stop.get("carrier_id"),
            "lat": stop.get("lat"),
            "lng": stop.get("lng"),
            "dist": stop.get("dist"),
        }
        for route in routes:
            if not isinstance(route, dict):
                continue
            predictions = route.get("predictions")
            provider = predictions.get("rt_provider") if isinstance(predictions, dict) else None
            pairs, planned_only = _match(
                _timestamps(predictions, now),
                _timestamps(route.get("schedule"), now),
            )
            describe = {
                "route": route.get("route") or route.get("route_id"),
                "headsign": route.get("sign") or route.get("route_name"),
                "direction": route.get("direction"),
                "pattern_code": route.get("pattern_code"),
                "line_name": route.get("line_name"),
            }
            for ts, planned in pairs:
                rows.append(
                    {
                        "departure_at": _iso(ts),
                        "is_realtime": True,
                        "scheduled_at": _iso(planned) if planned is not None else None,
                        **describe,
                        **base,
                        "rt_provider": provider,
                    }
                )
            for ts in planned_only:
                rows.append(
                    {
                        "departure_at": _iso(ts),
                        "is_realtime": False,
                        "scheduled_at": _iso(ts),
                        **describe,
                        **base,
                        "rt_provider": None,
                    }
                )
    rows.sort(key=lambda r: (r["departure_at"], str(r["route"]), str(r["direction"])))
    return rows
