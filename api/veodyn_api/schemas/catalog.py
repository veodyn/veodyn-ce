"""Response models for the Data Catalog endpoints.

The wire shape is the contract in app/src/types/catalog.ts. Do not add or
rename a field here without changing it there too: the frontend renders these
objects directly and falls back to fixtures when the call fails, so a drift
shows up as "the catalog looks fine" rather than as an error.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """camelCase on the wire, snake_case in Python. Same rule as schemas/kpi.py."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class DatasetColumnOut(CamelModel):
    name: str
    type: str
    description: str | None = None


class DatasetFreshnessOut(CamelModel):
    last_updated_at: str
    status: Literal["fresh", "stale"]
    feed_id: str | None = None


class DatasetCoverageOut(CamelModel):
    start: str
    end: str


class DatasetOut(CamelModel):
    id: str
    name: str
    description: str
    domain: str | None
    # `schema` is taken on a pydantic BaseModel, so the attribute is schema_ and
    # an explicit alias puts it back on the wire under the name catalog.ts reads.
    schema_: list[DatasetColumnOut] = Field(alias="schema")
    freshness: DatasetFreshnessOut
    coverage: DatasetCoverageOut
    row_count: int
    sources: list[str]
    tags: list[str]
    sample_query_id: int | None
    # Where this dataset comes from, and whether this build can write to it.
    # Both default to what a captured dataset is, so a community response is a
    # true statement rather than a placeholder: nothing here is writable and
    # everything here was captured. Feed Health reads `origin` off this model
    # rather than off the internal source type, because build_feeds is handed
    # DatasetOut and nothing else (services/feeds.py).
    origin: str = "capture"
    writable: bool = False


class HubCounterOut(CamelModel):
    label: str
    value: float
    unit: str | None = None
    delta: float | None = None
    delta_unit: str | None = None
    query_id: int | None = None
    # Set for every counter this service emits: the tile then renders a live
    # KpiScorecard, which reads the KPI itself rather than trusting the number
    # frozen into this response.
    kpi_id: str | None = None


class DomainHubOut(CamelModel):
    key: str
    label: str
    icon: str | None = None
    dataset_ids: list[str]
    dashboard_ids: list[int]
    counters: list[HubCounterOut]
