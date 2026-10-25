import json
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from tests.dashboard_edit_stubs import (
    POSITION,
    RESOLVED_ADD,
    RESOLVED_DRAFT,
    RESOLVED_EDIT,
    RESOLVED_MOVE,
    RESOLVED_REMOVE,
    RESOLVED_TEXT,
    SNAPSHOT,
    STAMP,
    WIDGET_POSITION,
    complete,
    edit_result,
)
from tests.query_edit_stubs import call
from tests.test_chat_tools import Drafts, context
from veodyn_api.schemas.ai_chat_results import ChatToolResultIn
from veodyn_api.services.chat.tools import Immediate, prepare_call

pytestmark = pytest.mark.anyio

RESULT = TypeAdapter(ChatToolResultIn)


def test_the_widened_dashboard_result_validates_text_and_visualization_widgets() -> None:
    parsed = RESULT.validate_python(
        {
            "ok": True,
            "kind": "dashboard",
            "dashboard": {"id": 7, "name": "Ops", "tags": [], "version": 4, "canEdit": True},
            "widgets": [
                {
                    "widgetId": 30,
                    "kind": "visualization",
                    "title": "Trips",
                    "queryId": 5,
                    "queryName": "Trips",
                    "visualizationId": 9,
                    "visualizationType": "CHART",
                    "position": POSITION,
                    "parameterMappings": {
                        "day": {"type": "dashboard-map-to-existing", "mapTo": "day"},
                        "city": {"type": "static-value", "value": "LA"},
                    },
                    "updatedAt": STAMP,
                },
                {"widgetId": 31, "kind": "text", "title": "Notes", "text": "Notes\nmore", "position": WIDGET_POSITION},
            ],
            "widgetCount": 2,
            "textWidgets": 1,
        }
    )
    assert parsed.dashboard is not None and parsed.dashboard.version == 4
    assert parsed.widgets is not None and parsed.widgets[1].query_id is None
    assert parsed.widgets[0].parameter_mappings is not None


