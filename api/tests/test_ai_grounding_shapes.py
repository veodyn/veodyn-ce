"""Which of a query's visualizations the AI reuses.

Both lookups here used to accept a CHART and nothing else, so a query whose
author had built a counter or a heatmap was reproduced as the TABLE Redash
creates for every query. That defeats the shape guide in ai_viz_choice.py from
the far end: teaching the model to ask for a heatmap is pointless if the report
block and the widget then point at a grid.
"""

from typing import Any, cast

from veodyn_api.services.ai_grounding import default_visualization, query_chart_config, query_visualizations
from veodyn_api.services.redash import RedashClient

API_KEY = "service-key"


class FakeRedash:
    """Just the one method these two functions call."""

    def __init__(self, visualizations: list[dict[str, Any]]) -> None:
        self._payload = {"id": 11, "visualizations": visualizations}
        self.calls = 0

    def get_query(self, query_id: int, *, api_key: str | None = None, cookie: str | None = None) -> dict[str, Any]:
        self.calls += 1
        return self._payload


def client(visualizations: list[dict[str, Any]]) -> tuple[RedashClient, FakeRedash]:
    fake = FakeRedash(visualizations)
    return cast(RedashClient, fake), fake


TABLE = {"id": 1, "type": "TABLE", "name": "Table", "options": {}}
COUNTER = {"id": 2, "type": "COUNTER", "name": "Stations", "options": {"counterColName": "stations"}}
HEATMAP = {"id": 3, "type": "HEATMAP", "name": "By hour", "options": {"columnMapping": {"hour": "x"}}}


def test_a_configured_shape_is_reused_even_when_it_is_not_a_chart() -> None:
    redash, _ = client([TABLE, HEATMAP])

    assert query_chart_config(redash, 11, API_KEY) == {
        "type": "HEATMAP",
        "name": "By hour",
        "options": {"columnMapping": {"hour": "x"}},
    }


def test_the_table_every_query_carries_is_not_worth_reusing() -> None:
    """None here is what makes the caller emit a table block, so this is the
    fallback path rather than a failure."""
    redash, _ = client([TABLE])

    assert query_chart_config(redash, 11, API_KEY) is None


def test_a_query_with_no_visualizations_at_all_reuses_nothing() -> None:
    redash, _ = client([])

    assert query_chart_config(redash, 11, API_KEY) is None


def test_options_that_are_not_an_object_do_not_travel() -> None:
    """Rebuilt as {} rather than relayed. The report route sanitizes per type on
    the way out, and handing it a string to sanitize is not its job."""
    redash, _ = client([{"id": 4, "type": "COUNTER", "name": "N", "options": "not an object"}])

    config = query_chart_config(redash, 11, API_KEY)

    assert config is not None
    assert config["options"] == {}


def test_a_widget_points_at_the_configured_shape_not_the_table() -> None:
    redash, _ = client([TABLE, COUNTER])

    assert _default_id(redash) == 2


def test_a_widget_falls_back_to_the_table_when_that_is_all_there_is() -> None:
    redash, _ = client([TABLE])

    assert _default_id(redash) == 1


def test_a_widget_for_a_query_that_has_gone_away_resolves_to_nothing() -> None:
    """Not a table id invented on the spot: the caller drops the widget instead
    of hanging one on the dashboard that points at nothing."""
    redash, _ = client([{"type": "TABLE", "name": "no id here"}])

    assert _default_id(redash) is None


def _default_id(redash: RedashClient) -> int | None:
    """The id a widget would point at: the lookup and the rule, as the caller
    runs them. Two functions now rather than one, because an edit turn needs the
    whole list to answer "does this query already have a bar chart"."""
    picked = default_visualization(query_visualizations(redash, 11, API_KEY))
    return picked.id if picked is not None else None
