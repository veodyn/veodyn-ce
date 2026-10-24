import pytest
from pydantic import ValidationError

from veodyn_api.schemas.ai_chat import ChatQueryResultIn, ChatSavedVisualizationResultIn
from veodyn_api.schemas.ai_chat_context import ChatTurnIn

FULL = {
    "text": "Show me route 720",
    "vizCatalog": [{"id": "table", "type": "TABLE", "label": "Table"}],
    "instance": {
        "name": "Meridian Transit",
        "edition": "EE",
        "features": ["kpis", "reports"],
        "plugins": ["Route map"],
        "maps": [{"id": "maplibre", "label": "Map"}, {"id": "google", "label": "Google traffic"}],
    },
    "dataSources": [
        {
            "id": 8,
            "name": "Traffic feed",
            "type": "traffic_feed",
            "syntax": "json",
            "viewOnly": False,
            "resources": ["incidents"],
        },
        {"id": 15, "name": "Query Results", "type": "results", "syntax": "sql", "viewOnly": False, "noSchema": True},
    ],
    "readyQueries": [
        {
            "choiceId": "route-live-map",
            "queryId": 137,
            "name": "Live route",
            "dataSourceId": 19,
            "visualizationId": 301,
            "params": [
                {
                    "name": "route",
                    "type": "query",
                    "default": "R020",
                    "values": ["R020", "R720"],
                    "valuesTruncated": True,
                    "backingQueryId": 136,
                }
            ],
            "more": False,
        }
    ],
}


def test_chat_turn_in_accepts_full_context() -> None:
    turn = ChatTurnIn.model_validate(FULL)
    assert turn.instance is not None and turn.instance.edition == "EE"
    assert [one.id for one in turn.instance.maps] == ["maplibre", "google"]
    assert turn.data_sources is not None and turn.data_sources[1].no_schema is True
    assert turn.data_sources[0].resources == ["incidents"]
    assert turn.ready_queries is not None
    param = turn.ready_queries[0].params[0]
    assert (param.backing_query_id, param.values_truncated, param.values) == (136, True, ["R020", "R720"])


def test_chat_turn_in_without_context_is_unchanged() -> None:
    turn = ChatTurnIn.model_validate({"text": "hi", "vizCatalog": FULL["vizCatalog"]})
    assert (turn.instance, turn.data_sources, turn.ready_queries) == (None, None, None)


def test_chat_turn_in_rejects_unknown_edition() -> None:
    with pytest.raises(ValidationError):
        ChatTurnIn.model_validate({"text": "hi", "instance": {**FULL["instance"], "edition": "PRO"}})


def test_query_result_carries_notice_and_saved_query_id() -> None:
    result = ChatQueryResultIn.model_validate(
        {"kind": "query_result", "ok": True, "notice": "needs a key", "savedQueryId": 137}
    )
    assert (result.notice, result.saved_query_id) == ("needs a key", 137)


def test_saved_visualization_result_carries_notice() -> None:
    result = ChatSavedVisualizationResultIn.model_validate({"kind": "saved_visualization", "ok": True, "notice": "x"})
    assert result.notice == "x"
