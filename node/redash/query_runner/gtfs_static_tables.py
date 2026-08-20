"""Archive and CSV helpers for the static GTFS query runner."""

import io

from redash.query_runner import (
    TYPE_BOOLEAN,
    TYPE_DATETIME,
    TYPE_FLOAT,
    TYPE_INTEGER,
    TYPE_STRING,
    guess_type,
)

TABLE_SUFFIX = ".txt"

DEFAULT_MAX_ROWS = 100000
MAX_ROWS_CEILING = 1000000

# The transport cap bounds the compressed body only, so the archive's declared
# expansion is bounded separately. 500 MB is roughly ten times what the largest
# published agency feed expands to, and the ratio limit catches the small
# archive that expands to far more than that.
MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200
# Below this, a high ratio says nothing: a few hundred bytes of repeated text
# compresses just as hard as a bomb does.
RATIO_FLOOR_BYTES = 1024
# GTFS defines about 30 tables; a feed nesting them a few directories deep is
# still nowhere near this.
MAX_ARCHIVE_MEMBERS = 1000


def too_large_message(safe_url, limit):
    return f"GTFS archive from {safe_url} expands to more than {limit} bytes"


def parse_max_rows(value):
    """Return (max_rows, error) for the persisted max_rows configuration.

    An empty configuration takes the default. Anything else has to be a whole
    number in range: flooring a fraction or reading 0 as "unset" silently
    changes how many rows a query returns.
    """
    if value is None or value == "":
        return DEFAULT_MAX_ROWS, None
    invalid = f"Static GTFS: 'max_rows' must be a whole number between 1 and {MAX_ROWS_CEILING}, got {value!r}"
    if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
        return None, invalid
    try:
        rows = int(value)
    except (TypeError, ValueError):
        return None, invalid
    if rows < 1 or rows > MAX_ROWS_CEILING:
        return None, invalid
    return rows, None


def check_archive_bounds(archive, safe_url):
    """Reject an archive whose central directory declares an absurd expansion.

    Cheap and first, but every number here is one whoever built the archive
    wrote, so it is only half the bound: DecompressionBudget counts what the
    decompressor actually produces.
    """
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_MEMBERS:
        raise ValueError(
            f"GTFS archive from {safe_url} holds {len(infos)} members, over the {MAX_ARCHIVE_MEMBERS} limit"
        )

    total = 0
    for info in infos:
        if info.compress_size >= RATIO_FLOOR_BYTES and info.file_size > info.compress_size * MAX_COMPRESSION_RATIO:
            ratio = info.file_size // info.compress_size
            raise ValueError(
                f"GTFS archive from {safe_url} member {info.filename!r} expands {ratio}:1, "
                f"over the {MAX_COMPRESSION_RATIO}:1 limit"
            )
        total += info.file_size
        if total > MAX_UNCOMPRESSED_BYTES:
            raise ValueError(too_large_message(safe_url, MAX_UNCOMPRESSED_BYTES))


class DecompressionBudget:
    """One aggregate ceiling per query on bytes actually decompressed.

    Shared across every member a query opens, so an archive splitting its
    expansion over many small members is bounded the same as one large one.
    """

    def __init__(self, safe_url, limit=None):
        self.safe_url = safe_url
        self.limit = MAX_UNCOMPRESSED_BYTES if limit is None else limit
        self.used = 0

    def spend(self, count):
        self.used += count
        if self.used > self.limit:
            raise ValueError(too_large_message(self.safe_url, self.limit))


class CountingReader(io.RawIOBase):
    """Charges the query's budget for every byte read out of an archive member."""

    def __init__(self, stream, budget):
        self.stream = stream
        self.budget = budget

    def readable(self):
        return True

    def readinto(self, buffer):
        chunk = self.stream.read(len(buffer))
        self.budget.spend(len(chunk))
        buffer[: len(chunk)] = chunk
        return len(chunk)

    def close(self):
        try:
            self.stream.close()
        finally:
            super().close()


def table_name_for(filename):
    """Canonical table name for an archive member, or None if it is not a GTFS table.

    The leading-dot test drops the `__MACOSX/._stops.txt` AppleDouble copies a
    zip made on macOS carries, which would otherwise shadow the real table.
    """
    base = filename.split("/")[-1]
    if base.startswith(".") or not base.lower().endswith(TABLE_SUFFIX):
        return None
    return base[: -len(TABLE_SUFFIX)]


def table_members(archive):
    """Map table name to archive member name, ignoring directories and non-tables.

    Two members canonicalizing to one table name is rejected rather than
    resolved: which one wins would come down to the order of the archive.
    """
    members = {}
    for info in archive.infolist():
        if info.is_dir():
            continue
        name = table_name_for(info.filename)
        if name is None:
            continue
        if name in members:
            raise ValueError(f"GTFS archive has two members for table {name!r}: {members[name]} and {info.filename}")
        members[name] = info.filename
    return members


def open_table(archive, member, budget):
    """Open one member as text against the query's budget, dropping a UTF-8 BOM."""
    reader = CountingReader(archive.open(member), budget)
    return io.TextIOWrapper(io.BufferedReader(reader), encoding="utf-8-sig", newline="")


def matches(record, filters, fields):
    """True when the record equals every filter, values compared as strings.

    `fields` is the table's own header. A filter naming a column the table does
    not have matches nothing, including when the filter value is "", which a
    missing field would otherwise be indistinguishable from.
    """
    for field, wanted in filters.items():
        if field not in fields:
            return False
        values = wanted if isinstance(wanted, list) else [wanted]
        value = record.get(field)
        if ("" if value is None else str(value)) not in [str(wanted_value) for wanted_value in values]:
            return False
    return True


def merge_types(current, guessed):
    """Widen a column's type to hold both the type so far and one more value."""
    if current is None or current == guessed:
        return guessed
    if {current, guessed} == {TYPE_INTEGER, TYPE_FLOAT}:
        return TYPE_FLOAT
    return TYPE_STRING


def column_type_for(field, records):
    """Merge a column's type across every value being returned.

    Reading the first value alone declares integer for a distance field that
    starts at 0 and then hands back "34.5" as a string under it, so every
    retained value votes and the type widens to hold them all.

    Ids stay strings whatever they look like: a numeric route_id would lose a
    leading zero and stop joining against the realtime feed's string route_id.
    Datetime is not used either, since guess_type reads "7th St" as a date, and
    GTFS spells dates as YYYYMMDD integers and allows times past 24:00:00.
    """
    if field.endswith("_id"):
        return TYPE_STRING
    column_type = None
    for record in records:
        value = record.get(field) or ""
        if value == "":
            continue
        guessed = guess_type(value)
        column_type = merge_types(column_type, TYPE_STRING if guessed == TYPE_DATETIME else guessed)
        if column_type == TYPE_STRING:
            return TYPE_STRING
    return column_type or TYPE_STRING


def coerce(value, column_type):
    """Convert one CSV string to the column's guessed type, keeping it on failure."""
    if value == "" or value is None:
        return None
    try:
        if column_type == TYPE_INTEGER:
            return int(value)
        if column_type == TYPE_FLOAT:
            return float(value)
        if column_type == TYPE_BOOLEAN:
            return value.strip().lower() == "true"
    except (ValueError, OverflowError):
        return value
    return value
