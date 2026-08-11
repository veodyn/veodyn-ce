"""The Tier 1 feed-health KPI definitions, and the queries that feed them.

Data only. `seed-dev-kpis.py` is what writes any of it anywhere.

Every query here returns exactly ONE row with ONE numeric column, because
`kpi_eval.extract_value` reads the named column out of the LAST row of the
result. A query whose last row is not the current reading produces a KPI that is
confidently wrong, which is worse than one that errors.

Thresholds are seeded from percentiles measured over 2026-07-22 to 2026-07-25
(~3.2 days), the whole history the ClickHouse archive held when this was
written. Each carries the observed numbers it came from. Re-derive them once
there are two full weeks, and before trusting any of them across a weekend.
"""

from typing import Any

# The ClickHouse archive. Resolved by name at runtime so this does not silently
# write queries against the wrong backend if the id differs per environment.
DATA_SOURCE_NAME = "DE Historical"

# Prefix on the Redash query names so the seeded queries are greppable and a
# human can tell them apart from the hand-built ones.
#
# DO NOT "fix" the em dash below. This repo bans em dashes in prose, and this
# is not prose: it is a lookup key. Both halves of seed-dev-kpis.py match a
# saved query by `QUERY_PREFIX + spec["name"]` against the names already in the
# target Redash, so changing a single character here stops matching every query
# an earlier run created and the next --apply creates a duplicate set instead of
# updating them. Changing it needs a rename pass over the existing titles in
# every instance that has been seeded, not an edit here on its own.
QUERY_PREFIX = "Veodyn KPI — "

# DO NOT edit the three STRING VALUES below, and DO NOT edit any `name` in
# SPECS. They are the same class as QUERY_PREFIX above: the values are the
# literal ClickHouse table names a seeded instance's queries read, and each
# `name` is half of the key those queries are matched by. Neither is a label a
# sweep gets to tidy. Editing one here does not rename anything anywhere else,
# so a seeded query goes on reading the old table (or stops being found at all
# and gets duplicated) while this file claims otherwise. Renaming them is a
# migration over every seeded instance plus the warehouse, run deliberately,
# not a find-and-replace in this file.
#
# The VARIABLE NAMES on the left are not in that class and never were. They are
# local to this module, resolved at parse time, and referenced nowhere outside
# it. A cross-model audit caught this file's identity occurrences being fenced
# as one indivisible group when half of them were only ever a Python
# identifier. The fence is on the right-hand side of these three lines and on
# the `name` fields. It is not on anything else in this file.
RAIL = "historical.q_riits_demo_transit_rail_vehicle_positions_21"
BIKE = "historical.q_riits_demo_bikeshare_stations_32"
PATROLS = "historical.q_riits_demo_transit_fsp_patrols_23"

