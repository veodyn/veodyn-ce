import csv
import os

import yaml

from redash.transit_naming.profiles import OVERRIDE_KINDS, Override, ProfileError

PROFILE_SUFFIXES = (".yaml", ".csv", ".streets.json")
INHERITED_NEVER = frozenset({"carrier_code", "carrier_display_name"})


class StrictLoader(yaml.SafeLoader):
    pass


def _mapping_without_duplicates(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise ProfileError(f"duplicate key {key!r}", field=str(key))
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)


StrictLoader.construct_mapping = _mapping_without_duplicates


def load_strict_yaml(text):
    return yaml.load(text, Loader=StrictLoader)


def with_default_data(data, default_data, file):
    inherit = data.get("inherit_default", False)
    if not isinstance(inherit, bool):
        raise ProfileError(
            f"inherit_default must be true or false, got {inherit!r}", file=file, field="inherit_default"
        )
    if not inherit:
        return data
    if default_data is None:
        raise ProfileError(
            "inherit_default needs default.yaml in the same profile set", file=file, field="inherit_default"
        )
    merged = {key: value for key, value in default_data.items() if key not in INHERITED_NEVER}
    merged.update(data)
    merged["stop_name"] = {**(default_data.get("stop_name") or {}), **(data.get("stop_name") or {})}
    return merged


def parse_overrides_csv(text, carrier, file):
    overrides = {}
    for row_number, row in enumerate(csv.DictReader(text.splitlines()), start=2):
        kind = (row.get("kind") or "").strip()
        key = (row.get("key") or "").strip()
        if kind not in OVERRIDE_KINDS:
            message = f"override kind {kind!r} is not one of {OVERRIDE_KINDS}"
            raise ProfileError(message, carrier, file, row_number, "kind")
        if (kind, key) in overrides:
            raise ProfileError(f"duplicate override key {key!r}", carrier, file, row_number, "key")
        public_name = (row.get("public_name") or "").strip()
        overrides[(kind, key)] = Override(kind, key, public_name, (row.get("note") or "").strip())
    return overrides


def read_profile_files(dirs, extra_files=None):
    files = {}
    for directory in dirs:
        if not os.path.isdir(directory):
            raise ProfileError(f"profile directory {directory} does not exist", file=directory)
        for name in sorted(os.listdir(directory)):
            if name.endswith(PROFILE_SUFFIXES):
                path = os.path.join(directory, name)
                with open(path, "rb") as handle:
                    files[path] = handle.read()
    for directory, members in (extra_files or {}).items():
        for name, text in members.items():
            files[os.path.join(directory, name)] = text.encode("utf-8")
    return files
