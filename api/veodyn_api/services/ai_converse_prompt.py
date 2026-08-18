"""What the Create-with-AI interview says to the model.

The forced tool's SHAPE is ai_converse_schema.py: this file is what the model is
told, that one is what it must answer with.

Nothing here decides what is true. Every id the model names after reading these
prompts is looked up again in ai_converse_proposals.py.
"""

from typing import Any, TypeVar

from veodyn_api.schemas.ai_create import ConverseMessageIn, CreateKind, KpiCadence, KpiDirection
from veodyn_api.schemas.catalog import DatasetColumnOut, DatasetOut
from veodyn_api.services.ai_capture_semantics import CAPTURE_SEMANTICS
from veodyn_api.services.ai_data_sources import DATA_SOURCE_RULES
from veodyn_api.services.ai_grounding import DashboardWidget, GroundedQuery
from veodyn_api.services.ai_viz_choice import VIZ_RULES, choice_id_for
from veodyn_api.services.dataset_profile import DatasetProfile
from veodyn_api.services.llm import compact_json

# The kinds whose proposal carries a vizChoiceId the MODEL chooses, and so the
# kinds that are sent the shape guide. A KPI's shape is known from the kind
# (KPI_SOURCE_VIZ below) and a snippet has nothing to draw.
VIZ_KINDS: tuple[CreateKind, ...] = ("query", "dashboard", "report")

# The shape a KPI's written source query is drawn as: its scorecard reads the
# latest value and its sparkline the series behind it.
KPI_SOURCE_VIZ = "chart-line"

DIRECTIONS: tuple[KpiDirection, ...] = ("higher-is-better", "lower-is-better")
CADENCES: tuple[KpiCadence, ...] = ("hourly", "daily", "weekly")

# A wide capture table can carry hundreds of columns, and past the first few
# dozen they spend prompt budget the transcript needs.
MAX_GROUNDED_COLUMNS = 60

# A catalog description can run to paragraphs; the first few sentences say what
# the feed is and the rest spends the prompt budget the transcript needs.
MAX_DESCRIPTION_CHARS = 300

# How many queries one dashboard proposal may write. Each is its own generation
# plus the SQL safety check and its retry, inside the turn the analyst is waiting
# on, so eight of them is a minute of silence and a relay timeout.
MAX_NEW_QUERIES_PER_DASHBOARD = 4

# The same ceiling for a report, for the same reason. A KPI needs no cap: it
# reads one source.
MAX_NEW_QUERIES_PER_REPORT = 4

_Choice = TypeVar("_Choice", bound=str)

BASE_SYSTEM = """You interview an analyst who wants to create something in a transportation data platform.

You ask questions until you know enough, then propose one concrete object.

Rules:
- `reply` is the ONLY thing the analyst sees. Every answer carries one, including
  an answer that fills in proposal. An answer without it reaches them as a blank turn.
- Ask ONE question at a time, and only when the answer would change what you propose.
  One question means one question mark. Do not append a second as an aside, however
  short, and whatever it opens with: "Also", "And", "One more thing". If two things
  are unknown, ask the one whose answer changes the other, and ask the second next turn.
- Offer up to four short suggested answers the analyst can click. Phrase each as
  the analyst's own reply, not as an instruction to them. Every one must be a
  complete answer to the SAME question. Never write a suggestion that answers two
  questions at once, or one that answers a question you did not ask: an analyst who
  cares about the half you left out of the chips has to stop clicking and type.
- Set ready to true and fill in proposal ONLY when nothing important is still
  unknown. A turn that is not ready leaves proposal out entirely.
- You may name ONLY the ids listed below. Anything you invent is dropped by the
  service and the analyst is told the proposal failed, so guessing costs a turn.
- Never claim a result, a number or a trend. Nothing has run.
- Plain sentences. No markdown, no preamble."""

# What every kind that can write SQL is told about doing it, shared by the four
# rules below.
WRITES_SQL = (
    "You do NOT write the SQL yourself: name the table and describe the intent, and the service generates "
    "the statement and safety-checks it before the analyst sees it."
)