# `direction` fixes which side of the thresholds is bad, and veodyn-api refuses
# the pair unless at_risk sits on the better side of breached.
SPECS: list[dict[str, Any]] = [
    {
        "name": "Rail feed capture rate",
        "description": (
            "Distinct rail position snapshots archived in the last hour. Counts arrivals rather than "
            "measuring staleness against now(), because the worker lets Redash serve a cached result up "
            "to one cadence old: a stale cache makes a count read the previous hour (still a valid "
            "signal) but makes a minutes-since-last-capture read artificially healthy."
        ),
        "sql": f"""
SELECT uniqExact(captured_at) AS snapshots_last_hour
FROM {RAIL}
WHERE captured_at >= now() - INTERVAL 1 HOUR
""".strip(),
        "value_column": "snapshots_last_hour",
        "unit": "snapshots/hr",
        "domain": "rail",
        "direction": "higher-is-better",
        # Observed over 78 whole hours: p05 26, p50 27, min 20, max 29.
        "target": 26,
        "at_risk": 20,
        "breached": 12,
    },
    {
        "name": "Bikeshare station coverage",
        "description": (
            "Distinct stations present in the newest bikeshare snapshot. A drop means the GBFS feed "
            "returned a short roster, which silently biases every other bikeshare metric downward."
        ),
        "sql": f"""
SELECT uniqExact(station_id) AS stations
FROM {BIKE}
WHERE captured_at = (SELECT max(captured_at) FROM {BIKE})
""".strip(),
        "value_column": "stations",
        "unit": "stations",
        "domain": "transit",
        "direction": "higher-is-better",
        # Observed 222 in every one of 868 snapshots, with no variance at all.
        "target": 222,
        "at_risk": 215,
        "breached": 200,
    },
    {
        "name": "FSP device connectivity",
        "description": (
            "Share of Freeway Service Patrol devices reporting as communicating in the newest snapshot. "
            "Independent of the diurnal patrol schedule: devices stay connected when crews are off shift, "
            "so this measures the telemetry link rather than how many patrols are out."
        ),
        "sql": f"""
SELECT round(100.0 * countIf(lower(toString(isdevicecommunicating)) IN ('true', '1')) / count(), 2)
       AS pct_communicating
FROM {PATROLS}
WHERE captured_at = (SELECT max(captured_at) FROM {PATROLS})
""".strip(),
        "value_column": "pct_communicating",
        "unit": "%",
        "domain": "freeway",
        "direction": "higher-is-better",
        # Observed p50 100, min 99 across 893 snapshots; the device count is a flat 100.
        "target": 100,
        "at_risk": 98,
        "breached": 95,
    },
    {
        "name": "Rail lines in service",
        "description": (
            "Distinct rail lines with at least one vehicle reporting in the newest snapshot. Dips "
            "overnight when service genuinely ends, so treat an off-peak at-risk reading as expected "
            "rather than as a fault."
        ),
        "sql": f"""
SELECT uniqExact(line) AS lines_in_service
FROM {RAIL}
WHERE captured_at = (SELECT max(captured_at) FROM {RAIL})
  AND line IS NOT NULL AND line != ''
""".strip(),
        "value_column": "lines_in_service",
        "unit": "lines",
        "domain": "rail",
        "direction": "higher-is-better",
        # Observed p50 6, max 6; p05 is 2, which is the overnight lull, not a fault.
        "target": 6,
        "at_risk": 5,
        "breached": 4,
    },
    {
        "name": "Average rail speed",
        "description": (
            "Fleet-wide average speed of rail vehicles that are moving, over the last hour. "
            "Stopped samples are excluded on purpose: 52.7% of all archived samples read exactly 0 "
            "(station dwell, layover, end of service), so an average over raw samples measures duty "
            "cycle more than it measures speed, and it drags every line toward zero regardless of how "
            "fast the trains actually run. Excluding them also flattens the diurnal swing, which is "
            "why this can carry a tighter at-risk band than the other rail KPIs. "
            "A total feed outage makes avg() undefined rather than 0, so this errors instead of "
            "reporting a confident zero; 'Rail feed capture rate' is the KPI that measures that case."
        ),
        "sql": f"""
SELECT round(avg(speed), 2) AS avg_speed
FROM {RAIL}
WHERE speed > 0
  AND captured_at >= now() - INTERVAL 1 HOUR
""".strip(),
        "value_column": "avg_speed",
        "unit": "mph",
        "domain": "rail",
        "direction": "higher-is-better",
        # Observed over 298 whole hours (>=20 moving samples each): p50 13.3, p25 12.98,
        # p05 10.67, min 8.03, max 16.46. Deliberately NOT the 25 mph the hand-built
        # "Average Rail Speed by Line" KPI carried: no hour in the archive has ever
        # reached it, on any definition, so that target could only ever read breached.
        "target": 13,
        "at_risk": 11,
        "breached": 9,
    },
]


def kpi_payload(spec: dict[str, Any], query_id: int) -> dict[str, Any]:
    """The veodyn-api create body. camelCase, matching app/src/types/kpi.ts."""
    return {
        "name": spec["name"],
        "description": spec["description"],
        "unit": spec["unit"],
        "domain": spec["domain"],
        "source": {"kind": "query", "queryId": query_id, "valueColumn": spec["value_column"]},
        "target": {"value": spec["target"], "direction": spec["direction"]},
        "thresholds": {"atRisk": spec["at_risk"], "breached": spec["breached"]},
        "cadence": "hourly",
    }
