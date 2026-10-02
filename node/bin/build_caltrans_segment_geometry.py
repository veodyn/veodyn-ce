"""Offline geometry builder for the `caltrans_atms` connector.

Joins a `caltrans_atms` stations snapshot to Caltrans' own State Highway
Network (SHN) Lines by `route` + `direction` + `postmile`, producing a
`static_geojson`-format layer of inter-station road segments. Run once per
district, or manually re-run when the geometry builder needs a fresh
station snapshot (see the design spec's Decision 6 and "Domain, cadence,
catalog" section: `docs/superpowers/specs/2026-09-23-freeway-speed-segments-design.md`).
Not a query runner and never invoked by the app, matching the
`bin/report_data_source_types.py` precedent for a repo-maintained,
manually-run utility.

Usage:
    python bin/build_caltrans_segment_geometry.py \\
        --stations stations.json --shn-lines shn_lines.geojson \\
        --out-dir /path/to/geo_data/caltrans_d7_segments

Inputs:

- ``--stations``: a JSON array of station rows, the exact shape the
  `caltrans_atms` connector's `stations` resource returns (`vds_id`,
  `route`, `direction`, `postmile`, plus whatever else it carries, only
  those four are read here). Run `{"resource": "stations"}` once and save
  the rows.
- ``--shn-lines``: a **GeoJSON** FeatureCollection of Caltrans State
  Highway Network Lines (see the design spec's Evidence section for the
  download page). This script has no shapefile-reading dependency and
  never fetches geometry over the network itself, per Decision 6, convert
  a downloaded shapefile once, e.g.
  ``ogr2ogr -f GeoJSON shn_lines.geojson SHN_Lines.shp``. Each feature's
  properties must carry a route id and a postmile range; property names
  are matched case-sensitively against the small alias table in
  `PROPERTY_ALIASES` below, covering common Caltrans field-name spellings,
  so a raw `ogr2ogr` export usually needs no manual renaming first. A
  `direction` property is used when present; when the input carries none,
  segments are matched by route and postmile only, a documented v1
  limitation: see the implementation notes filed beside the design spec.

Algorithm (spec "Offline geometry builder" section):

1. Group stations by `(route, direction)`, sort by `postmile`.
2. For each adjacent pair, select SHN Lines features on the same route
   (and direction, when the input has one) whose postmile range overlaps
   the pair's AND whose geometry actually comes within
   `MAX_SEGMENT_DISTANCE_KM` of the pair's own midpoint. The distance check
   is not optional polish: a route's postmile numbering can reset or
   duplicate along its length (a county line, a realignment carrying its
   own PMPrefix: see `PROPERTY_ALIASES` above), so route + direction +
   postmile alone can match a station pair to a same-numbered stretch tens
   of km away on the same route. Live District 7 data hit exactly this on
   US-101. Sort survivors by their own begin postmile, and concatenate
   their coordinates into one LineString, orienting each segment to
   connect to the running line's current end rather than assuming the
   source data's own coordinate order already runs start-to-end along the
   route. A pair with no matching SHN segment is skipped and reported, not
   filled in with a straight line between the two stations: that is
   exactly the fabrication Decision 2 rejects.
3. Emit one Feature per built pair: properties `{id, vds_id_from,
   vds_id_to, route, direction, postmile_start, postmile_end}`.
4. Write `manifest.json` + the FeatureCollection file in the
   `static_geojson` layout (`redash/query_runner/geo_data/README.md`).

Postmile-interpolated exact-cut geometry (trimming a segment's ends to the
station's own postmile rather than using the whole pre-cut SHN segment) is
explicitly out of scope for v1, pre-cut segment concatenation is the bar.
"""

import argparse
import json
import os
import sys
from collections import defaultdict

# Run as `python bin/build_caltrans_segment_geometry.py`, so the script's own
# directory (bin/, not a package) is normally on sys.path automatically,
# except when a test loads this file by path with importlib, which does not
# add it. Adding it explicitly makes the sibling import work either way, the
# same reason report_data_source_types.py adds the project root for its own
# import.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from caltrans_segment_matching import (  # noqa: E402
    direction_coverage,
    has_continuity_break,
    index_shn_lines,
)
from caltrans_segment_matching import (  # noqa: E402
    select_shn_segments as _select_shn_segments,
)


