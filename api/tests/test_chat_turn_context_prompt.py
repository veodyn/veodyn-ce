from typing import Any

from tests.catalog_stubs import SPEEDS
from veodyn_api.schemas.ai_chat_context import (
    ChatDataSourceEntryIn,
    ChatInstanceIn,
    ChatMapProviderIn,
    ChatReadyParamIn,
    ChatReadyQueryIn,
    ChatTurnIn,
)
from veodyn_api.services.chat.prompt import CHAT_RULES, HISTORY_OMITTED, chat_system
from veodyn_api.services.chat.turn_context import (
    EMPTY_CONTEXT,
    TurnContext,
    context_from,
    instance_block,
    inventory_block,
    ready_queries_block,
)

TWO_MAPS = [ChatMapProviderIn(id="maplibre", label="Map"), ChatMapProviderIn(id="google", label="Google traffic")]


def instance(maps: list[ChatMapProviderIn] | None = None, edition: str = "EE") -> ChatInstanceIn:
    return ChatInstanceIn.model_validate(
        {
            "name": "Meridian Transit",
            "edition": edition,
            "features": ["kpis", "reports"],
            "plugins": ["Route map"],
            "maps": [one.model_dump() for one in (maps if maps is not None else TWO_MAPS)],
        }
    )


def source(**overrides: Any) -> ChatDataSourceEntryIn:
    base: dict[str, Any] = {
        "id": 8,
        "name": "Traffic feed",
        "type": "traffic_feed",
        "syntax": "json",
        "viewOnly": False,
    }
    return ChatDataSourceEntryIn.model_validate({**base, **overrides})


def system_text(context: TurnContext) -> str:
    return "\n".join(block["text"] for block in chat_system((SPEEDS,), omitted_history=False, context=context))


def test_instance_block_names_edition_features_plugins_and_maps() -> None:
    text = instance_block(TurnContext(instance(), None, ()))
    assert text is not None
    assert "Meridian Transit" in text
    assert "EE" in text
    assert "kpis, reports" in text
    assert "Route map" in text
    assert "Google traffic" in text


def test_instance_block_is_absent_without_an_instance() -> None:
    assert instance_block(EMPTY_CONTEXT) is None


def test_inventory_block_lists_resource_names_not_params() -> None:
    entries = (
        source(resources=["incidents", "roadwork"]),
        source(id=15, name="Query Results", type="results", syntax="sql", noSchema=True),
        source(id=9, name="Archive", type="pg", syntax="sql", viewOnly=True),
    )
    text = inventory_block(TurnContext(None, entries, ()))
    assert text is not None
    assert "incidents, roadwork" in text
    assert "query_<id>" in text
    assert "show_visualization" in text
    assert "view-only" in text
    assert "returns" not in text


def test_inventory_block_says_when_resources_are_unknown() -> None:
    text = inventory_block(TurnContext(None, (source(resources=None),), ()))
    assert text is not None
    assert "describe_data_source" in text


def test_inventory_block_for_an_analyst_with_no_sources_says_so() -> None:
    text = inventory_block(TurnContext(None, (), ()))
    assert text is not None
    assert "no data sources" in text


def test_inventory_block_is_absent_when_the_inventory_is_unknown() -> None:
    assert inventory_block(TurnContext(None, None, ())) is None


def ready(values: list[str], truncated: bool, more: bool = False) -> ChatReadyQueryIn:
    return ChatReadyQueryIn(
        choice_id="route-live-map",
        query_id=137,
        name="Live route",
        data_source_id=19,
        visualization_id=165,
        params=[
            ChatReadyParamIn(
                name="route",
                type="query",
                default="R020",
                values=list(values),
                values_truncated=truncated,
                backing_query_id=91,
            )
        ],
        more=more,
    )


def test_ready_queries_block_lists_values_and_truncation() -> None:
    text = ready_queries_block(TurnContext(None, None, (ready(["R020", "R720"], True),)))
    assert text is not None
    assert "route-live-map" in text
    assert "137" in text and "165" in text
    assert "R020, R720" in text
    assert "more values" in text
    assert "91" in text
    assert "run_saved_query" in text


def test_ready_queries_block_with_no_stored_values_still_lists_the_query() -> None:
    text = ready_queries_block(TurnContext(None, None, (ready([], False),)))
    assert text is not None
    assert "137" in text
    assert "no stored values" in text


def test_ready_queries_block_notes_that_more_queries_exist() -> None:
    text = ready_queries_block(TurnContext(None, None, (ready(["R020"], False, more=True),)))
    assert text is not None
    assert "search_library" in text


def test_ready_queries_block_is_absent_without_queries() -> None:
    assert ready_queries_block(EMPTY_CONTEXT) is None


def test_chat_rules_no_longer_require_describe_before_any_query() -> None:
    assert "call `describe_data_source` for it in the same turn" not in CHAT_RULES
    assert "json" in CHAT_RULES
    assert "`resourceCall`" in CHAT_RULES
    assert "describe_data_source" in CHAT_RULES


def test_chat_rules_ask_which_map_when_several_providers() -> None:
    assert "which map" in system_text(TurnContext(instance(), None, ())).lower()


def test_chat_rules_skip_the_map_question_with_one_map_or_none() -> None:
    one = system_text(TurnContext(instance(TWO_MAPS[:1]), None, ()))
    none = system_text(TurnContext(instance([]), None, ()))
    assert "which map" not in one.lower()
    assert "which map" not in none.lower()
    assert "which map" not in system_text(EMPTY_CONTEXT).lower()


def test_no_context_prompt_matches_today() -> None:
    plain = chat_system((SPEEDS,), omitted_history=False)
    assert plain == chat_system((SPEEDS,), omitted_history=False, context=EMPTY_CONTEXT)
    assert plain[0]["text"] == CHAT_RULES
    assert "Meridian" not in "\n".join(block["text"] for block in plain)
    assert HISTORY_OMITTED not in "\n".join(block["text"] for block in plain)


def test_instance_block_comes_first_and_inventory_after_the_tables() -> None:
    context = TurnContext(instance(), (source(resources=["incidents"]),), (ready(["R020"], False),))
    blocks = chat_system((SPEEDS,), omitted_history=True, context=context)
    texts = [block["text"] for block in blocks]
    assert "Meridian Transit" in texts[0]
    tables = next(index for index, text in enumerate(texts) if text.startswith("Tables you may read"))
    inventory = next(index for index, text in enumerate(texts) if "Traffic feed" in text)
    queries = next(index for index, text in enumerate(texts) if "run_saved_query" in text and "137" in text)
    assert tables < inventory < queries < len(texts) - 1
    assert texts[-1] == HISTORY_OMITTED


def test_context_from_the_payload_carries_all_three_parts() -> None:
    payload = ChatTurnIn.model_validate(
        {
            "text": "hello",
            "instance": instance().model_dump(by_alias=True),
            "dataSources": [source().model_dump(by_alias=True)],
            "readyQueries": [ready(["R020"], False).model_dump(by_alias=True)],
        }
    )
    context = context_from(payload)
    assert context.instance is not None and context.instance.name == "Meridian Transit"
    assert context.data_sources is not None and context.data_sources[0].id == 8
    assert context.ready_queries[0].query_id == 137


def test_context_from_a_bare_payload_is_empty() -> None:
    assert context_from(ChatTurnIn(text="hello")) == EMPTY_CONTEXT
