import os

from redash.transit_naming.profile_loader import CORE_PROFILE_DIR, build_profile_set

MT_YAML = """carrier_code: MT
carrier_display_name: Metro
gtfs_sources:
  - name: bus
    url: https://gitlab.example.org/gtfs_bus.zip
    join: [short_name, route_id_prefix]
  - name: rail
    url: https://gitlab.example.org/gtfs_rail.zip
    join: [route_id_prefix]
gtfs_cache_max_age_hours: 24
gtfs_max_download_bytes: 52428800
aliases:
  MT950: {source: bus, gtfs_route_id: "910-13201", note: "J Line 910/950 shares one GTFS row"}
route_name:
  pattern: "{brand} {route_number}"
  brand_from: [gtfs_route_long_name, brand_bands]
  brand_bands:
    - {from: 1, to: 299, brand: "Metro Local Line", mode: bus}
    - {from: 300, to: 399, brand: "Metro Limited Line", mode: bus}
    - {from: 400, to: 599, brand: "Metro Express Line", mode: bus}
    - {from: 600, to: 699, brand: "Metro Local Line", mode: bus}
    - {from: 700, to: 799, brand: "Metro Rapid Line", mode: bus}
  route_names:
    MT009: {public_name: "Dodger Stadium Express", short_name: "9", mode: bus}
    MT022: {public_name: "South Bay Dodger Stadium Express", short_name: "22", mode: bus}
    MT801: {public_name: "Metro A Line", short_name: A, mode: light_rail, color: "0072BC"}
    MT802: {public_name: "Metro B Line", short_name: B, mode: heavy_rail, color: "EB131B"}
    MT803: {public_name: "Metro C Line", short_name: C, mode: light_rail, color: "58A738"}
    MT804: {public_name: "Metro E Line", short_name: E, mode: light_rail, color: "FDB913"}
    MT805: {public_name: "Metro D Line", short_name: D, mode: heavy_rail, color: "A05DA5"}
    MT807: {public_name: "Metro K Line", short_name: K, mode: light_rail, color: "E56DB1"}
    MT901: {public_name: "Metro G Line (Orange)", short_name: G, mode: busway, color: "FC4C02"}
    MT910: {public_name: "Metro J Line (Silver)", short_name: J, mode: busway, color: "ADB8BF"}
    MT950: {public_name: "Metro J Line (Silver)", short_name: J, mode: busway, color: "ADB8BF"}
  rail_pattern: "{public_name} ({legacy_color})"
  legacy_colors: {A: Blue, B: Red, C: Green, D: Purple, E: Expo}
  busways: [MT901, MT910, MT950]
  strip_from_brand: [" 901", " 910/950"]
direction_map: {"0": E, "1": W}
direction_map_by_route:
  MT094: {"0": N, "1": S}
pattern_codes: {}
departures_stop_lookup_max: 50
stop_name:
  separator: "/"
  suffixes: {Boulevard: Bl, Blvd: Bl, Avenue: Av, Ave: Av, Street: St, Drive: Dr, Road: Rd, Highway: Hwy, Place: Pl, Parkway: Pkwy, Freeway: Fwy, Lane: Ln, Court: Ct, Way: Way}
  keep_whole: [Broadway]
  station_suffix: " Station"
  strip_direction_parenthetical: true
  strip_trailing_line_reference: true
headsign:
  title_case: true
  expand: {"Sta.": Station, Ctr: Center, Dtwn: Downtown, DTLA: Downtown LA, "Trans Ctr": Transit Center}
time_format: "h:mma"
"""

MT_CSV = (
    "kind,key,public_name,note\n"
    "stop,3000001,Pico/Rimpau,backslash in source\n"
    "route,MT010,Metro Local Line 10 (Melrose),override example\n"
)

CARRIER_NAMES = {"MT": "Metro", "BU": "Burbank Bus"}
CARRIER_IDS = {"MT": 34, "BU": 12}


def write_profile_dir(directory, files):
    for name, text in files.items():
        with open(os.path.join(directory, name), "w", encoding="utf-8") as handle:
            handle.write(text)


def metro_profiles(with_overrides=True):
    files = {"MT.yaml": MT_YAML}
    if with_overrides:
        files["MT.csv"] = MT_CSV
    return build_profile_set([CORE_PROFILE_DIR], extra_files={"/pack/naming_profiles": files})


def metro_profile(with_overrides=True):
    return metro_profiles(with_overrides).for_carrier("MT", "Metro")


def mca_route(route_code, line_code, line_id, route_id, route_name=None, line_name="", line_color="", carrier="MT"):
    return {
        "carrier_name": CARRIER_NAMES[carrier],
        "carrier_code": carrier,
        "carrier_id": CARRIER_IDS[carrier],
        "line_id": line_id,
        "line_name": line_name,
        "line_code": line_code,
        "line_color": line_color,
        "route_id": route_id,
        "route_name": route_code if route_name is None else route_name,
        "route_code": route_code,
    }


