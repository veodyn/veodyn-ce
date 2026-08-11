"""Widgets built at the same time, and a value column that has to exist.

Two unrelated-looking changes with one cause: a turn that writes queries. Writing
them is what made a ready turn slow enough to need a pool, and it is also what
made "which column holds the number" a claim nobody had checked, because a KPI
over a query it wrote is a KPI over columns that did not exist when the model
named one.
"""

import threading
from collections.abc import Callable
from typing import Any, cast

from tests.test_dataset_profile import dataset
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.ai_create import DashboardProposalOut, KpiProposalOut, ReportProposalOut
from veodyn_api.services.ai_converse_dashboard import Built
from veodyn_api.services.ai_converse_grounding import Grounding
from veodyn_api.services.ai_converse_outline import MAX_PARALLEL_WRITES
from veodyn_api.services.ai_converse_prompt import MAX_NEW_QUERIES_PER_DASHBOARD
from veodyn_api.services.ai_converse_proposals import build_proposal
from veodyn_api.services.ai_grounding import GroundedQuery, query_result_columns
from veodyn_api.services.llm import LlmClient
from veodyn_api.services.redash import RedashClient

GROUNDED_QUERY = GroundedQuery(id=7, name="Bikes", description="", tags=[], updated_at="")

BIKES = dataset([("bikes", "Nullable(Int64)")])
DASHBOARD = Grounding(kind="dashboard", queries=(), datasets=(BIKES,))
KPI = Grounding(kind="kpi", queries=(GROUNDED_QUERY,), datasets=(BIKES,))
REPORT = Grounding(kind="report", queries=(), datasets=(BIKES,))

API_KEY = "service-key"


class RecordingLlm:
    """Answers every generation, recording overlap, order and what it was asked.

    `delay_for` is what tells "assembled by row index" apart from "assembled in
    the order the generations finished": with it, the last row submitted is the
    first one to answer.
    """

    def __init__(self, delay_for: Callable[[str], float] | None = None, fail_on: str = "") -> None:
        self.lock = threading.Lock()
        self.live = 0
        self.peak = 0
        self.requests: list[str] = []
        self.finished: list[str] = []
        self._delay_for = delay_for
        self._fail_on = fail_on

    def structured(
        self, *, system: str, prompt: str, schema: dict[str, Any], tool_name: str, temperature: float = 0.2
    ) -> dict[str, Any]:
        # The generator puts the row's intent behind "Request: ", so this is how
        # a test names the widget a call belongs to.
        request = prompt.rsplit("Request: ", 1)[-1].strip()
        with self.lock:
            self.requests.append(request)
            self.live += 1
            self.peak = max(self.peak, self.live)
        try:
            threading.Event().wait(self._delay_for(request) if self._delay_for else 0.05)
            if self._fail_on and request == self._fail_on:
                raise RuntimeError("the provider melted mid-generation")
            with self.lock:
                self.finished.append(request)
            return {"sql": "SELECT 1 FROM regional_bikes", "rationale": request}
        finally:
            with self.lock:
                self.live -= 1


def widget(title: str, intent: str) -> dict[str, Any]:
    return {"title": title, "datasetTable": "regional_bikes", "intent": intent, "vizChoiceId": "chart-line"}


def propose(llm: Any, kind: str, raw: dict[str, Any], grounding: Grounding, **kwargs: Any) -> Built:
    """The proposal AND what could not go in it.

    build_proposal answers with both halves now, because a dashboard can come
    back partial: four widgets written and two refused by the cap is an answer,
    not a failed turn. The four kinds that resolve a single source still put
    their reason in `dropped` with no proposal beside it.
    """
    return build_proposal(cast(LlmClient, llm), cast(Any, kind), raw, grounding, None, **kwargs)


def test_four_new_widgets_are_written_at_the_same_time() -> None:
    llm = RecordingLlm()
    widgets = [widget(f"w{index}", f"i{index}") for index in range(MAX_PARALLEL_WRITES)]

    built = propose(llm, "dashboard", {"name": "d", "widgets": widgets}, DASHBOARD)

    assert built.dropped == ""
    assert [one.title for one in cast(DashboardProposalOut, built.proposal).widgets] == ["w0", "w1", "w2", "w3"]
    # Sequential would peak at 1. The cap is 4, so four widgets is one wait.
    assert llm.peak > 1