def load_stations(path):
    with open(path) as fh:
        return json.load(fh)


def group_stations(stations):
    groups = defaultdict(list)
    for s in stations:
        groups[(s["route"], s["direction"])].append(s)
    for key in groups:
        groups[key].sort(key=lambda s: s["postmile"])
    return groups


def _dist2(a, b):
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def concatenate_segments(selected):
    """Join selected SHN segments' coordinates into one LineString.

    Each segment is oriented (reversed if needed) so its start connects to
    the running line's current end, the source data's own per-feature
    coordinate order is not assumed to already run start-to-end along the
    route.
    """
    coords = []
    for seg in selected:
        points = [list(p) for p in seg["coords"]]
        if not points:
            continue
        if coords and _dist2(coords[-1], points[-1]) < _dist2(coords[-1], points[0]):
            points = list(reversed(points))
        for point in points:
            if coords and _dist2(coords[-1], point) < 1e-14:
                continue
            coords.append(point)
    return coords


def build_features(stations, shn_by_route):
    features = []
    skipped = []
    for (route, direction), group in sorted(group_stations(stations).items()):
        for a, b in zip(group, group[1:]):
            lo, hi = sorted((a["postmile"], b["postmile"]))
            midpoint = ((a["lon"] + b["lon"]) / 2, (a["lat"] + b["lat"]) / 2)
            selected = _select_shn_segments(shn_by_route, route, direction, lo, hi, midpoint)
            coords = concatenate_segments(selected) if selected else []
            # Each candidate passed the midpoint check on its own, which does
            # not guarantee the concatenated chain is actually continuous:
            # see has_continuity_break's docstring for the real case this
            # catches (two overlapping postmile logs on the same route).
            if len(coords) < 2 or has_continuity_break(coords):
                skipped.append((a["vds_id"], b["vds_id"], route, direction))
                continue
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "id": f"{a['vds_id']}__{b['vds_id']}",
                        "vds_id_from": a["vds_id"],
                        "vds_id_to": b["vds_id"],
                        "route": route,
                        "direction": direction,
                        "postmile_start": lo,
                        "postmile_end": hi,
                    },
                    "geometry": {"type": "LineString", "coordinates": coords},
                }
            )
    return features, skipped


def write_output(out_dir, layer_id, title, features):
    os.makedirs(out_dir, exist_ok=True)
    filename = f"{layer_id}.geojson"
    manifest = {
        layer_id: {
            "file": filename,
            "title": title,
            "geometry": "LineString",
            "group": "freeway",
            "properties": ["id", "route", "direction"],
        }
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    with open(os.path.join(out_dir, filename), "w") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stations", required=True, help="Path to a JSON array of caltrans_atms stations rows.")
    parser.add_argument("--shn-lines", required=True, help="Path to a State Highway Network Lines GeoJSON file.")
    parser.add_argument("--out-dir", required=True, help="Directory to write manifest.json + the layer file into.")
    parser.add_argument("--layer-id", default="caltrans_d7_vds_segments")
    parser.add_argument("--title", default="Caltrans D7 VDS segments")
    args = parser.parse_args(argv)

    stations = load_stations(args.stations)
    shn_by_route = index_shn_lines(args.shn_lines)

    with_direction, total = direction_coverage(shn_by_route)
    if total and with_direction < total:
        print(
            f"Warning: {total - with_direction}/{total} SHN Lines segment(s) carry no recognized `direction` "
            "property (see PROPERTY_ALIASES) and were matched by route and postmile only.",
            file=sys.stderr,
        )

    features, skipped = build_features(stations, shn_by_route)
    write_output(args.out_dir, args.layer_id, args.title, features)

    print(f"Wrote {len(features)} segment feature(s) to {os.path.join(args.out_dir, args.layer_id)}.geojson")
    if skipped:
        print(f"Skipped {len(skipped)} adjacent VDS pair(s) with no matching SHN Lines segment:", file=sys.stderr)
        for vds_from, vds_to, route, direction in skipped:
            print(f"  {vds_from} -> {vds_to} (route {route} {direction})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
