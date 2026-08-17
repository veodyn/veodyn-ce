"""How the Data Catalog endpoint reports a ClickHouse that refuses to answer.

Split out of test_catalog.py, which grew past the file-size limit once the
catalog shape tests picked up two more fields. This half is a coherent unit on
its own: one real ClickHouse error body, and every case that error shape has to
be handled by, from "not captured yet" through "an unreadable failure still
names something".
"""

import json

import httpx
import respx
from fastapi.testclient import TestClient

from tests.test_catalog import USER, WAREHOUSE, as_user, catalog_api

__all__ = ["catalog_api"]  # re-exported so pytest picks up the fixture import


# What a real ClickHouse 25.3 sends, captured from one rather than invented.
# Two details matter and both were got wrong on the first attempt at these
# tests: the status is 404, and the body is PRETTY-PRINTED JSON whose first
# line is `{`. A compact one-line stub would let the old "read the first line"
# code pass this file while still producing `refused a read: {` in production.
def clickhouse_error(status: int, exception: str) -> httpx.Response:
    body = (
        "{\n"
        '\t"meta":\n\t[\n\n\t],\n\n'
        '\t"data":\n\t[\n\n\t],\n\n'
        '\t"rows": 0,\n\n'
        f'\t"exception": {json.dumps(exception)}\n'
        "}\n"
    )
    return httpx.Response(status, text=body, headers={"content-type": "application/json"})


# Redash creates historical._catalog on its first capture, so until then the
# table does not exist. This is the state a freshly installed community stack
# is in, and ClickHouse's code for it is 60, UNKNOWN_TABLE.
UNKNOWN_TABLE = (
    "Code: 60. DB::Exception: Unknown table expression identifier "
    "'historical._catalog' in scope SELECT query_id, table_name, query_name "
    "FROM historical._catalog. (UNKNOWN_TABLE) (version 25.3.14.14 (official build))"
)
MEMORY_LIMIT = "Code: 241. DB::Exception: Memory limit exceeded. (MEMORY_LIMIT_EXCEEDED) (version 25.3.14.14)"


@respx.mock
def test_the_error_stub_is_the_shape_clickhouse_really_sends(catalog_api: TestClient) -> None:
    """The control on the three tests below, because all of them are only worth
    anything if the body they feed is the awkward one. If this stub ever became
    single-line JSON, the "read the first line" bug would pass every one of
    them."""
    response = clickhouse_error(404, UNKNOWN_TABLE)

    assert response.status_code == 404
    assert response.text.splitlines()[0] == "{"
    assert len(response.text.splitlines()) > 1
    assert response.json()["exception"] == UNKNOWN_TABLE


@respx.mock
def test_a_warehouse_with_nothing_captured_yet_is_an_empty_catalog(catalog_api: TestClient) -> None:
    as_user(USER)
    respx.post(WAREHOUSE).mock(return_value=clickhouse_error(404, UNKNOWN_TABLE))

    response = catalog_api.get("/catalog", cookies={"session": "s"})

    assert response.status_code == 200
    assert response.json() == []


@respx.mock
def test_a_warehouse_that_refuses_for_any_other_reason_is_still_an_error(catalog_api: TestClient) -> None:
    """The control on the test above. Swallowing UNKNOWN_TABLE is only safe if
    every other refusal still surfaces, so this asserts the one next to it: a
    real failure must not be reported as an empty catalog."""
    as_user(USER)
    respx.post(WAREHOUSE).mock(return_value=clickhouse_error(500, MEMORY_LIMIT))

    response = catalog_api.get("/catalog", cookies={"session": "s"})

    assert response.status_code == 502
    assert response.json()["error"]["id"] == "VEODYN_WAREHOUSE_UNREACHABLE"


@respx.mock
def test_a_refusal_names_the_reason_rather_than_the_first_byte_of_the_body(catalog_api: TestClient) -> None:
    """Every statement this client sends ends `FORMAT JSON`, so a ClickHouse
    failure arrives as a JSON document whose first line is `{`. Reading the
    first line, which is what this used to do, made every warehouse refusal
    report itself as `refused a read: {` and told an operator nothing."""
    as_user(USER)
    respx.post(WAREHOUSE).mock(return_value=clickhouse_error(500, MEMORY_LIMIT))

    message = catalog_api.get("/catalog", cookies={"session": "s"}).json()["error"]["message"]

    assert "Memory limit exceeded" in message
    assert not message.endswith("{")


@respx.mock
def test_a_non_json_refusal_still_names_something(catalog_api: TestClient) -> None:
    """A proxy or an ingress in front of ClickHouse answers with neither shape,
    so the plain-text path has to keep working."""
    as_user(USER)
    respx.post(WAREHOUSE).mock(return_value=httpx.Response(502, text="upstream connect error\nstack frame"))

    message = catalog_api.get("/catalog", cookies={"session": "s"}).json()["error"]["message"]

    assert "upstream connect error" in message
    assert "stack frame" not in message
