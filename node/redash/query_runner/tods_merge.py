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


def merge_supplement(table, base_header, base_rows, supplement_header, supplement_rows):
    keys = _key_fields(table, base_header, supplement_header)
    added_fields = [field for field in supplement_header if field not in base_header and field != DELETE_FIELD]
    header = list(base_header) + added_fields
    merged = {tuple(row.get(key) or "" for key in keys): dict(row) for row in base_rows}
    for row in supplement_rows:
        key = tuple(row.get(field) or "" for field in keys)
        delete = (row.get(DELETE_FIELD) or "").strip() == "1"
        if key in merged:
            if delete:
                del merged[key]
                continue
            for field, value in row.items():
                if field != DELETE_FIELD and value != "":
                    merged[key][field] = value
        elif not delete:
            merged[key] = {field: value for field, value in row.items() if field != DELETE_FIELD}
    rows = [{field: row.get(field) or "" for field in header} for row in merged.values()]
    return header, rows
