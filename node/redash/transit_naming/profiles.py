import hashlib
from dataclasses import dataclass, field, replace

CORE_REVISION = "2026.10.23.3"

JOIN_STRATEGIES = ("short_name", "route_id_prefix")
BRAND_SOURCES = ("gtfs_route_long_name", "brand_bands", "carrier_display_name")
PATTERN_PLACEHOLDERS = frozenset({"brand", "route_number", "carrier_display_name"})
RAIL_PATTERN_PLACEHOLDERS = frozenset({"public_name", "legacy_color"})
MODES = ("bus", "light_rail", "heavy_rail", "commuter_rail", "busway", "")
OVERRIDE_KINDS = ("route", "stop", "location")
TRAILING_COMPASS_MODES = ("keep", "street", "direction")


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
class SuffixCompletion:
    same_intersection_m: int = 150
    unique_street_m: int = 2000


@dataclass(frozen=True)
class StreetReference:
    within_m: int = 100


@dataclass(frozen=True)
class StopNameRules:
    separator: str
    suffixes: dict
    keep_whole: frozenset
    station_suffix: str = " Station"
    strip_direction_parenthetical: bool = True
    strip_trailing_line_reference: bool = True
    complete_suffixes: SuffixCompletion = None
    split_on: tuple = ("&", "/", "\\")
    keep_upper: frozenset = frozenset()
    street_reference: StreetReference = None
    trailing_compass: str = "keep"
    split_words: tuple = ()
    ampersand_joins_streets: bool = False
    spell_out: dict = field(default_factory=dict)


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
    extra_trip_routes: dict = field(default_factory=dict)
    direction_map: dict = field(default_factory=dict)
    direction_map_by_route: dict = field(default_factory=dict)
    pattern_codes: dict = field(default_factory=dict)
    departures_stop_lookup_max: int = 50
    time_format: str = "h:mma"
    trim_layover_named_ends: bool = True
    overrides: dict = field(default_factory=dict)
    streets: object = None
    source_file: str = ""
    is_default: bool = False
    inherits_default: bool = False

    @property
    def curated(self):
        return not self.is_default and not self.inherits_default

    def override_for(self, kind, key):
        return self.overrides.get((kind, str(key)))

    def direction_letter(self, route_code, direction_id):
        by_route = self.direction_map_by_route.get(route_code, {})
        return by_route.get(str(direction_id)) or self.direction_map.get(str(direction_id)) or str(direction_id)


def overrides_digest(listed):
    return hashlib.sha256(repr(sorted(listed)).encode("utf-8")).hexdigest()[:12]


def stop_overrides_digest(overrides):
    listed = [(key, override.public_name) for (kind, key), override in overrides.items() if kind == "stop"]
    return overrides_digest(listed) if listed else ""


@dataclass(frozen=True)
class ProfileSet:
    profiles: dict
    default: Profile
    digest: str
    files: tuple
    extra_overrides: dict = field(default_factory=dict)

    @property
    def base_revision(self):
        return f"{CORE_REVISION}+{self.digest[:12]}"

    @property
    def revision(self):
        if not self.extra_overrides:
            return self.base_revision
        listed = [
            (carrier, kind, key, override.public_name)
            for carrier, overrides in self.extra_overrides.items()
            for (kind, key), override in overrides.items()
        ]
        return f"{self.base_revision}+{overrides_digest(listed)}"

    def with_overrides(self, extra_overrides):
        return replace(self, extra_overrides=extra_overrides or {})

    def merged_overrides(self, profile):
        extra = self.extra_overrides.get(profile.carrier_code)
        return replace(profile, overrides={**profile.overrides, **extra}) if extra else profile

    def for_carrier(self, carrier_code, carrier_name=""):
        profile = self.profiles.get(carrier_code)
        if profile is not None and not profile.inherits_default:
            return self.merged_overrides(profile)
        declared = profile.carrier_display_name if profile is not None else ""
        return self.merged_overrides(
            replace(
                profile or self.default,
                carrier_code=carrier_code,
                carrier_display_name=declared or carrier_name or carrier_code,
            )
        )
