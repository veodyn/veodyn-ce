from dataclasses import dataclass, field, replace

CORE_REVISION = "2026.09.02"

JOIN_STRATEGIES = ("short_name", "route_id_prefix")
BRAND_SOURCES = ("gtfs_route_long_name", "brand_bands", "carrier_display_name")
PATTERN_PLACEHOLDERS = frozenset({"brand", "route_number", "carrier_display_name"})
RAIL_PATTERN_PLACEHOLDERS = frozenset({"public_name", "legacy_color"})
MODES = ("bus", "light_rail", "heavy_rail", "commuter_rail", "busway", "")
OVERRIDE_KINDS = ("route", "stop")


class ProfileError(ValueError):
    def __init__(self, message, carrier="", file="", row=None, field=""):
        self.carrier = carrier
        self.file = file
        self.row = row
        self.field = field
        parts = (f"carrier {carrier}" if carrier else "", file, f"row {row}" if row else "", field)
        where = ", ".join(part for part in parts if part)
        super().__init__(f"{message} ({where})" if where else message)


@dataclass(frozen=True)
class GtfsSource:
    name: str
    url: str
    join: tuple


@dataclass(frozen=True)
class Alias:
    source: str
    gtfs_route_id: str
    note: str = ""


@dataclass(frozen=True)
class BrandBand:
    start: int
    end: int
    brand: str
    mode: str


@dataclass(frozen=True)
class RouteNameEntry:
    public_name: str
    short_name: str = ""
    mode: str = ""
    color: str = ""


@dataclass(frozen=True)
class RouteNameRules:
    pattern: str
    brand_from: tuple
    brand_bands: tuple = ()
    route_names: dict = field(default_factory=dict)
    rail_pattern: str = "{public_name} ({legacy_color})"
    legacy_colors: dict = field(default_factory=dict)
    busways: frozenset = frozenset()
    strip_from_brand: tuple = ()


@dataclass(frozen=True)
class StopNameRules:
    separator: str
    suffixes: dict
    keep_whole: frozenset
    station_suffix: str = " Station"
    strip_direction_parenthetical: bool = True
    strip_trailing_line_reference: bool = True


@dataclass(frozen=True)
class HeadsignRules:
    title_case: bool = True
    expand: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Override:
    kind: str
    key: str
    public_name: str
    note: str = ""


@dataclass(frozen=True)
class Profile:
    carrier_code: str
    carrier_display_name: str
    route_name: RouteNameRules
    stop_name: StopNameRules
    headsign: HeadsignRules
    gtfs_sources: tuple = ()
    gtfs_cache_max_age_hours: int = 24
    gtfs_max_download_bytes: int = 52428800
    aliases: dict = field(default_factory=dict)
    direction_map: dict = field(default_factory=dict)
    direction_map_by_route: dict = field(default_factory=dict)
    pattern_codes: dict = field(default_factory=dict)
    departures_stop_lookup_max: int = 50
    time_format: str = "h:mma"
    overrides: dict = field(default_factory=dict)
    source_file: str = ""
    is_default: bool = False

    def override_for(self, kind, key):
        return self.overrides.get((kind, str(key)))

    def direction_letter(self, route_code, direction_id):
        by_route = self.direction_map_by_route.get(route_code, {})
        return by_route.get(str(direction_id)) or self.direction_map.get(str(direction_id)) or str(direction_id)


@dataclass(frozen=True)
class ProfileSet:
    profiles: dict
    default: Profile
    digest: str
    files: tuple

    @property
    def revision(self):
        return f"{CORE_REVISION}+{self.digest[:12]}"

    def for_carrier(self, carrier_code, carrier_name=""):
        profile = self.profiles.get(carrier_code)
        if profile is not None:
            return profile
        return replace(self.default, carrier_code=carrier_code, carrier_display_name=carrier_name or carrier_code)
