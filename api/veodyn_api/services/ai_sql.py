"""Natural language to SQL, over exactly one catalog dataset.

The model writes the SQL; this module decides whether the SQL is allowed to
leave. That split matters: the frontend puts generated SQL straight into the
editor, where an analyst runs it against the warehouse under their own Redash
credential. A generated `ALTER TABLE` would run as them.

So the check here is not linting. It is the boundary between "a model suggested
this" and "a person is one click from executing it", and it fails closed: a
statement this module cannot confidently read as a single read-only SELECT over
the requested table is refused, even at the cost of refusing a good query.
"""

import re

from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.ai import AiDatasetIn, GenerateSqlIn, GenerateSqlOut
from veodyn_api.services.ai_capture_semantics import CAPTURE_SEMANTICS
from veodyn_api.services.llm import LlmClient, compact_json

SQL_SCHEMA = {
    "type": "object",
    "properties": {
        "sql": {"type": "string", "description": "One read-only ClickHouse SELECT statement, no trailing semicolon."},
        "rationale": {
            "type": "string",
            "description": "Two or three sentences: what the query does and which columns it reads. No markdown.",
        },
    },
    "required": ["sql", "rationale"],
}

SYSTEM = f"""You write ClickHouse SQL for a transportation data platform.

Rules you must follow:
- Answer with ONE statement. It must be a SELECT (a leading WITH clause is fine).
- Read only the table you are given. Never name another table, database or system table.
- Use only the columns you are given. Never invent a column.
- Never write INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, ATTACH or
  SYSTEM, or any other statement that changes state.
- Always bound the result: add a LIMIT unless the query already aggregates to a handful of rows.
- Prefer readable SQL over clever SQL. An analyst reads and edits this.

The rationale explains the query to the analyst who will run it. State what it
measures and which columns it reads. Never claim a result: you have not run it.

{CAPTURE_SEMANTICS}"""

# Word-boundary matched, so `created_at` and `update_time` are columns, not
# keywords. Checked against SQL with comments and string literals removed,
# because `-- drop the nulls` is a comment and `'DROP'` is a value.
FORBIDDEN = (
    "insert|update|delete|drop|alter|create|truncate|grant|revoke|attach|detach"
    "|optimize|rename|system|kill|exchange|use|set|outfile|infile"
)
# `replace` is deliberately absent: replace(haystack, needle, value) is an
# ordinary ClickHouse string function, and refusing it would refuse a large
# share of legitimate queries. The DDL forms (REPLACE TABLE, CREATE OR REPLACE)
# are caught by CREATE or by the must-start-with-SELECT rule instead.

