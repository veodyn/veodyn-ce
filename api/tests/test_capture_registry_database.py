from typing import Any

from veodyn_api.services.capture_sources import capture_sources
from veodyn_api.services.domains import _dataset_ids


class RecordingWarehouse:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def query(self, statement: str, params: Any = None) -> list[dict[str, Any]]:
        self.statements.append(statement)
        return []


def test_capture_sources_reads_the_registry_in_the_configured_database() -> None:
    warehouse = RecordingWarehouse()

    capture_sources(warehouse, "historical_stage")

    assert "FROM historical_stage._catalog FINAL" in warehouse.statements[0]


def test_domain_dataset_ids_read_the_registry_in_the_configured_database() -> None:
    warehouse = RecordingWarehouse()

    _dataset_ids(warehouse, [1, 2], "historical_stage")

    assert "FROM historical_stage._catalog FINAL" in warehouse.statements[0]


def test_an_unset_database_still_reads_the_default_registry() -> None:
    warehouse = RecordingWarehouse()

    capture_sources(warehouse, "")

    assert "FROM historical._catalog FINAL" in warehouse.statements[0]