KIND_RULES: dict[CreateKind, str] = {
    "query": (
        "You are proposing a QUERY. Settle on one table from the catalog and on what the analyst wants to "
        f"measure, then propose it. {WRITES_SQL}"
    ),
    "dashboard": (
        "You are proposing a DASHBOARD. Three to eight widgets. Each widget is EITHER an existing query, "
        "named by its `queryId` from the list, OR a new query you specify with `datasetTable` (a table from "
        "the catalog, copied exactly) and `intent` (what the SQL must do, naming the columns and any "
        "window). Prefer an existing query when one already answers the widget; write a new one when none "
        f"does, rather than telling the analyst to go and make it. At most {MAX_NEW_QUERIES_PER_DASHBOARD} "
        "new queries in one dashboard: each one is generated and safety-checked before the analyst sees it, "
        f"so a dashboard of eight new queries is a long wait for them. {WRITES_SQL}"
    ),
    "kpi": (
        "You are proposing a KPI over ONE query. Either an existing query, named by its `queryId` from the "
        "list, OR a new query you specify with `datasetTable` (a table from the catalog, copied exactly) and "
        "`intent` (what the SQL must do, naming the column that holds the number and the time window). "
        "Prefer an existing query when one already produces the number; write one when none does, rather "
        "than telling the analyst to go and make it. Name the result column that holds the value, and for a "
        "query you are writing that is a column your own intent asks for. Ask for the target before "
        f"proposing one: a KPI with a guessed target is a KPI nobody trusts. {WRITES_SQL}"
    ),
    "report": (
        "You are proposing a REPORT OUTLINE: ordered sections. Each section is backed by an existing query, "
        "named by its `queryId` from the list, OR by a new query you specify with `datasetTable` (a table "
        "from the catalog, copied exactly) and `intent`, OR by nothing at all, which makes it a prose "
        "section. Write a query when the section needs a number nothing in the list produces, rather than "
        f"leaving it as prose or telling the analyst to go and make it. At most {MAX_NEW_QUERIES_PER_REPORT} "
        "new queries in one report, for the same reason a dashboard is capped: each is generated and checked "
        f"while the analyst waits. {WRITES_SQL}"
    ),
    "snippet": (
        "You are proposing a QUERY SNIPPET: a short reusable piece of SQL and the trigger word that expands "
        "it. Keep the trigger a single lowercase token. Use table and column names from the catalog below "
        "rather than inventing them: a snippet naming a column that does not exist is a snippet that fails "
        "the first time somebody expands it."
    ),
}

EDIT_RULES = (
    "You are EDITING a dashboard that already exists, not creating one. "
    "Return the widget list the dashboard should end up with, including the widgets it "
    "already has that the user has not asked you to change. Leaving one out means removing it, "
    "so do not drop a widget unless the user asked for it to go. "
    "Each widget below carries the shape it is drawn as today. To change one, repeat its "
    "`queryId` and set `vizChoiceId` to the shape it should become; leave `vizChoiceId` out to "
    "keep it as it is. Do not ask the user which widgets are tables: it is written below. "
    "Open by saying what the dashboard holds now and asking what should change."
)


def _editing_row(widget: DashboardWidget) -> dict[str, Any]:
    """One widget of the dashboard being edited, as the prompt carries it.

    `shownAs` is written in the same vocabulary as `vizChoiceId`, so the model
    reads a shape id and writes one back. Omitted when Redash reported no type,
    which is a widget nobody can say anything about rather than a table.
    """
    row: dict[str, Any] = {"queryId": widget.query_id, "query": widget.query_name}
    if widget.viz_type:
        # With the options, not the type alone: five of the shape ids are a CHART
        # told apart by `globalSeriesType`.
        row["shownAs"] = choice_id_for(widget.viz_type, widget.viz_options)
    return row


