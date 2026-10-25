import json
from typing import Any

import pytest

from tests.query_edit_stubs import SNAPSHOT, call, complete, ctx, edit_result, update_call
from tests.test_chat_tools import Drafts
from veodyn_api.services.chat.tools import ClientCall, DataSourceInfo, Immediate, prepare_call, result_kind_for

pytestmark = pytest.mark.anyio


async def test_open_query_asks_the_browser() -> None:
    outcome = await prepare_call(call("open_query", queryId=5), ctx())
    assert outcome == ClientCall(call_id="call-1", tool="open_query", args={"queryId": 5})
    assert result_kind_for("open_query") == "query_detail"
    assert result_kind_for("update_query") == "query_edit"


@pytest.mark.parametrize("query_id", [None, 0, -1, "abc", True])
async def test_open_query_refuses_a_bad_id(query_id: Any) -> None:
    outcome = await prepare_call(call("open_query", queryId=query_id), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "queryId" in outcome.content


async def test_update_query_goes_to_the_browser_with_the_same_args() -> None:
    changes = {
        "sql": "select {{ day }}",
        "name": "Trips by day",
        "parameters": [{"name": "day", "type": "date"}],
        "schedule": {"interval": 86400, "time": "06:00", "dayOfWeek": None, "until": None},
        "tags": ["a"],
        "isDraft": False,
        "dataSourceId": 1,
        "description": "x",
    }
    outcome = await prepare_call(update_call(changes, format=True), ctx())
    assert outcome == ClientCall(
        call_id="call-1", tool="update_query", args={"queryId": 5, "changes": changes, "format": True}
    )


async def test_update_query_format_defaults_to_false() -> None:
    outcome = await prepare_call(update_call({"name": "x"}), ctx())
    assert isinstance(outcome, ClientCall)
    assert outcome.args["format"] is False


def twenty_one() -> list[dict[str, str]]:
    return [{"name": f"p{n}", "type": "text"} for n in range(21)]


@pytest.mark.parametrize(
    ("arguments", "field"),
    [
        ({"queryId": 0, "changes": {"name": "x"}}, "queryId"),
        ({"queryId": 5, "changes": {}}, "changes"),
        ({"queryId": 5}, "changes"),
        ({"queryId": 5, "changes": {"colour": "red"}}, "colour"),
        ({"queryId": 5, "changes": {"parameters": twenty_one()}}, "parameters"),
        ({"queryId": 5, "changes": {"schedule": {"interval": 120}}}, "schedule.interval"),
        ({"queryId": 5, "changes": {"schedule": {"interval": 3600, "time": "06:00"}}}, "schedule.time"),
        ({"queryId": 5, "changes": {"schedule": {"interval": 86400, "dayOfWeek": "Monday"}}}, "schedule.dayOfWeek"),
        ({"queryId": 5, "changes": {"sql": ""}}, "sql"),
        ({"queryId": 5, "changes": {"dataSourceId": 0}}, "dataSourceId"),
        ({"queryId": 5, "changes": {"tags": "a"}}, "tags"),
        ({"queryId": 5, "changes": {"isDraft": "yes"}}, "isDraft"),
    ],
)
async def test_update_query_refusals(arguments: dict[str, Any], field: str) -> None:
    outcome = await prepare_call(call("update_query", **arguments), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert field in outcome.content


async def test_update_query_accepts_a_weekly_schedule_with_day_and_time() -> None:
    schedule = {"interval": 604800, "time": "06:00", "dayOfWeek": "Monday", "until": None}
    outcome = await prepare_call(update_call({"schedule": schedule}), ctx())
    assert isinstance(outcome, ClientCall)


async def test_update_query_accepts_clearing_the_schedule() -> None:
    outcome = await prepare_call(update_call({"schedule": None}), ctx())
    assert isinstance(outcome, ClientCall)
    assert outcome.args["changes"] == {"schedule": None}


async def test_update_query_complete_saves_draft() -> None:
    drafts = Drafts()
    changes = {"sql": "select {{ day }}", "parameters": [{"name": "day", "type": "date"}]}

    outcome = await complete(edit_result(changes), ctx(drafts))

    assert not outcome.is_error
    assert drafts.saved == [("query_edit", None, {"queryId": 5, "snapshot": SNAPSHOT, "changes": changes})]
    assert json.loads(outcome.content) == {"draftId": "draft-1", "version": 1, "changed": ["sql", "parameters"]}
    assert outcome.draft == {
        "draftId": "draft-1",
        "version": 1,
        "kind": "query_edit",
        "payload": {"queryId": 5, "snapshot": SNAPSHOT, "changes": changes},
    }


async def test_update_query_complete_fills_the_snapshot_fields_a_browser_left_out() -> None:
    drafts = Drafts()
    sparse = {key: value for key, value in SNAPSHOT.items() if key not in ("description", "schedule")}

    outcome = await complete(edit_result({"name": "Renamed"}, snapshot=sparse), ctx(drafts))

    assert not outcome.is_error
    [(_, _, payload)] = drafts.saved
    assert payload["snapshot"]["description"] is None
    assert payload["snapshot"]["schedule"] is None


async def test_update_query_complete_keeps_a_clear_schedule_change() -> None:
    drafts = Drafts()
    snapshot = {**SNAPSHOT, "schedule": {"interval": 3600, "time": None, "dayOfWeek": None, "until": None}}

    outcome = await complete(edit_result({"schedule": None}, snapshot=snapshot), ctx(drafts))

    assert json.loads(outcome.content)["changed"] == ["schedule"]
    assert drafts.saved[0][2]["changes"] == {"schedule": None}


async def test_update_query_complete_refuses_unsafe_sql() -> None:
    drafts = Drafts()
    outcome = await complete(edit_result({"sql": "delete from x"}), ctx(drafts))
    assert outcome.is_error
    assert "refused" in outcome.content
    assert drafts.saved == []


async def test_update_query_complete_checks_sql_against_a_changed_data_source() -> None:
    drafts = Drafts()
    outcome = await complete(edit_result({"dataSourceId": 99}), ctx(drafts))
    assert outcome.is_error
    assert "99" in outcome.content or "data source" in outcome.content
    assert drafts.saved == []


async def test_update_query_complete_validates_warehouse_sql_against_the_catalog() -> None:
    drafts = Drafts()
    snapshot = {**SNAPSHOT, "dataSourceId": 5}
    good = await complete(edit_result({"sql": "SELECT avg(speed_mph) FROM regional_speeds"}, snapshot), ctx(drafts))
    assert not good.is_error, good.content
    bad = await complete(edit_result({"sql": "SELECT * FROM somewhere_else"}, snapshot), ctx(drafts))
    assert bad.is_error
    assert len(drafts.saved) == 1


async def test_update_query_complete_refuses_warehouse_sql_when_the_catalog_is_hidden() -> None:
    drafts = Drafts()
    snapshot = {**SNAPSHOT, "dataSourceId": 5}
    outcome = await complete(
        edit_result({"sql": "SELECT avg(speed_mph) FROM regional_speeds"}, snapshot), ctx(drafts, datasets=())
    )
    assert outcome.is_error
    assert drafts.saved == []


async def test_update_query_complete_validates_a_json_source_resource_call() -> None:
    drafts = Drafts()
    known = {
        1: DataSourceInfo(syntax="json", view_only=False, resources={"stops": ("agency",)}),
    }
    good_sql = json.dumps({"resource": "stops", "params": {"agency": "x"}})
    bad_sql = json.dumps({"resource": "missing", "params": {}})
    good = await complete(edit_result({"sql": good_sql}), ctx(drafts, known_sources=known))
    assert not good.is_error, good.content
    bad = await complete(edit_result({"sql": bad_sql}), ctx(drafts, known_sources=known))
    assert bad.is_error
    assert "missing" in bad.content
    garbage = await complete(edit_result({"sql": "not json"}), ctx(drafts, known_sources=known))
    assert garbage.is_error


async def test_update_query_complete_refuses_orphan_parameter() -> None:
    drafts = Drafts()
    undefined = await complete(edit_result({"sql": "select {{ x }}"}), ctx(drafts))
    assert undefined.is_error and "x" in undefined.content
    unused = await complete(edit_result({"parameters": [{"name": "y", "type": "text"}]}), ctx(drafts))
    assert unused.is_error and "y" in unused.content
    assert drafts.saved == []


async def test_update_query_complete_checks_the_resulting_parameters_not_just_the_changed_ones() -> None:
    drafts = Drafts()
    snapshot = {**SNAPSHOT, "sql": "select {{ day }}", "parameters": [{"name": "day", "type": "date"}]}
    outcome = await complete(edit_result({"sql": "select 1"}, snapshot), ctx(drafts))
    assert outcome.is_error and "day" in outcome.content


async def test_update_query_complete_refuses_a_result_for_another_query() -> None:
    drafts = Drafts()
    outcome = await complete(edit_result({"name": "x"}, query_id=6), ctx(drafts))
    assert outcome.is_error
    assert drafts.saved == []


async def test_update_query_complete_refuses_an_empty_diff() -> None:
    drafts = Drafts()
    outcome = await complete(edit_result({}), ctx(drafts))
    assert outcome.is_error
    assert drafts.saved == []


async def test_update_query_complete_refuses_a_change_outside_the_allowed_fields() -> None:
    drafts = Drafts()
    outcome = await complete(edit_result({"userId": 3}), ctx(drafts))
    assert outcome.is_error
    assert drafts.saved == []


async def test_a_sql_only_edit_accepts_node_native_keys_on_saved_parameters() -> None:
    drafts = Drafts()
    saved = {
        "name": "day",
        "type": "enum",
        "multiValuesOptions": {"prefix": "'", "suffix": "'", "separator": ","},
        "parentQueryId": 7,
        "locals": [],
        "global": False,
        "urlPrefix": "p_",
    }
    snapshot = {**SNAPSHOT, "sql": "select {{ day }}", "parameters": [saved]}

    outcome = await complete(edit_result({"sql": "select {{ day }} limit 5"}, snapshot), ctx(drafts))

    assert not outcome.is_error, outcome.content
    assert drafts.saved[0][2]["snapshot"]["parameters"] == [saved]


async def test_model_written_parameters_stay_strictly_checked() -> None:
    drafts = Drafts()
    snapshot = {
        **SNAPSHOT,
        "sql": "select {{ day }}",
        "parameters": [{"name": "day", "type": "text", "parentQueryId": 7}],
    }
    changes = {"parameters": [{"name": "day", "type": "text", "multiValuesOptions": {}}]}
    outcome = await complete(edit_result(changes, snapshot), ctx(drafts))
    assert outcome.is_error
    assert drafts.saved == []


@pytest.mark.parametrize(
    ("schedule", "field"),
    [
        ({"interval": 86400, "time": "6:00"}, "schedule.time"),
        ({"interval": 86400, "time": "24:00"}, "schedule.time"),
        ({"interval": 86400, "time": "12:60"}, "schedule.time"),
        ({"interval": 86400, "time": "noon"}, "schedule.time"),
        ({"interval": 604800, "dayOfWeek": "monday"}, "schedule.dayOfWeek"),
        ({"interval": 604800, "dayOfWeek": "Mon"}, "schedule.dayOfWeek"),
        ({"interval": 3600, "until": "invalid"}, "schedule.until"),
        ({"interval": 3600, "until": "2026-02-30"}, "schedule.until"),
        ({"interval": 3600, "until": "2026-1-5"}, "schedule.until"),
        ({"interval": 3600, "until": "2026-10-24T10:00:00"}, "schedule.until"),
    ],
)
async def test_update_query_refuses_a_malformed_schedule_value(schedule: dict[str, Any], field: str) -> None:
    outcome = await prepare_call(update_call({"schedule": schedule}), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert field in outcome.content


async def test_update_query_accepts_well_formed_schedule_values() -> None:
    schedule = {"interval": 604800, "time": "23:59", "dayOfWeek": "Sunday", "until": "2026-12-31"}
    assert isinstance(await prepare_call(update_call({"schedule": schedule}), ctx()), ClientCall)


async def test_update_query_refuses_a_query_parameter_without_a_query_id() -> None:
    changes = {"sql": "select {{ p }}", "parameters": [{"name": "p", "type": "query"}]}
    outcome = await prepare_call(update_call(changes), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "queryId" in outcome.content
    with_id = {"sql": "select {{ p }}", "parameters": [{"name": "p", "type": "query", "queryId": 7}]}
    assert isinstance(await prepare_call(update_call(with_id), ctx()), ClientCall)


async def test_a_snapshot_query_parameter_without_a_query_id_is_not_checked() -> None:
    drafts = Drafts()
    snapshot = {**SNAPSHOT, "sql": "select {{ p }}", "parameters": [{"name": "p", "type": "query"}]}
    outcome = await complete(edit_result({"sql": "select {{ p }} limit 1"}, snapshot), ctx(drafts))
    assert not outcome.is_error, outcome.content


@pytest.mark.parametrize(("length", "accepted"), [(4096, True), (4097, False)])
async def test_update_query_description_limit_matches_node(length: int, accepted: bool) -> None:
    outcome = await prepare_call(update_call({"description": "x" * length}), ctx())
    assert isinstance(outcome, ClientCall) is accepted


@pytest.mark.parametrize(
    ("schedule", "field"),
    [
        ({"interval": 604800, "dayOfWeek": "Monday"}, "schedule.time"),
        ({"interval": 604800, "time": "06:00"}, "schedule.dayOfWeek"),
        ({"interval": 604800}, "schedule.time"),
        ({"interval": 604800, "time": "06:00", "dayOfWeek": None}, "schedule.dayOfWeek"),
    ],
)
async def test_update_query_refuses_a_weekly_schedule_the_dialog_could_not_make(
    schedule: dict[str, Any], field: str
) -> None:
    outcome = await prepare_call(update_call({"schedule": schedule}), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert field in outcome.content


@pytest.mark.parametrize("enum_options", [None, "", "  \n \n"])
async def test_update_query_refuses_an_enum_parameter_without_options(enum_options: str | None) -> None:
    definition: dict[str, Any] = {"name": "p", "type": "enum"}
    if enum_options is not None:
        definition["enumOptions"] = enum_options
    outcome = await prepare_call(update_call({"sql": "select {{ p }}", "parameters": [definition]}), ctx())
    assert isinstance(outcome, Immediate) and outcome.is_error
    assert "enumOptions" in outcome.content


async def test_update_query_accepts_an_enum_parameter_with_options() -> None:
    definition = {"name": "p", "type": "enum", "enumOptions": "a\nb"}
    outcome = await prepare_call(update_call({"sql": "select {{ p }}", "parameters": [definition]}), ctx())
    assert isinstance(outcome, ClientCall)


async def test_a_snapshot_enum_parameter_without_options_is_not_checked() -> None:
    drafts = Drafts()
    snapshot = {**SNAPSHOT, "sql": "select {{ p }}", "parameters": [{"name": "p", "type": "enum"}]}
    outcome = await complete(edit_result({"sql": "select {{ p }} limit 1"}, snapshot), ctx(drafts))
    assert not outcome.is_error, outcome.content
