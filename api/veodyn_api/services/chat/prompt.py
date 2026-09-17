from typing import Any

from veodyn_api.schemas.catalog import DatasetOut
from veodyn_api.services.ai_capture_semantics import CAPTURE_SEMANTICS
from veodyn_api.services.ai_viz_choice import VIZ_RULES
from veodyn_api.services.llm import compact_json

MAX_COLUMNS = 60
MAX_ABOUT_CHARS = 300

CHAT_RULES = """You are the data assistant in a transportation data platform. You help an analyst answer questions \
about their data, and help them keep the queries worth keeping.

How you work:
- Run a query with `run_query` before you state any number about the data. Never guess a value.
- `run_query` runs in the analyst's browser under their own permissions. You get back the row count, statistics \
over the FULL result, and at most 50 sample rows. When `truncated` is true you saw a sample: reason from \
`rowCount` and the column statistics, never from how many sample rows you received.
- The analyst sees the full result as a chart beside your answer, so do not repeat the rows back as a table. \
Say what the result shows.
- If a query fails or is refused, read the reason, fix the SQL, and try again once. If it still fails, say what \
you could not do.
- Use `propose_query` only when the analyst wants to keep something, or when a result is clearly worth saving; \
then offer it, do not assume. To revise a query you proposed earlier, pass its `draftId`.
- You may only read the tables listed below. Copy a table's `table` value exactly.
- Ask one question at a time, and only when the answer changes what you would run.
- Keep answers short and plain."""

HISTORY_OMITTED = (
    "Earlier turns of this conversation were omitted to fit the context. If the analyst refers to something you "
    "cannot see, ask them to restate it."
)


def _dataset_row(dataset: DatasetOut) -> dict[str, Any]:
    row: dict[str, Any] = {
        "table": dataset.id,
        "name": dataset.name,
        "rows": dataset.row_count,
        "freshness": dataset.freshness.status,
        "columns": [
            {"name": column.name, "type": column.type, **({"about": column.description} if column.description else {})}
            for column in dataset.schema_[:MAX_COLUMNS]
        ],
    }
    if dataset.description:
        row["about"] = dataset.description[:MAX_ABOUT_CHARS]
    if dataset.coverage.start and dataset.coverage.end:
        row["covers"] = f"{dataset.coverage.start} to {dataset.coverage.end}"
    return row


def chat_system(datasets: tuple[DatasetOut, ...], *, omitted_history: bool) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = [{"type": "text", "text": f"{CHAT_RULES}\n\n{VIZ_RULES}"}]
    if datasets:
        catalog = compact_json([_dataset_row(one) for one in datasets])
        blocks.append({"type": "text", "text": f"Tables you may read: {catalog}\n\n{CAPTURE_SEMANTICS}"})
    else:
        blocks.append({"type": "text", "text": "No tables are available on this instance. Say so if asked."})
    if omitted_history:
        blocks.append({"type": "text", "text": HISTORY_OMITTED})
    return blocks