FORBIDDEN_RE = re.compile(rf"\b({FORBIDDEN})\b", re.IGNORECASE)
STRING_RE = re.compile(r"'(?:[^'\\]|\\.)*'")
BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
LINE_COMMENT_RE = re.compile(r"--[^\n]*")
# What a table reference looks like: the name after FROM or JOIN, optionally
# qualified. A subquery (`FROM (SELECT ...`) does not match, and does not need
# to: the SELECT inside it has its own FROM.
TABLE_REF_RE = re.compile(r"\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_.]*)", re.IGNORECASE)
# A CTE introduces a name that is legitimately read later on.
CTE_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(", re.IGNORECASE)
# A name a FROM clause can carry unquoted, optionally qualified once. It is the
# same shape TABLE_REF_RE matches, which is what makes it the right test: a
# dataset whose table falls outside it cannot be named by any statement this
# validator would accept, so asking the model for one is asking for a refusal.
QUERYABLE_TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")


class UngroundedSql(Exception):
    """Refused SQL, carrying the reason so the retry can quote it to the model."""


def _strip_noise(sql: str) -> str:
    """SQL with comments and string literals removed, for keyword checks only."""
    without_comments = LINE_COMMENT_RE.sub(" ", BLOCK_COMMENT_RE.sub(" ", sql))
    return STRING_RE.sub("''", without_comments)


def _table_names(table: str) -> set[str]:
    """The identifiers that count as naming the requested table.

    A dataset id can arrive qualified (`historical.regional_speeds`), and the model
    may write it either way, so the qualified name and the table name are both
    accepted. The DATABASE part is not: accepting `historical` would have let
    every other table in the same database through.
    """
    parts = [part for part in table.split(".") if part]
    return {table.lower(), parts[-1].lower()} if parts else {table.lower()}


def validate_sql(sql: str, dataset: AiDatasetIn) -> str:
    """The generated SQL, or UngroundedSql with a reason the model can act on."""
    stripped = sql.strip().rstrip(";").strip()
    if not stripped:
        raise UngroundedSql("the statement was empty")

    noise_free = _strip_noise(stripped)
    if ";" in noise_free:
        raise UngroundedSql("the answer contained more than one statement")

    # The keyword check runs before the "starts with SELECT" one so the reason
    # names the actual problem. `DROP TABLE x` fails both, and "you used DROP"
    # is a reason the retry can act on where "it did not start with SELECT" only
    # invites the model to prefix a SELECT.
    forbidden = FORBIDDEN_RE.search(noise_free)
    if forbidden:
        raise UngroundedSql(f"the statement used the forbidden keyword {forbidden.group(1).upper()}")

    head = noise_free.lstrip().lower()
    if not (head.startswith("select") or head.startswith("with")):
        raise UngroundedSql("the statement did not start with SELECT or WITH")

    # Every table the statement reads must BE the dataset, rather than the
    # statement merely mentioning it somewhere. Checking for the name anywhere
    # in the text passed `SELECT ... FROM historical.other_table`, because the
    # database part of the qualified name matched.
    allowed = _table_names(dataset.table) | {match.group(1).lower() for match in CTE_RE.finditer(noise_free)}
    referenced = {match.group(1).lower().rstrip(".") for match in TABLE_REF_RE.finditer(noise_free)}
    if not referenced:
        raise UngroundedSql(f"the statement did not read the requested table {dataset.table}")
    unexpected = referenced - allowed
    if unexpected:
        raise UngroundedSql(
            f"the statement read {sorted(unexpected)[0]}, but the only table it may read is {dataset.table}"
        )

    return stripped


def _prompt(payload: GenerateSqlIn, retry_reason: str | None, profile_block: str | None = None) -> str:
    columns = [
        {"name": column.name, "type": column.type, **({"about": column.description} if column.description else {})}
        for column in payload.dataset.columns
    ]
    parts = [
        f"Table: {payload.dataset.table}",
        f"Columns: {compact_json(columns)}",
    ]
    if profile_block:
        # An already-rendered string rather than a profile object, so the caller
        # owns both the warehouse round trip and its failure. A profile is a
        # nicety; a SQL request that 500s because the profile query timed out is
        # not, and this module must stay generatable with no warehouse at all.
        parts.append(f"What this table currently holds: {profile_block}")
    parts.append(f"Request: {payload.prompt}")
    if payload.current_sql:
        # The iteration path ("edit with prompt"): the request is a change to
        # this query, not a new one.
        parts.append(f"Edit this existing query rather than starting over:\n{payload.current_sql}")
    if retry_reason:
        parts.append(f"Your previous answer was rejected because {retry_reason}. Answer again, correctly.")
    return "\n\n".join(parts)


def generate_sql(llm: LlmClient, payload: GenerateSqlIn, *, profile_block: str | None = None) -> GenerateSqlOut:
    """Generate, check, and retry once with the reason it was refused.

    One retry, not a loop: the second failure is a model that cannot satisfy the
    constraint for this prompt, and the frontend's manual path (write the SQL
    yourself) is a better answer than a third wait.
    """
    # Checked before the first call, not after the second refusal. A Redash
    # data source can expose a tree that browses like a schema and is really API
    # documentation ("1. feeds > params", "__ Query Examples __"). No statement
    # can put that in a FROM clause, so the validator below refuses whatever
    # comes back, both attempts, and the caller waits through two generations to
    # be told the model is at fault. It is not: the request named something that
    # is not a table.
    if not QUERYABLE_TABLE_RE.match(payload.dataset.table.strip()):
        raise ApiError(
            ErrorId.AI_DATASET_NOT_QUERYABLE,
            f"{payload.dataset.table!r} is not a table a SQL statement can read",
            status_code=400,
        )

    reason: str | None = None
    for _ in range(2):
        answer = llm.structured(
            system=SYSTEM,
            prompt=_prompt(payload, reason, profile_block),
            schema=SQL_SCHEMA,
            tool_name="write_sql",
        )
        try:
            sql = validate_sql(str(answer.get("sql", "")), payload.dataset)
        except UngroundedSql as refused:
            reason = str(refused)
            continue
        rationale = str(answer.get("rationale", "")).strip()
        return GenerateSqlOut(sql=sql, rationale=rationale or "Generated from the dataset schema.")

    raise ApiError(ErrorId.AI_UNGROUNDED, f"the model did not produce usable SQL: {reason}", status_code=502)
