"""A minimal, real GTFS archive for `contract-check.py` to validate against.

Small enough that `prepare_feed` returns in well under a second, which is the
whole reason the contract check is runnable by hand: a real agency archive
costs about a minute and 584 MB.

It declares one agency, stop, route and trip, so a realtime message naming any
OTHER trip_id makes E003 fire deterministically. That is what gives the check
something to assert on besides "no error".
"""

from __future__ import annotations

import pathlib
import sys
import zipfile

FILES = {
    "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\na1,Test,https://example.org,UTC\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\ns1,Stop One,0.0,0.0\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type\nr1,a1,1,One,3\n",
    "trips.txt": "route_id,service_id,trip_id\nr1,sv1,t1\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt1,00:00:00,00:00:00,s1,1\n",
    "calendar.txt": (
        "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
        "sv1,1,1,1,1,1,1,1,20200101,20301231\n"
    ),
}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: build-fixture-archive.py <output.zip>", file=sys.stderr)
        return 2
    target = pathlib.Path(argv[1])
    with zipfile.ZipFile(target, "w") as archive:
        for name, body in FILES.items():
            archive.writestr(name, body)
    print(f"built {target} ({target.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
