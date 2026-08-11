"""What /ai/generate-sql is told about the table it is writing against.

Its own module rather than more of test_ai_routes.py, which is about the bearer
and the wire shapes and is already at the file-size ceiling. The subject here is
one thing: the prompt bar in the query editor calls the same generator the
Create-with-AI interview does, so it is given the same warehouse profile, and it
is looked up server-side rather than taken from the request.
"""

from collections.abc import Iterator

import httpx
import pytest
import respx
from sqlalchemy.orm import Session

from tests.ai_stubs import FakeLlm
from tests.test_ai_routes import AUTH, DATASET, GENERATED, build
from veodyn_api.services.ai_converse_grounding import clear_grounding_cache
from veodyn_api.services.dataset_profile_cache import clear_profile_cache

WAREHOUSE = "http://clickhouse.test"
PROFILE_MARK = "What this table currently holds"

REGISTRY = [{"query_id": 11, "table_name": "historical.regional_speeds", "query_name": "Regional speeds"}]
COLUMNS = [{"database": "historical", "table": "regional_speeds", "name": "speed_mph", "type": "Float64"}]
TABLES = [{"database": "historical", "name": "regional_speeds", "total_rows": 900}]
SPAN = [{"start": "2026-07-01 00:00:00.000", "end": "2026-07-30 14:05:00.000"}]
TABLE_FACTS = [
    {
        "rows": 900,
        "snapshots": 12,
        "first_at": "2026-07-01 00:00:00.000",
        "last_at": "2026-07-30 14:05:00.000",
        "latest_rows": 317,
    }
]
SNAPSHOT_FACTS = [
    {"n": 317, "speed_mph__nulls": 0, "speed_mph__distinct": 88, "speed_mph__low": "3", "speed_mph__high": "67"}
]


@pytest.fixture
def llm() -> FakeLlm:
    return FakeLlm()


@pytest.fixture(autouse=True)
def _clear_caches() -> Iterator[None]:
    """Both caches are process-wide. Without this the catalog another module
    seeded is served to the lookup below, and this module's fake one to it."""
    clear_grounding_cache()
    clear_profile_cache()
    yield
    clear_grounding_cache()
    clear_profile_cache()


def warehouse_answers() -> None:
    """Route each statement to the rows it asks for: the catalog reads, then the
    two profile reads. Matching on the statement text keeps the stub honest, so a
    change to what the service reads shows up here as an unrouted call rather
    than as silence."""

    def handler(request: httpx.Request) -> httpx.Response:
        sql = request.content.decode()
        for marker, rows in (
            ("_catalog", REGISTRY),
            ("system.columns", COLUMNS),
            ("system.tables", TABLES),
            # Before the span read below, which the table facts also match: they
            # take min(captured_at) over the whole table too.
            ("AS snapshots", TABLE_FACTS),
            ("count() AS n", SNAPSHOT_FACTS),
            ("min(captured_at)", SPAN),
        ):
            if marker in sql:
                return httpx.Response(200, json={"data": rows})
        return httpx.Response(500, text=f"unrouted statement: {sql}")

    respx.post(WAREHOUSE).mock(side_effect=handler)


@respx.mock
def test_the_prompt_bar_is_told_what_the_table_currently_holds(
    db: Session, llm: FakeLlm, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Without it the model writes against a column list: it cannot see that a
    snapshot is 317 rows of a 900-row append-only capture, so it averages a
    measure across every snapshot ever taken."""
    api = build(db, llm, monkeypatch, VEODYN_CLICKHOUSE_URL=WAREHOUSE)
    warehouse_answers()
    llm.answers.append(GENERATED)

    response = api.post("/ai/generate-sql", json={"prompt": "average speed", "dataset": DATASET}, headers=AUTH)

    assert response.status_code == 200
    prompt = llm.prompts[0]
    assert PROFILE_MARK in prompt
    # The snapshot's size and the column's real range, neither of which the
    # browser sent: the request carries a column list and nothing else.
    assert '"latestSnapshotRows":317' in prompt
    assert '"max":"67"' in prompt


@respx.mock
def test_a_table_the_catalog_does_not_have_costs_the_request_its_profile_and_nothing_else(
    db: Session, llm: FakeLlm, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The dataset the BROWSER sends stays what it is, and the profile is looked
    up against the catalog beside it. A request naming something the catalog does
    not list gets no profile and can never make one be read."""
    api = build(db, llm, monkeypatch, VEODYN_CLICKHOUSE_URL=WAREHOUSE)
    warehouse_answers()
    forged = {"table": "regional_speeds_secret", "columns": DATASET["columns"]}
    # Read from the table the request named, so the statement passes the same
    # validator and the only thing this test is measuring is the profile.
    llm.answers.append({"sql": "SELECT avg(speed_mph) FROM regional_speeds_secret", "rationale": "averages"})

    response = api.post("/ai/generate-sql", json={"prompt": "average speed", "dataset": forged}, headers=AUTH)

    assert response.status_code == 200
    assert PROFILE_MARK not in llm.prompts[0]


@respx.mock
def test_an_instance_with_no_redash_service_account_still_gets_the_profile(
    db: Session, llm: FakeLlm, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The profile is a warehouse read. Resolving the table through the service
    key would make this route answer 503 on an instance with no service account,
    which is a grounding requirement it has never had."""
    api = build(db, llm, monkeypatch, VEODYN_CLICKHOUSE_URL=WAREHOUSE, VEODYN_REDASH_SERVICE_API_KEY="")
    warehouse_answers()
    llm.answers.append(GENERATED)

    response = api.post("/ai/generate-sql", json={"prompt": "average speed", "dataset": DATASET}, headers=AUTH)

    assert response.status_code == 200
    assert PROFILE_MARK in llm.prompts[0]


def test_generate_sql_still_answers_with_no_warehouse_configured(
    db: Session, llm: FakeLlm, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No warehouse is a prompt with no profile in it, which is the prompt this
    route sent before. It is never a failed generation."""
    api = build(db, llm, monkeypatch)
    llm.answers.append(GENERATED)

    response = api.post("/ai/generate-sql", json={"prompt": "average speed", "dataset": DATASET}, headers=AUTH)

    assert response.status_code == 200
    assert response.json() == GENERATED
    assert PROFILE_MARK not in llm.prompts[0]
