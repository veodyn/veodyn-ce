"""Which database an unqualified table name resolves in.

Every statement this service wrote by hand names `historical.<table>` in full,
so nothing ever depended on the answer. A dataset's id is the BARE table name
though, and two things now build statements out of one: profiling a table, and
DESCRIBE-ing a generated SELECT that names the table the model was given. Both
read whatever database the HTTP connection defaults to, which is not the one the
captures live in.

The failure is silent by construction (dataset_profile and result_shape both
swallow a warehouse error and answer with "no profile" / "no shape"), so it can
only be caught here, at the request.
"""

from typing import Any

import httpx
import pytest
import respx

from veodyn_api.services.clickhouse import ClickHouseClient
from veodyn_api.settings import Settings

WAREHOUSE = "http://clickhouse.test"


def client(**overrides: Any) -> ClickHouseClient:
    return ClickHouseClient(Settings(clickhouse_url=WAREHOUSE, **overrides))


@respx.mock
def test_an_unqualified_name_resolves_in_the_configured_database() -> None:
    route = respx.post(WAREHOUSE).mock(return_value=httpx.Response(200, json={"data": []}))

    client().query("SELECT count() FROM regional_bikes")

    assert route.calls.last.request.url.params["database"] == "historical"


@respx.mock
def test_the_configured_database_is_the_one_sent() -> None:
    route = respx.post(WAREHOUSE).mock(return_value=httpx.Response(200, json={"data": []}))

    client(clickhouse_database="warehouse_two").query("SELECT count() FROM regional_bikes")

    assert route.calls.last.request.url.params["database"] == "warehouse_two"


@respx.mock
def test_statement_parameters_still_travel_under_their_own_prefix() -> None:
    """The database is a connection setting and a bound value is a statement
    parameter. Sharing one dict is why this test exists: a `database` param
    would otherwise be readable as `{database:String}` inside a statement."""
    route = respx.post(WAREHOUSE).mock(return_value=httpx.Response(200, json={"data": []}))

    client().query("SELECT {names:Array(String)}", {"names": "['a']"})

    params = route.calls.last.request.url.params
    assert params["param_names"] == "['a']"
    assert params["database"] == "historical"


@respx.mock
def test_no_database_is_sent_when_none_is_configured() -> None:
    route = respx.post(WAREHOUSE).mock(return_value=httpx.Response(200, json={"data": []}))

    client(clickhouse_database="").query("SELECT 1")

    assert "database" not in route.calls.last.request.url.params


@pytest.mark.parametrize("statement", ["SELECT * FROM historical._catalog", "SELECT * FROM system.columns"])
@respx.mock
def test_a_qualified_name_is_unaffected(statement: str) -> None:
    """Everything this service wrote before qualifies its tables, and a
    qualified name wins over the connection default. Parametrized over the two
    kinds it uses: the registry in its own database, and a system table."""
    route = respx.post(WAREHOUSE).mock(return_value=httpx.Response(200, json={"data": []}))

    client().query(statement)

    assert route.calls.last.request.content.decode().startswith(statement)