def _dataset_row(dataset: DatasetOut) -> dict[str, Any]:
    """One catalog entry as the prompt carries it.

    Coverage and freshness are carried because a model that cannot see them
    proposes a year-on-year comparison over three months of data, or a live
    dashboard over a feed that stopped writing.
    """
    row: dict[str, Any] = {
        "table": dataset.id,
        "name": dataset.name,
        "rows": dataset.row_count,
        "freshness": dataset.freshness.status,
        "columns": [_column_row(column) for column in dataset.schema_[:MAX_GROUNDED_COLUMNS]],
    }
    if dataset.description:
        row["about"] = dataset.description[:MAX_DESCRIPTION_CHARS]
    if dataset.coverage.start and dataset.coverage.end:
        row["covers"] = f"{dataset.coverage.start} to {dataset.coverage.end}"
    if dataset.tags:
        row["tags"] = dataset.tags
    return row


def _column_row(column: DatasetColumnOut) -> dict[str, Any]:
    row: dict[str, Any] = {"name": column.name, "type": column.type}
    if column.description:
        row["about"] = column.description
    return row


def system_prompt(
    kind: CreateKind,
    *,
    datasets: tuple[DatasetOut, ...] = (),
    queries: tuple[GroundedQuery, ...] = (),
    editing: tuple[DashboardWidget, ...] = (),
    profile: DatasetProfile | None = None,
) -> str:
    """The rules, plus the closed list of things that exist.

    The grounding goes in the SYSTEM block rather than into the transcript as a
    fake opening user message: it is not re-sent per turn, and a later user turn
    cannot be read as amending it.
    """
    parts = [BASE_SYSTEM, KIND_RULES[kind]]
    if kind in VIZ_KINDS:
        parts.append(VIZ_RULES)
    if editing:
        # An edit asks for the WHOLE widget list rather than a set of operations,
        # so the difference against what is here is arithmetic the browser does
        # against real widget ids.
        parts.append(EDIT_RULES)
        parts.append(
            "The dashboard you are editing currently holds these widgets: "
            f"{compact_json([_editing_row(one) for one in editing])}"
        )
    if datasets:
        parts.append(f"Tables you may use: {compact_json([_dataset_row(one) for one in datasets])}")
        # Beside the tables rather than at the top: it is a rule about the rows
        # in them, and it is useless to a kind that was given none.
        parts.append(CAPTURE_SEMANTICS)
    if profile is not None:
        # Arrives a turn late (the model names the table, the service profiles it,
        # the next turn carries it), so it is appended rather than merged into the
        # table list: the list is what exists, this is what one of them holds.
        parts.append(f"What {profile.table} currently holds: {compact_json(profile.as_prompt_block())}")
    if queries:
        parts.append(f"Queries you may use: {compact_json([one.as_prompt_row() for one in queries])}")
        # Beside the list, for the same reason CAPTURE_SEMANTICS sits beside the
        # tables: it is a rule about the rows in it.
        parts.append(DATA_SOURCE_RULES)
    return "\n\n".join(parts)


def transcript(messages: list[ConverseMessageIn]) -> list[dict[str, str]]:
    """The turns as the Messages API will accept them.

    It requires the list to start with a user turn and to alternate, and answers
    400 otherwise, which reaches the reader as "AI is broken". The composer is the
    half of this an attacker can rewrite, so leading assistant turns are dropped
    and same-role runs are joined here.
    """
    turns: list[dict[str, str]] = []
    for message in messages:
        if not turns and message.role != "user":
            continue
        if turns and turns[-1]["role"] == message.role:
            turns[-1]["content"] = f"{turns[-1]['content']}\n\n{message.content}"
            continue
        turns.append({"role": message.role, "content": message.content})
    return turns


def text_of(value: Any, limit: int = 500) -> str:
    return str(value or "").strip()[:limit]


def picked_id(value: Any) -> int | None:
    """A model-supplied id, or None if it is not one.

    `isinstance(True, int)` is True and `{1: query}.get(True)` finds query 1, so
    a tool result of `{"queryId": true}` resolves to whichever query has id 1.
    Every id path goes through here rather than testing `isinstance(x, int)`.
    """
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def one_of(value: Any, allowed: tuple[_Choice, ...], fallback: _Choice) -> _Choice:
    """A closed-list string, clamped rather than refused.

    Only for a cosmetic pick: a chart shape, a cadence, a direction. Clamping an
    ID would be inventing one, which is what this design exists to prevent.
    """
    picked = text_of(value, 64)
    return next((one for one in allowed if one == picked), fallback)