@pytest.mark.parametrize(
    "widget",
    [
        {"widgetId": 0, "kind": "text", "title": "t", "position": POSITION},
        {"widgetId": 1, "kind": "chart", "title": "t", "position": POSITION},
        {"widgetId": 1, "kind": "text", "title": "t" * 501, "position": POSITION},
        {"widgetId": 1, "kind": "text", "title": "t", "text": "x" * 4001, "position": POSITION},
        {"widgetId": 1, "kind": "text", "title": "t", "position": {**POSITION, "col": -1}},
        {"widgetId": 1, "kind": "text", "title": "t"},
        {
            "widgetId": 1,
            "kind": "visualization",
            "title": "t",
            "position": POSITION,
            "parameterMappings": {"a": {"type": "other"}},
        },
    ],
)
def test_the_widened_dashboard_result_refuses_malformed_widgets(widget: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        RESULT.validate_python({"ok": True, "kind": "dashboard", "widgets": [widget]})


async def test_propose_dashboard_accepts_text_items() -> None:
    drafts = Drafts()
    items = [
        {"kind": "text", "text": "  # Notes\nRead me  "},
        {"kind": "existing", "queryId": 1, "visualizationId": 2},
    ]
    outcome = await prepare_call(call("propose_dashboard", name="Ops", items=items), context(drafts))
    assert isinstance(outcome, Immediate) and not outcome.is_error, outcome
    assert drafts.saved[0][2]["items"][0] == {"kind": "text", "text": "# Notes\nRead me"}


@pytest.mark.parametrize("text", [None, "", "   ", 5, "x" * 4001])
async def test_propose_dashboard_refuses_bad_text_items(text: Any) -> None:
    drafts = Drafts()
    outcome = await prepare_call(
        call("propose_dashboard", name="Ops", items=[{"kind": "text", "text": text}]), context(drafts)
    )
    assert isinstance(outcome, Immediate) and outcome.is_error and "text" in outcome.content
    assert drafts.saved == []


async def test_the_completer_saves_a_dashboard_edit_draft() -> None:
    drafts = Drafts()
    operations = [RESOLVED_ADD, RESOLVED_DRAFT, RESOLVED_TEXT, RESOLVED_EDIT, RESOLVED_REMOVE]
    outcome = await complete(edit_result(operations, name="Ops 2", tags=["x"]), drafts)
    assert not outcome.is_error, outcome
    [(kind, draft_id, payload)] = drafts.saved
    assert (kind, draft_id) == ("dashboard_edit", None)
    assert payload["dashboardId"] == 7
    assert payload["name"] == "Ops 2" and payload["tags"] == ["x"]
    assert payload["snapshot"]["widgets"][0]["widgetId"] == 31
    assert payload["operations"] == operations
    assert json.loads(outcome.content) == {"draftId": "draft-1", "version": 1, "operations": 5, "removes": 1}
    assert outcome.draft == {"draftId": "draft-1", "version": 1, "kind": "dashboard_edit", "payload": payload}


async def test_the_completer_omits_name_and_tags_when_unchanged() -> None:
    drafts = Drafts()
    outcome = await complete(edit_result([RESOLVED_MOVE]), drafts)
    assert not outcome.is_error
    assert "name" not in drafts.saved[0][2] and "tags" not in drafts.saved[0][2]


async def test_the_completer_keeps_an_empty_tag_list() -> None:
    drafts = Drafts()
    outcome = await complete(edit_result([], tags=[]), drafts)
    assert not outcome.is_error
    assert drafts.saved[0][2]["tags"] == []


async def test_the_completer_refuses_problems_without_saving() -> None:
    drafts = Drafts()
    outcome = await complete(edit_result([RESOLVED_MOVE], problems=["widget 99 is not on this dashboard"]), drafts)
    assert outcome.is_error and "widget 99" in outcome.content
    assert drafts.saved == []


async def test_the_completer_refuses_a_failed_read_a_wrong_dashboard_and_nothing_to_do() -> None:
    drafts = Drafts()
    failed = await complete(
        edit_result([], ok=False, error="You cannot edit this dashboard."),
        drafts,
    )
    assert failed.is_error and "cannot edit" in failed.content
    other = await complete(edit_result([RESOLVED_MOVE], dashboardId=8), drafts)
    assert other.is_error and "dashboard 8" in other.content
    empty = await complete(edit_result([]), drafts)
    assert empty.is_error
    assert drafts.saved == []


@pytest.mark.parametrize(
    "operation",
    [
        {**RESOLVED_ADD, "position": {**POSITION, "col": 4}},
        {key: value for key, value in RESOLVED_ADD.items() if key != "title"},
        {key: value for key, value in RESOLVED_EDIT.items() if key != "updatedAt"},
        {key: value for key, value in RESOLVED_REMOVE.items() if key != "updatedAt"},
        {"op": "addText", "text": "Hi"},
        {**RESOLVED_MOVE, "widgetId": 0},
        {"op": "add", "position": POSITION, "title": "x"},
    ],
)
def test_the_result_refuses_an_unresolved_operation(operation: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        RESULT.validate_python(edit_result([operation]))


def test_the_result_caps_operations_and_problems() -> None:
    with pytest.raises(ValidationError):
        RESULT.validate_python(edit_result([RESOLVED_TEXT] * 31))
    with pytest.raises(ValidationError):
        RESULT.validate_python(edit_result([RESOLVED_TEXT], problems=["p"] * 21))


async def test_an_explicit_null_static_value_survives_into_the_draft() -> None:
    drafts = Drafts()
    mappings = {"city": {"type": "static-value", "value": None}}
    outcome = await complete(edit_result([{**RESOLVED_ADD, "parameterMappings": mappings}]), drafts)
    assert not outcome.is_error
    assert drafts.saved[0][2]["operations"][0]["parameterMappings"] == mappings


async def test_a_rename_on_a_dashboard_with_more_than_fifty_widgets_is_saved() -> None:
    drafts = Drafts()
    widgets = [
        {"widgetId": index, "kind": "text", "title": "t", "position": WIDGET_POSITION, "updatedAt": STAMP}
        for index in range(1, 52)
    ]
    outcome = await complete(edit_result([], name="Ops 2", snapshot={**SNAPSHOT, "widgets": widgets}), drafts)
    assert not outcome.is_error
    assert len(drafts.saved[0][2]["snapshot"]["widgets"]) == 51


def test_a_resolved_draft_add_has_a_draft_id_title_and_position_and_no_query_ids() -> None:
    operation = {"op": "add", "queryDraftId": "d-1", "title": "Speeds", "position": POSITION}
    parsed = RESULT.validate_python(edit_result([operation]))
    assert parsed.operations[0].query_id is None
    with pytest.raises(ValidationError):
        RESULT.validate_python(edit_result([{**operation, "queryId": 5, "visualizationId": 9}]))
