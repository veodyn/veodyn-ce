from dataclasses import dataclass, field

MODE_BY_ROUTE_TYPE = {"0": "light_rail", "1": "heavy_rail", "2": "commuter_rail", "3": "bus"}


@dataclass(frozen=True)
class GtfsSnapshot:
    source_name: str
    digest: str
    routes: dict
    trips: tuple = ()
    stop_times_by_trip: dict = field(default_factory=dict)
    stops: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ResolvedRoute:
    gtfs_route_id: str
    route_short_name: str
    route_long_name: str
    route_type: str
    route_color: str
    route_text_color: str
    source_name: str
    provenance: str
    digest: str


@dataclass(frozen=True)
class RouteName:
    route_number: str
    brand: str
    public_name: str
    short_name: str
    long_name: str
    mode: str
    color: str
    text_color: str
    gtfs_route_id: str
    public_name_source: str
    brand_source: str
    color_source: str


@dataclass(frozen=True)
class StopName:
    public_name: str
    on_street: str
    cross_street: str
    direction: str
    stop_kind: str
    mode: str
    retired: bool
    public_name_source: str


@dataclass(frozen=True)
class PatternStop:
    carrier_code: str
    route_code: str
    direction: str
    pattern_id: str
    is_canonical: bool
    sequence: int
    stop_id: str
    gtfs_stop_id: str
    public_name: str
    stop_match: str
    sequence_source: str
    public_name_source: str = ""
