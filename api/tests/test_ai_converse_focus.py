"""The table the conversation settled on, and the profile it earns.

Also the two things the route hands a turn beside the grounding: the warehouse
the profile is read from, and the lookup a KPI's value column is checked
against. Both are optional parameters with working defaults, so a turn that
stopped passing one goes on answering and silently loses the check.
"""

from typing import Any, cast

from tests.test_dataset_profile import dataset
from veodyn_api.schemas.ai_create import ConverseIn, ConverseMessageIn, ConverseOut, CreateKind
from veodyn_api.services.ai_converse import converse
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_converse_schema import converse_schema
from veodyn_api.services.ai_grounding import GroundedQuery
from veodyn_api.services.clickhouse import ClickHouseClient
from veodyn_api.services.dataset_profile_cache import clear_profile_cache
from veodyn_api.services.llm import LlmClient


class StubLlm:
    """Records the system block it was given and answers one interview turn."""

    def __init__(self, answer: dict[str, Any] | None = None) -> None:
        self.answer = answer or {"reply": "which stations?", "suggestedAnswers": [], "ready": False}
        self.systems: list[str] = []

    def conversation(
        self, *, system: str, messages: list[dict[str, str]], schema: dict[str, Any], tool_name: str
    ) -> dict[str, Any]:
        self.systems.append(system)
        return self.answer


class FakeWarehouse:
    """One row that answers both profile statements, so a resolved focus reaches
    the prompt carrying 317 and 4112 and an unresolved one reaches nothing."""

    def query(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return [
            {
                "rows": 1_200_000,
                "snapshots": 4_112,
                "first_at": "2026-04-02 00:00:00.000",
                "last_at": "2026-07-30 14:05:00.000",
                "latest_rows": 317,
                "n": 317,
                "bikes__nulls": 0,
                "bikes__distinct": 30,
                "bikes__low": "0",
                "bikes__high": "41",
            }
        ]


def turn(focus: str | None, kind: CreateKind = "query") -> ConverseIn:
    return ConverseIn(
        kind=kind,
        messages=[ConverseMessageIn(role="user", content="how busy are the docks?")],
        focus_table=focus,
    )


def grounding(kind: CreateKind = "query") -> Grounding:
    return Grounding(kind=kind, queries=(), datasets=(dataset([("bikes", "Nullable(Int64)")]),))


def ask(llm: StubLlm, payload: ConverseIn, ground: Grounding | None = None) -> ConverseOut:
    return converse(
        cast(LlmClient, llm),
        payload,
        ground or grounding(payload.kind),
        warehouse=cast(ClickHouseClient, FakeWarehouse()),
    )


def test_the_model_may_name_a_table_to_look_at() -> None:
    schema = converse_schema("query")

    assert "focusTable" in schema["properties"]
    # Not required: an interview turn that has not settled on one must be able to
    # answer without inventing a table to fill the field.
    assert "focusTable" not in schema["required"]


def test_a_focus_the_client_sends_back_is_profiled_into_the_next_prompt() -> None:
    clear_profile_cache()
    llm = StubLlm()

    ask(llm, turn("regional_bikes"))

    system = llm.systems[0]
    assert "317" in system
    assert "4112" in system.replace(",", "")


def test_a_focus_naming_nothing_real_is_ignored() -> None:
    clear_profile_cache()
    llm = StubLlm()

    # Resolved against the service's own catalog, so a value the client invented
    # matches nothing and costs the turn its profile. It can never name a table.
    ask(llm, turn("../../etc/passwd"))

    assert "317" not in llm.systems[0]


def test_a_forged_focus_that_looks_like_a_table_still_only_looks_one_up() -> None:
    """The one above cannot fail on its own: `../../etc/passwd` is refused by
    profile_dataset's identifier check as well, so an implementation that
    profiled whatever the client sent would still pass it. This name is
    identifier-shaped, so the catalog lookup is the ONLY thing between a forged
    value and a warehouse read.
    """
    clear_profile_cache()
    llm = StubLlm()

    ask(llm, turn("regional_bikes_secret"))

    assert "317" not in llm.systems[0]


def test_a_focus_the_model_invented_is_not_handed_back() -> None:
    """The incoming focus is checked against the catalog; the model's own answer
    has to be checked the same way. Otherwise an invented name goes out to the
    client, comes back next turn, matches nothing again, and STICKS: it displaces
    the real table through the `or payload.focus_table` fallback, so every later
    turn carries a name that does not exist and no profile at all.
    """
    clear_profile_cache()
    llm = StubLlm({"reply": "ok", "suggestedAnswers": [], "ready": False, "focusTable": "ghost"})

    answered = ask(llm, turn("regional_bikes"))

    assert answered.focus_table == "regional_bikes"


def test_the_answer_carries_the_focus_back_for_the_next_turn() -> None:
    clear_profile_cache()
    llm = StubLlm({"reply": "ok", "suggestedAnswers": [], "ready": False, "focusTable": "regional_bikes"})

    answered = ask(llm, turn(None))

    assert answered.focus_table == "regional_bikes"


def test_a_focus_already_set_survives_a_turn_that_does_not_restate_it() -> None:
    clear_profile_cache()
    llm = StubLlm()

    answered = ask(llm, turn("regional_bikes"))

    assert answered.focus_table == "regional_bikes"


def test_a_ready_turn_carries_the_focus_too() -> None:
    """The three answers leave converse by three different returns, and the two
    below are the ones a reader forgets: losing the focus there restarts the
    profile on the turn after a proposal the analyst is still editing."""
    clear_profile_cache()
    llm = StubLlm(
        {
            "reply": "Here it is.",
            "suggestedAnswers": [],
            "ready": True,
            "proposal": {"trigger": "last7", "snippet": "captured_at > now() - 7", "description": "A week"},
        }
    )

    answered = ask(llm, turn("regional_bikes", kind="snippet"))

    assert (answered.ready, answered.focus_table) == (True, "regional_bikes")


def test_a_degraded_turn_carries_the_focus_too() -> None:
    clear_profile_cache()
    llm = StubLlm(
        {
            "reply": "Here it is.",
            "suggestedAnswers": [],
            "ready": True,
            "proposal": {"datasetTable": "no_such_table", "intent": "count them"},
        }
    )

    answered = ask(llm, turn("regional_bikes"))

    assert (answered.ready, answered.focus_table) == (False, "regional_bikes")


def test_a_kpi_value_column_is_checked_against_what_the_query_returns() -> None:
    """The check itself is tested in test_ai_converse_parallel.py. This is the
    wiring: `columns_of` defaults to None, so a turn that stopped passing it
    would keep proposing KPIs and lose the check without anything failing."""
    clear_profile_cache()
    llm = StubLlm(
        {
            "reply": "Here it is.",
            "suggestedAnswers": [],
            "ready": True,
            "proposal": {"name": "k", "queryId": 7, "valueColumn": "ghost"},
        }
    )
    ground = Grounding(
        kind="kpi",
        queries=(GroundedQuery(id=7, name="Bike docks", description="", tags=[], updated_at="2026-07-30"),),
        datasets=(dataset([("bikes", "Nullable(Int64)")]),),
    )

    answered = converse(
        cast(LlmClient, llm),
        turn("regional_bikes", kind="kpi"),
        ground,
        warehouse=cast(ClickHouseClient, FakeWarehouse()),
        columns_of=lambda query_id: ("bucket", "bikes"),
    )

    assert answered.ready is False
    assert "ghost" in answered.reply
