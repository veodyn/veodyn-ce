import logging
import re
import threading
import time
from functools import lru_cache

from redash.transit_naming.profiles import Override

logger = logging.getLogger(__name__)

EDITABLE_KINDS = ("stop", "route")
TABLE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$")
SELECTED_COLUMNS = ("kind", "carrier_code", "target_id", "public_name", "note", "captured_at")


def _text(value):
    return str(value if value is not None else "").strip()


def read_overrides(client, table):
    if not TABLE_NAME.match(table or ""):
        raise ValueError(f"the override table must be named database.table, got {table!r}")
    result = client.query_json(f"SELECT {', '.join(SELECTED_COLUMNS)} FROM {table}")
    overrides = {}
    for row in sorted(result.get("data") or [], key=lambda row: _text(row.get("captured_at"))):
        kind = _text(row.get("kind")).lower()
        carrier = _text(row.get("carrier_code")).upper()
        target = _text(row.get("target_id"))
        public_name = _text(row.get("public_name"))
        if kind not in EDITABLE_KINDS or not carrier or not target or not public_name:
            continue
        overrides.setdefault(carrier, {})[(kind, target)] = Override(kind, target, public_name, _text(row.get("note")))
    return overrides


class OverrideTable:
    def __init__(self, table, client, ttl_seconds=60, clock=time.monotonic):
        self.table = table
        self.client = client
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self.loaded_at = None
        self.overrides = {}
        self.lock = threading.Lock()

    def _fresh(self, now):
        return self.loaded_at is not None and now - self.loaded_at < self.ttl_seconds

    def current(self):
        if not self.table:
            return {}
        if self._fresh(self.clock()):
            return self.overrides
        with self.lock:
            now = self.clock()
            if self._fresh(now):
                return self.overrides
            try:
                self.overrides = read_overrides(self.client, self.table)
            except Exception:
                logger.warning(
                    "could not read transit naming overrides from %s; naming with the last ones read",
                    self.table,
                    exc_info=True,
                )
            self.loaded_at = now
            return self.overrides


@lru_cache(maxsize=1)
def override_table():
    from redash.historical.client import ClickHouseHistoricalClient
    from redash.settings import transit_naming as settings

    client = ClickHouseHistoricalClient(
        settings.OVERRIDE_CLICKHOUSE_URL,
        settings.OVERRIDE_CLICKHOUSE_USER,
        settings.OVERRIDE_CLICKHOUSE_PASSWORD,
        timeout=settings.OVERRIDE_TIMEOUT_SECONDS,
    )
    return OverrideTable(settings.OVERRIDE_TABLE, client, settings.OVERRIDE_TTL_SECONDS)
