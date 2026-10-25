from redash.transit_naming.profiles import (
    TRAILING_COMPASS_MODES,
    ProfileError,
    StopNameRules,
    StreetReference,
    SuffixCompletion,
)

STOP_NAME_KEYS = {
    "separator",
    "suffixes",
    "keep_whole",
    "station_suffix",
    "strip_direction_parenthetical",
    "strip_trailing_line_reference",
    "complete_suffixes",
    "split_on",
    "keep_upper",
    "street_reference",
    "trailing_compass",
    "split_words",
    "ampersand_joins_streets",
    "spell_out",
}
COMPLETE_SUFFIX_KEYS = {"same_intersection_m", "unique_street_m"}
STREET_REFERENCE_KEYS = {"within_m"}


def check_keys(data, allowed, carrier, file, prefix=""):
    for key in data:
        if key not in allowed:
            raise ProfileError(f"unknown key {key!r}", carrier, file, field=f"{prefix}{key}")


def _distance(data, key, carrier, file, section="complete_suffixes", defaults=SuffixCompletion):
    value = data.get(key, getattr(defaults, key))
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ProfileError(
            f"{key} must be a positive integer, got {value!r}",
            carrier,
            file,
            field=f"stop_name.{section}.{key}",
        )
    return value


def _complete_suffixes(data, carrier, file):
    if "complete_suffixes" not in data:
        return None
    section = data["complete_suffixes"]
    if not isinstance(section, dict):
        raise ProfileError("complete_suffixes must be a mapping", carrier, file, field="stop_name.complete_suffixes")
    check_keys(section, COMPLETE_SUFFIX_KEYS, carrier, file, "stop_name.complete_suffixes.")
    return SuffixCompletion(
        same_intersection_m=_distance(section, "same_intersection_m", carrier, file),
        unique_street_m=_distance(section, "unique_street_m", carrier, file),
    )


def _street_reference(data, carrier, file):
    if "street_reference" not in data:
        return None
    section = data["street_reference"]
    if not isinstance(section, dict):
        raise ProfileError("street_reference must be a mapping", carrier, file, field="stop_name.street_reference")
    check_keys(section, STREET_REFERENCE_KEYS, carrier, file, "stop_name.street_reference.")
    return StreetReference(within_m=_distance(section, "within_m", carrier, file, "street_reference", StreetReference))


def _split_on(data, carrier, file):
    value = data.get("split_on", list(StopNameRules.split_on))
    valid = (
        isinstance(value, list)
        and value
        and all(
            isinstance(item, str) and len(item) == 1 and not item.isalnum() and not item.isspace() for item in value
        )
    )
    if not valid:
        raise ProfileError(
            f"split_on must be a list of single punctuation characters, got {value!r}",
            carrier,
            file,
            field="stop_name.split_on",
        )
    return tuple(value)


def _trailing_compass(data, carrier, file):
    value = data.get("trailing_compass", StopNameRules.trailing_compass)
    if value not in TRAILING_COMPASS_MODES:
        raise ProfileError(
            f"trailing_compass must be one of {', '.join(TRAILING_COMPASS_MODES)}, got {value!r}",
            carrier,
            file,
            field="stop_name.trailing_compass",
        )
    return value


def _split_words(data, carrier, file):
    value = data.get("split_words", [])
    if not isinstance(value, list) or not all(isinstance(word, str) and word.isalpha() for word in value):
        raise ProfileError(
            f"split_words must be a list of single words, got {value!r}", carrier, file, field="stop_name.split_words"
        )
    return tuple(word.lower() for word in value)


def _ampersand_joins_streets(data, carrier, file):
    value = data.get("ampersand_joins_streets", False)
    if not isinstance(value, bool):
        raise ProfileError(
            f"ampersand_joins_streets must be true or false, got {value!r}",
            carrier,
            file,
            field="stop_name.ampersand_joins_streets",
        )
    return value


def stop_name_rules(data, carrier, file):
    check_keys(data, STOP_NAME_KEYS, carrier, file, "stop_name.")
    return StopNameRules(
        separator=str(data.get("separator", "/")),
        suffixes={str(k): str(v) for k, v in (data.get("suffixes") or {}).items()},
        keep_whole=frozenset(str(w) for w in data.get("keep_whole") or []),
        station_suffix=str(data.get("station_suffix", " Station")),
        strip_direction_parenthetical=bool(data.get("strip_direction_parenthetical", True)),
        strip_trailing_line_reference=bool(data.get("strip_trailing_line_reference", True)),
        complete_suffixes=_complete_suffixes(data, carrier, file),
        split_on=_split_on(data, carrier, file),
        keep_upper=frozenset(str(w).upper() for w in data.get("keep_upper") or []),
        street_reference=_street_reference(data, carrier, file),
        trailing_compass=_trailing_compass(data, carrier, file),
        split_words=_split_words(data, carrier, file),
        ampersand_joins_streets=_ampersand_joins_streets(data, carrier, file),
        spell_out={str(k).lower(): str(v) for k, v in (data.get("spell_out") or {}).items()},
    )
