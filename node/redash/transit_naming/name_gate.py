import argparse
import collections
import csv
import json
import re
import sys

from redash.transit_naming.stop_shapes import (
    ADDRESS,
    INTERSECTION_JOINS,
    LOWERCASE_JOINS,
    PARENTHESES,
    STATION,
    STREET,
    names_a_station,
    shape,
    split_note,
    stop_evidence,
    tokenize,
)

LONG_DESIGNATIONS = frozenset({"street", "avenue", "ave", "boulevard", "blvd", "drive", "road", "str"})
PERIOD_DESIGNATIONS = re.compile(r"\b(?:St|Av|Bl|Dr|Rd)\.(?=\s|$)")
SHORT_SPELL_OUTS = frozenset({"cir", "ter", "terr", "wy"})
COMPASS_LETTER = re.compile(r"^[NSEW]\.?$")
SPELLED_COMPASS = frozenset({"north", "south", "east", "west"})
ACRONYM_PERIODS = re.compile(r"\b(?:[A-Z]\.){2,}")
PARK_AND_RIDE_VARIANT = re.compile(
    r"park\s*(?:and|n|'n|’n|-n-|-and-)\s*ride|park\s*/\s*ride|\bP\s*&\s*R\b", re.IGNORECASE
)
RAW_LINE_CODE = re.compile(r"\bLine [A-Z]{2,}\b")
RULES = {
    "S1": "two streets not joined with a slash (p8)",
    "S2": "street designation spelled out or with a period (p8, p9)",
    "S3": "Circle, Terrace or Way abbreviated (p8, p9)",
    "S6": "compass point against the house-number rule (p9)",
    "S7": "periods in an acronym (p7, p8)",
    "S8": "Park & Ride spelled another way (p15)",
    "S9": "join word capitalized (p6)",
    "R1": "route with a lower-case Line (p14)",
    "D1": "direction label does not start with a capital (p7)",
    "UNKNOWN": "name could not be read",
}
KEPT = {
    "R0": "route the carrier names only by code, kept as sent (the guide has no rule)",
}


def _street_rules(segment, kind):
    words = [word for word in segment.split() if word]
    found = []
    if not words:
        return found
    last = words[-1].rstrip(",").lower()
    if last.rstrip(".") in LONG_DESIGNATIONS or PERIOD_DESIGNATIONS.search(segment):
        found.append("S2")
    if last.rstrip(".") in SHORT_SPELL_OUTS:
        found.append("S3")
    if kind == STREET and len(words) >= 2 and COMPASS_LETTER.match(words[0]) and not _lettered(words):
        found.append("S6")
    if kind == ADDRESS and len(words) >= 3 and words[1].lower() in SPELLED_COMPASS:
        found.append("S6")
    return found


def _ends_in_a_long_designation(segment):
    words = [word.rstrip(".,").lower() for word in segment.split()]
    while len(words) > 2 and words[-1] in SPELLED_COMPASS | {"n", "s", "e", "w"}:
        words = words[:-1]
    return len(words) >= 2 and words[-1] in LONG_DESIGNATIONS


def _lettered(words):
    return len(words) == 2 and words[1].rstrip(".").lower() in {"st", "av", "bl", "dr", "rd"}


def check_stop(name, evidence):
    if not name or not name.strip():
        return ["UNKNOWN"], ""
    core, _ = split_note(name)
    tokens = tokenize(core, evidence)
    found = set()
    kinds = [evidence.kind(token) for token in tokens[::2]]
    if (
        len(tokens) == 3
        and tokens[1].strip().lower() in INTERSECTION_JOINS - {"/", "\\"}
        and kinds == [STREET, STREET]
    ):
        found.add("S1")
    if STATION not in kinds:
        for token, kind in zip(tokens[::2], kinds):
            if kind in (STREET, ADDRESS):
                found.update(_street_rules(token.strip(), kind))
            elif _ends_in_a_long_designation(token):
                found.add("S2")
    for join in tokens[1::2]:
        word = join.strip()
        if word.lower() in LOWERCASE_JOINS and word != word.lower():
            found.add("S9")
    for inner in PARENTHESES.findall(name):
        if names_a_station(inner, evidence):
            continue
        inner_tokens = tokenize(inner, evidence)
        for token in inner_tokens[::2]:
            kind = evidence.kind(token.strip())
            if kind in (STREET, ADDRESS):
                found.update(_street_rules(token.strip(), kind))
        if any(j.strip().lower() in LOWERCASE_JOINS and j.strip() != j.strip().lower() for j in inner_tokens[1::2]):
            found.add("S9")
    if ACRONYM_PERIODS.search(name):
        found.add("S7")
    if PARK_AND_RIDE_VARIANT.search(name):
        found.add("S8")
    return sorted(found), shape(tokens, evidence)


