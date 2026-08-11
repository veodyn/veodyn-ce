"""Report data_sources.type counts, so a connector rename is not a silent drop.

Usage:  docker exec redash-server-1 python bin/report_data_source_types.py
Reads the same database the app does, prints one line per type with its row
count, and flags the types this release renames or retires.

Exits non-zero when any row's type is in RETIRED_TYPES or
NEEDS_MANUAL_MIGRATION, so this can gate a deploy instead of only being read
by a human. A database with no rows in either bucket exits 0.

Types in PACK_PROVIDED_TYPES are reported but do not gate: their runner moved
to a customer pack installed on top of this image, and an operator running
the pack-installed image is in a correct state, so exiting non-zero there
would fail every deploy that has the pack.

The gating decision (build_blocking_reasons, offending_types) and the report
text (format_report_lines) are plain functions that take a list of
(type_name, count) pairs, so tests/test_report_data_source_types.py can
exercise the actual gate/no-gate logic without a live database or Flask app
context. main() is the only part that touches the database.
"""

import os
import sys

# Run as `python bin/report_data_source_types.py`, so the script's own
# directory (bin/), not the project root, is what Python puts on sys.path.
# Add the project root by hand or the redash import below fails.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from redash.query_runner.legacy_types import (  # noqa: E402
    NEEDS_MANUAL_MIGRATION,
    PACK_PROVIDED_TYPES,
    RETIRED_TYPES,
    TYPE_RENAMES,
)


def build_blocking_reasons():
    """type_name -> human-readable reason, for every type that must block a
    deploy: retired outright, or renamed in a way that needs a manual
    decision. PACK_PROVIDED_TYPES is deliberately not folded in here; those
    types are reported (see format_report_lines) but never gate.
    """
    blocking_reasons = {type_name: "RETIRED, no replacement, decide before migrating" for type_name in RETIRED_TYPES}
    blocking_reasons.update(NEEDS_MANUAL_MIGRATION)
    return blocking_reasons


def offending_types(counts, blocking_reasons):
    """The blocking type_names actually present in counts, sorted.

    An empty result is what makes main() exit 0; a non-empty one is what
    makes it exit 1. counts is a sequence of (type_name, count) pairs, the
    same shape the SQLAlchemy group-by query in main() returns.
    """
    return sorted(set(blocking_reasons) & {type_name for type_name, _ in counts})


def format_report_lines(counts, blocking_reasons):
    """One line per (type_name, count), flagged with what an operator should
    do about it. Renamed types are informational, blocking types say BLOCKS
    DEPLOY, and pack-provided types say what to install: none of the three
    flags affect the exit code, only offending_types() does.
    """
    lines = []
    for type_name, count in counts:
        flag = ""
        if type_name in TYPE_RENAMES:
            flag = f"  -> renamed to {TYPE_RENAMES[type_name]}"
        elif type_name in blocking_reasons:
            flag = f"  -> BLOCKS DEPLOY: {blocking_reasons[type_name]}"
        elif type_name in PACK_PROVIDED_TYPES:
            flag = f"  -> needs pack: {PACK_PROVIDED_TYPES[type_name]}"
        lines.append(f"{count:>6}  {type_name}{flag}")
    return lines


def main():
    from redash import models

    blocking_reasons = build_blocking_reasons()

    counts = (
        models.db.session.query(models.DataSource.type, models.db.func.count(models.DataSource.id))
        .group_by(models.DataSource.type)
        .order_by(models.DataSource.type)
        .all()
    )
    for line in format_report_lines(counts, blocking_reasons):
        print(line)

    offending = offending_types(counts, blocking_reasons)
    if not offending:
        return 0

    print()
    print("The following types must be resolved by an operator before this release can deploy:")
    for type_name in offending:
        rows = (
            models.db.session.query(models.DataSource.id, models.DataSource.name)
            .filter(models.DataSource.type == type_name)
            .order_by(models.DataSource.id)
            .all()
        )
        ids = ", ".join(str(row.id) for row in rows)
        print(f"  {type_name}: {len(rows)} row(s), id(s) {ids}")
        print(f"    {blocking_reasons[type_name]}")
    return 1


if __name__ == "__main__":
    from redash import create_app

    app = create_app()
    with app.app_context():
        sys.exit(main())
