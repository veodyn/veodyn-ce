import csv
import os

from redash.transit_naming.profiles import OVERRIDE_KINDS, Override, ProfileError

PROFILE_SUFFIXES = (".yaml", ".csv")


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