def check_route(name):
    if not name or not name.strip():
        return ["UNKNOWN"]
    found = []
    if re.search(r"\bline\b", name):
        found.append("R1")
    if RAW_LINE_CODE.search(name):
        found.append("R0")
    return found


def check_direction(label):
    if not label or not label.strip():
        return []
    return ["D1"] if label.strip()[0].islower() else []


def _named_stops(stops, profile_dirs):
    from redash.transit_naming.profile_loader import load_profiles
    from redash.transit_naming.suffixes import CarrierIndexes

    profiles = load_profiles(profile_dirs)
    by_carrier = collections.defaultdict(list)
    for stop in stops:
        by_carrier[str(stop.get("carrier_code"))].append(stop)
    indexes = CarrierIndexes(profiles.base_revision + "gate", None, lambda c: by_carrier.get(c, []))
    for stop in stops:
        profile = profiles.for_carrier(str(stop.get("carrier_code")))
        yield stop, profile, indexes.name(stop, profile)


def run(stops, routes, directions, profile_dirs):
    failures = []
    shapes = collections.Counter()
    examples = collections.defaultdict(list)
    for stop, profile, name in _named_stops(stops, profile_dirs):
        rules, stop_shape = check_stop(name.public_name, stop_evidence(stop, profile))
        shapes[stop_shape] += 1
        if len(examples[stop_shape]) < 3:
            examples[stop_shape].append((stop.get("carrier_code"), stop.get("stop_name"), name.public_name))
        failures.extend(
            ("stop", stop.get("carrier_code"), stop.get("stop_id"), rule, stop.get("stop_name"), name.public_name)
            for rule in rules
        )
    for route in routes:
        failures.extend(
            ("route", route.get("route_code", "")[:2], route.get("route_code"), rule, "", route.get("public_name"))
            for rule in check_route(route.get("public_name"))
        )
    for direction in directions:
        failures.extend(
            ("direction", direction.get("carrier"), direction.get("route_code"), rule, "", direction.get("label"))
            for rule in check_direction(direction.get("label"))
        )
    return failures, shapes, examples


def report(failures, shapes, out, csv_path=None, examples=None):
    by_rule = collections.defaultdict(list)
    for failure in failures:
        by_rule[failure[3]].append(failure)
    failing = sum(1 for failure in failures if failure[3] in RULES)
    out.write(f"{sum(shapes.values())} stop names in {len(shapes)} shapes; {failing} rule failures\n")
    for rule, description in {**RULES, **KEPT}.items():
        rows = by_rule.get(rule, [])
        out.write(f"\n{rule} {description}: {len(rows)}\n")
        for row in rows[:5]:
            out.write(f"   {row[1]} {row[2]}: {row[4] or ''} -> {row[5]}\n")
    out.write("\nshapes:\n")
    for stop_shape, count in shapes.most_common():
        out.write(f"   {count:>7}  {stop_shape}\n")
        for carrier, raw, shown in (examples or {}).get(stop_shape, []):
            out.write(f"              {carrier}: {raw} -> {shown}\n")
    if csv_path:
        with open(csv_path, "w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["kind", "carrier", "id", "rule", "raw", "shown"])
            writer.writerows(failures)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check stop, route and direction names against the Metro guide.")
    parser.add_argument("--stops", required=True)
    parser.add_argument("--routes")
    parser.add_argument("--directions")
    parser.add_argument("--profiles", nargs="+", required=True)
    parser.add_argument("--csv")
    args = parser.parse_args(argv)
    from redash.transit_naming.profile_loader import CORE_PROFILE_DIR

    stops = json.load(open(args.stops))
    routes = json.load(open(args.routes)) if args.routes else []
    directions = json.load(open(args.directions)) if args.directions else []
    failures, shapes, examples = run(stops, routes, directions, [CORE_PROFILE_DIR, *args.profiles])
    report(failures, shapes, sys.stdout, args.csv, examples)
    return 1 if any(failure[3] in RULES for failure in failures) else 0


if __name__ == "__main__":
    sys.exit(main())