def test_widget_order_is_the_order_the_model_asked_for() -> None:
    """The generations are deliberately finished back to front, so a proposal
    assembled from whatever completed first would come out reversed."""
    llm = RecordingLlm(delay_for=lambda request: 0.02 * (4 - int(request[1:])))
    widgets = [widget(f"w{index}", f"i{index}") for index in range(4)]

    built = propose(llm, "dashboard", {"name": "d", "widgets": widgets}, DASHBOARD)

    assert llm.finished == ["i3", "i2", "i1", "i0"]
    assert [one.title for one in cast(DashboardProposalOut, built.proposal).widgets] == ["w0", "w1", "w2", "w3"]


def test_the_cap_falls_on_the_last_rows_and_not_on_whichever_thread_lost() -> None:
    """Which queries a turn writes must not depend on thread scheduling.

    The cap is spent in row order before anything is submitted. Counted inside
    the workers instead, two identical turns would write different widgets, and
    the one that was refused would be whichever generation happened to start
    fifth.
    """
    rows = [widget(f"w{index}", f"i{index}") for index in range(MAX_NEW_QUERIES_PER_DASHBOARD + 2)]
    llm = RecordingLlm()

    built = propose(llm, "dashboard", {"name": "too many", "widgets": rows}, DASHBOARD)

    assert str(MAX_NEW_QUERIES_PER_DASHBOARD) in built.dropped
    assert sorted(llm.requests) == ["i0", "i1", "i2", "i3"]
    # The four that fit are still offered. Refusing all six over the two that
    # did not fit is what this used to do.
    assert [one.title for one in cast(DashboardProposalOut, built.proposal).widgets] == ["w0", "w1", "w2", "w3"]


def test_a_write_that_raises_degrades_that_widget_and_not_the_turn() -> None:
    """One widget's generation blowing up used to be survivable because the ones
    before it had already been built. In a pool it would throw away three
    generations the analyst has already waited for."""
    llm = RecordingLlm(fail_on="i1")
    widgets = [widget("w0", "i0"), widget("w1", "i1")]

    built = propose(llm, "dashboard", {"name": "d", "widgets": widgets}, DASHBOARD)

    assert "w1" in built.dropped
    # The other write still ran and still answered, which is the whole point of
    # containing the failure to its own widget. It is now also OFFERED: the turn
    # keeps the generation the analyst waited for instead of discarding it
    # because a sibling failed.
    assert llm.finished == ["i0"]
    assert [one.title for one in cast(DashboardProposalOut, built.proposal).widgets] == ["w0"]


def test_report_sections_are_written_at_the_same_time_too() -> None:
    llm = RecordingLlm()
    sections = [{"title": f"s{index}", "datasetTable": "regional_bikes", "intent": f"i{index}"} for index in range(4)]

    built = propose(llm, "report", {"outline": {"goal": "g", "sections": sections}}, REPORT)

    assert built.dropped == ""
    outline = cast(ReportProposalOut, built.proposal).outline
    assert [one.title for one in outline.sections] == ["s0", "s1", "s2", "s3"]
    assert [one.id for one in outline.sections] == ["section-1", "section-2", "section-3", "section-4"]
    assert llm.peak > 1


def test_a_kpi_value_column_the_query_does_not_have_is_refused() -> None:
    class OneAnswer:
        def structured(self, **kwargs: Any) -> dict[str, Any]:
            raise AssertionError("no query should be written when one was named")

    built = propose(
        OneAnswer(),
        "kpi",
        {"name": "k", "queryId": 7, "valueColumn": "ghost"},
        KPI,
        columns_of=lambda query_id: ("bucket", "bikes"),
    )

    assert built.proposal is None
    assert "ghost" in built.dropped
    assert "bikes" in built.dropped


def test_a_kpi_value_column_the_query_does_have_is_kept() -> None:
    """The check must refuse the invented column and nothing else."""
    proposal = propose(
        object(),
        "kpi",
        {"name": "k", "queryId": 7, "valueColumn": "bikes"},
        KPI,
        columns_of=lambda query_id: ("bucket", "bikes"),
    )

    assert cast(KpiProposalOut, proposal.proposal).value_column == "bikes"


