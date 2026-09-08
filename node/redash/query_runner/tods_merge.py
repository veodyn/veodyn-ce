import csv

from redash.query_runner.gtfs_static_tables import open_table

SUPPLEMENT_SUFFIX = "_supplement"
DELETE_FIELD = "TODS_delete"

PRIMARY_KEYS = {
    "trips": ("trip_id",),
    "stops": ("stop_id",),
    "stop_times": ("trip_id", "stop_sequence"),
    "routes": ("route_id",),
    "calendar": ("service_id",),
    "calendar_dates": ("service_id", "date"),
}


def supplement_name(table):
    return f"{table}{SUPPLEMENT_SUFFIX}"


def read_rows(archive, member, budget):
    with open_table(archive, member, budget) as text:
        reader = csv.DictReader(text)
        header = list(reader.fieldnames or [])
        rows = [{field: record.get(field) or "" for field in header} for record in reader]
    return header, rows


def _key_fields(table, base_header, supplement_header):
    keys = PRIMARY_KEYS.get(table)
    if keys is None:
        supported = ", ".join(sorted(PRIMARY_KEYS))
        raise ValueError(f"TODS defines no supplement for table {table!r}. Tables with a supplement: {supported}")
    for name, header in (("base", base_header), ("supplement", supplement_header)):
        missing = [key for key in keys if key not in header]
        if missing:
            raise ValueError(f"The {name} {table} table lacks its primary key column(s): {', '.join(missing)}")
    return keys


def _key_of(row, keys):
    return tuple(row.get(key) or "" for key in keys)


def _is_delete(row):
    return (row.get(DELETE_FIELD) or "").strip() == "1"


class SupplementIndex:
    def __init__(self, table, base_header, supplement_header, supplement_rows):
        self.keys = _key_fields(table, base_header, supplement_header)
        added = [field for field in supplement_header if field not in base_header and field != DELETE_FIELD]
        self.header = list(base_header) + added
        self.patches = {_key_of(row, self.keys): row for row in supplement_rows}

    def merge(self, base_rows):
        seen = set()
        for row in base_rows:
            key = _key_of(row, self.keys)
            patch = self.patches.get(key)
            if patch is None:
                yield row
                continue
            seen.add(key)
            if _is_delete(patch):
                continue
            merged = dict(row)
            for field, value in patch.items():
                if field != DELETE_FIELD and value != "":
                    merged[field] = value
            yield merged
        for key, patch in self.patches.items():
            if key not in seen and not _is_delete(patch):
                yield {field: value for field, value in patch.items() if field != DELETE_FIELD}


def merge_supplement(table, base_header, base_rows, supplement_header, supplement_rows):
    index = SupplementIndex(table, base_header, supplement_header, supplement_rows)
    rows = [{field: row.get(field) or "" for field in index.header} for row in index.merge(base_rows)]
    return index.header, rows