MT_ROUTES = [
    mca_route("MT094", "094", 2, 1),
    mca_route("MT030", "030", 3, 2, line_name="Metro Local - Eastbound to Little Tokyo"),
    mca_route("MT009", "009", 2599, 3, route_name="DODGER STADIUM EXPRESS"),
    mca_route("MT022", "009", 2599, 4, route_name="DODGER STADIUM EXPRESS"),
    mca_route("MT901", "901", 5, 5),
    mca_route("MT910", "910", 6, 6),
    mca_route("MT950", "910", 6, 7),
    mca_route("MT801", "801", 7, 8, line_color="0072BC"),
    mca_route("MT807", "807", 8, 9),
    mca_route("MT010", "010", 9, 10),
    mca_route("MT720", "720", 10, 11),
    mca_route("MT038", "035", 2526, 151),
    mca_route("MT035", "035", 2526, 798, route_name="DTLA - WASHINGTON/FAIRFAX VIA WASHINGTON BL"),
    mca_route("MT236", "236", 20, 11),
    mca_route("MT235", "236", 20, 1119),
    mca_route("MT242", "242", 2809, 1125),
    mca_route("MT243", "242", 2809, 1126),
    mca_route("MT260", "260", 214, 87),
    mca_route("MT261", "260", 214, 1175),
]
BU_ROUTES = [mca_route("BUORA", "ORA", 5, 900, route_name="", carrier="BU")]


def mca_stop(stop_id, name, lat, lng, on="", cross="", modes="BUS", direction="", predictions=1):
    return {
        "carrier_code": "MT",
        "stop_id": stop_id,
        "stop_name": name,
        "uuid": f"uuid-{stop_id}",
        "511_id": f"100{stop_id}",
        "lat": lat,
        "lng": lng,
        "on_street": on,
        "cross_street": cross,
        "street_direction": direction,
        "relation_to_cross_street": "Farside" if on else "",
        "transit_modes": modes,
        "prediction_count": predictions,
        "city": "Springfield",
        "accessible": True,
    }


MT_STOPS = [
    mca_stop("1166", "1st St/Main St", 34.052019, -118.243174, "1st St", "Main St", direction="East"),
    mca_stop("1", "Paramount Blvd/Slauson Ave", 33.973248, -118.113113, "Paramount Blvd", "Slauson Ave"),
    mca_stop("13574", "Grand/Pico", 34.0400, -118.2600, "Grand Ave", "Pico Blvd"),
    mca_stop("19022", "Broadway/5th", 34.0480, -118.2510, "Broadway", "5th St"),
    mca_stop("3000001", "Pico \\ Rimpau", 34.0470, -118.3440),
    mca_stop("9101", "Harbor Blvd/Western Ave", 34.06010, -118.3000, "Harbor Blvd", "Western Ave"),
    mca_stop("9003", "Harbor Blvd/Vermont Ave", 34.0650, -118.3050, "Harbor Blvd", "Vermont Ave"),
    mca_stop("80101", "Downtown Long Beach Station", 33.768071, -118.192921, "Pine Ave", "1st Street", modes="RAIL"),
    mca_stop("80102", "Pacific Ave Station", 33.7720, -118.1930, "Pacific Avenue", "4th Street", modes="RAIL"),
    mca_stop("80122", "Riverbrook - Park Station - Metro A-Line", 33.9280, -118.2380, modes="RAIL"),
    mca_stop("7001", "Imperial Hwy & Central Ave (Westbound)", 33.9300, -118.2550),
    mca_stop("7002", "Fullerton Park & Ride Dock 14", 33.8700, -117.9200),
    mca_stop(
        "10270", "Collis Ave/Cudahy St", 34.0926, -118.181753, "Collis Ave", "Cudahy St", modes="", predictions=0
    ),
]
MT_STOPS_BY_ID = {stop["stop_id"]: stop for stop in MT_STOPS}

T0 = 1_788_302_000

PREDICTION_STOP = {
    "carrier_code": "MT",
    "carrier_id": 34,
    "stop_name": "1st St/Main St",
    "stop_id": "1166",
    "uuid": "uuid-1166",
    "lat": 34.052019,
    "lng": -118.243174,
    "dist": None,
    "prediction_available": True,
    "routes": [
        {
            "line_name": "Metro Local and Late Night - Eastbound to Downtown LA",
            "line_code": "MT030",
            "pattern_name": "WEST PICO BLVD - EAST FIRST ST",
            "pattern_code": "MT030 E",
            "route_name": "Downtown LA- Little Tokyo-Arts Dist Sta.",
            "route": "30",
            "route_id": "30",
            "direction": "E",
            "sign": "Downtown LA- Little Tokyo-Arts Dist Sta.",
            "iline": 330,
            "schedule": {"times_ts": [T0 + 600, T0 + 1200]},
            "predictions": {"times_ts": [T0 + 660], "rt_provider": "Swiftly"},
        },
        {
            "line_name": "",
            "line_code": "MT999",
            "pattern_code": "MT999 N",
            "route_name": "Somewhere",
            "route": "999",
            "route_id": "999",
            "direction": "N",
            "sign": "SOMEWHERE VIA DTWN",
            "iline": 999,
            "schedule": {"times_ts": [T0 + 900]},
            "predictions": {"times_ts": [], "rt_provider": None},
        },
    ],
}

STOP_LOOKUP_1166 = dict(
    MT_STOPS_BY_ID["1166"],
    lines_served=[{"line_id": "30-13196", "line_name": "Metro Local Line", "line_short_name": "30"}],
)