def test_the_check_is_skipped_when_the_columns_cannot_be_fetched() -> None:
    proposal = propose(
        object(),
        "kpi",
        {"name": "k", "queryId": 7, "valueColumn": "anything"},
        KPI,
        columns_of=lambda query_id: (),
    )

    # A Redash hiccup must not refuse a proposal that is probably fine.
    assert proposal.proposal is not None


def test_a_kpi_writing_its_own_query_has_no_columns_to_check_yet() -> None:
    """There is no result to read a column list off until the card creates the
    query, so the lookup must not be reached with an id that does not exist."""
    llm = RecordingLlm()

    def refuse(query_id: int) -> tuple[str, ...]:
        raise AssertionError(f"there is no query {query_id} to look up yet")

    proposal = propose(
        llm,
        "kpi",
        {"name": "k", "datasetTable": "regional_bikes", "intent": "i0", "valueColumn": "invented"},
        KPI,
        columns_of=refuse,
    )

    assert cast(KpiProposalOut, proposal.proposal).new_query is not None


class FakeRedash:
    """Just the two methods the column lookup calls."""

    def __init__(self, query: dict[str, Any], result: dict[str, Any] | ApiError) -> None:
        self._query = query
        self._result = result
        self.results_read = 0

    def get_query(self, query_id: int, *, api_key: str | None = None, cookie: str | None = None) -> dict[str, Any]:
        return self._query

    def get_query_result(
        self, result_id: int, *, api_key: str | None = None, cookie: str | None = None
    ) -> dict[str, Any]:
        self.results_read += 1
        if isinstance(self._result, ApiError):
            raise self._result
        return self._result


def result_with(columns: list[Any]) -> dict[str, Any]:
    return {"query_result": {"data": {"columns": columns, "rows": []}}}


def test_the_columns_of_a_query_come_off_its_last_cached_result() -> None:
    redash = FakeRedash(
        {"id": 7, "latest_query_data_id": 42},
        result_with([{"name": "bucket", "type": "datetime"}, {"name": "bikes", "type": "integer"}]),
    )

    assert query_result_columns(cast(RedashClient, redash), 7, API_KEY) == ("bucket", "bikes")


def test_a_query_that_has_never_run_reports_no_columns() -> None:
    """No cached result, so no second call: () is "we could not find out"."""
    redash = FakeRedash({"id": 7, "latest_query_data_id": None}, result_with([]))

    assert query_result_columns(cast(RedashClient, redash), 7, API_KEY) == ()
    assert redash.results_read == 0


def test_a_result_body_of_the_wrong_shape_reports_no_columns() -> None:
    """A SUCCESSFUL response whose nested shape is not what Redash documents.
    The client only checks that the top-level body is an object, and the parse
    happens after the except that catches transport failures, so a `data` that is
    a string raised AttributeError straight through proposal construction and
    failed the whole turn, which is the opposite of what this function is for.
    """
    for body in ({"query_result": "unexpected"}, {"query_result": {"data": "unexpected"}}, {}):
        redash = FakeRedash({"id": 7, "latest_query_data_id": 42}, body)

        assert query_result_columns(cast(RedashClient, redash), 7, API_KEY) == ()


def test_a_redash_failure_reports_no_columns_rather_than_raising() -> None:
    """The caller treats () as "unchecked", and a KPI proposal is not worth
    refusing over a Redash hiccup, let alone failing the turn over."""
    redash = FakeRedash(
        {"id": 7, "latest_query_data_id": 42},
        ApiError(ErrorId.QUERY_EXECUTION_FAILED, "result 42 is not readable", status_code=502),
    )

    assert query_result_columns(cast(RedashClient, redash), 7, API_KEY) == ()


def test_a_result_body_missing_its_column_names_reports_no_columns() -> None:
    redash = FakeRedash({"id": 7, "latest_query_data_id": 42}, result_with([{"type": "integer"}, "bikes"]))

    assert query_result_columns(cast(RedashClient, redash), 7, API_KEY) == ()
