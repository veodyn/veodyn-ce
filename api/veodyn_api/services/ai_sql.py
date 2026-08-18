"""Natural language to SQL, over exactly one catalog dataset.

The model writes the SQL; this module decides whether it is allowed to leave. The
frontend puts generated SQL straight into the editor, where an analyst runs it
under their own Redash credential, so a generated `ALTER TABLE` would run as them.

The check fails closed: a statement this module cannot confidently read as a
single read-only SELECT over the requested table is refused, even at the cost of
refusing a good query.
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
    # dictGet and its family read a configured external source from a SCALAR
    # position, so there is no table reference for the allowlist below to catch.
    "|dict[a-z_]*"
)
# `replace` is absent because replace(haystack, needle, value) is an ordinary
# string function. The DDL forms are caught by CREATE or by must-start-with-SELECT.

FORBIDDEN_RE = re.compile(rf"\b({FORBIDDEN})\b", re.IGNORECASE)
# Where one FROM or JOIN clause's item list ends. Everything between the
# keyword and the next of these is the thing being read.
CLAUSE_END = (
    "where|prewhere|group|having|order|limit|offset|settings|union|format"
    "|on|using|from|join|left|right|inner|full|cross|any|all|asof|semi|anti|global|array"
)
FROM_CLAUSE_RE = re.compile(
    rf"\b(?:from|join)\b(?P<items>.*?)(?=\b(?:{CLAUSE_END})\b|$)",
    re.IGNORECASE | re.DOTALL,
)
# The first item of such a clause, in the three shapes that matter: a function
# call (a ClickHouse table function reading a network or a filesystem), a quoted
# identifier, and a bare name.
TABLE_ITEM_RE = re.compile(
    r"""
      (?P<call>[A-Za-z_][A-Za-z0-9_]*)\s*\(
    | `(?P<bt1>[^`]*)`(?:\s*\.\s*`(?P<bt2>[^`]*)`)?
    | "(?P<dq1>[^"]*)"(?:\s*\.\s*"(?P<dq2>[^"]*)")?
    | (?P<bare>[A-Za-z_][A-Za-z0-9_.]*)
    """,
    re.IGNORECASE | re.VERBOSE,
)
# A CTE introduces a name that is legitimately read later on.
CTE_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(", re.IGNORECASE)
# A name a FROM clause can carry unquoted, optionally qualified once. A dataset
# whose table falls outside this cannot be named by any statement validate_sql
# would accept, so asking the model for one is asking for a refusal.
QUERYABLE_TABLE_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")


class UngroundedSql(Exception):
    """Refused SQL, carrying the reason so the retry can quote it to the model."""


def _strip_noise(sql: str) -> str:
    """SQL with comments and string literals removed, for keyword checks only.

    One left-to-right pass, not two regex passes: comments and strings each
    contain the other's delimiter, so either ordering is exploitable. Stripping
    comments first lets `WHERE note = '--' UNION ALL SELECT b FROM secrets` be
    checked with the union invisible; the reverse lets an apostrophe in a comment
    swallow the code after it.
    """
    out: list[str] = []
    index, length = 0, len(sql)

    while index < length:
        char = sql[index]

        if char == "'":
            out.append("''")
            index += 1
            while index < length:
                if sql[index] == "\\" and index + 1 < length:
                    index += 2
                    continue
                if sql[index] == "'":
                    # A doubled quote is an escaped one, not the end.
                    if index + 1 < length and sql[index + 1] == "'":
                        index += 2
                        continue
                    index += 1
                    break
                index += 1
            continue

        if sql.startswith("--", index):
            while index < length and sql[index] != "\n":
                index += 1
            out.append(" ")
            continue

        if sql.startswith("/*", index):
            end = sql.find("*/", index + 2)
            index = length if end == -1 else end + 2
            out.append(" ")
            continue

        out.append(char)
        index += 1

    return "".join(out)


def _has_top_level_comma(items: str) -> bool:
    """Whether this FROM clause lists more than one thing.

    Depth-aware, so the commas inside `toStartOfInterval(t, INTERVAL 1 HOUR)` do
    not count. A comma at depth 0 is a comma join, and the reference scan below
    reads only the first item of a clause.
    """
    depth = 0
    for char in items:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif char == "," and depth == 0:
            return True
    return False


def _referenced_tables(noise_free: str) -> tuple[set[str], list[str]]:
    """Every table this statement reads, and any table-function calls in it.

    Returns names lowercased. A subquery yields no name here: the SELECT inside it
    has its own FROM, which this finds on its own pass.
    """
    names: set[str] = set()
    calls: list[str] = []

    for clause in FROM_CLAUSE_RE.finditer(noise_free):
        items = clause.group("items").lstrip()
        # Anchored rather than searched, or the `select` inside a subquery gets
        # read as this clause's table name.
        if items.startswith("("):
            continue
        item = TABLE_ITEM_RE.match(items)
        if item is None:
            continue
        if item.group("call"):
            calls.append(item.group("call").lower())
            continue
        parts = [
            part
            for part in (
                item.group("bt1"),
                item.group("bt2"),
                item.group("dq1"),
                item.group("dq2"),
            )
            if part
        ]
        name = ".".join(parts) if parts else (item.group("bare") or "")
        if name:
            names.add(name.lower().rstrip("."))

    return names, calls


def _table_names(table: str) -> set[str]:
    """The identifiers that count as naming the requested table.

    A dataset id can arrive qualified (`historical.regional_speeds`) and the model
    may write it either way, so both the qualified and the bare name are accepted.
    The DATABASE part is not: `historical` would admit every table in it.
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

    # Before the "starts with SELECT" check, so the reason names the real problem:
    # `DROP TABLE x` fails both, and "it did not start with SELECT" only invites
    # the model to prefix one.
    forbidden = FORBIDDEN_RE.search(noise_free)
    if forbidden:
        raise UngroundedSql(f"the statement used the forbidden keyword {forbidden.group(1).upper()}")

    head = noise_free.lstrip().lower()
    if not (head.startswith("select") or head.startswith("with")):
        raise UngroundedSql("the statement did not start with SELECT or WITH")

    # A comma join hides its second table in a position the reference scan below
    # reads as one item. Refused rather than split, because an explicit JOIN says
    # the same thing and is what the prompt asks for.
    for clause in FROM_CLAUSE_RE.finditer(noise_free):
        if _has_top_level_comma(clause.group("items")):
            raise UngroundedSql("the statement used a comma join; write an explicit JOIN instead")

    # Every table the statement reads must BE the dataset, not merely be mentioned
    # somewhere: a text search passes `FROM historical.other_table` on the
    # database half of the qualified name.
    allowed = _table_names(dataset.table) | {match.group(1).lower() for match in CTE_RE.finditer(noise_free)}
    referenced, table_calls = _referenced_tables(noise_free)

    # A table function reads whatever its arguments name: url() and s3() a network,
    # file() a filesystem, remote() another server. None is a table this dataset
    # could authorise, so the answer does not depend on which one it is.
    if table_calls:
        raise UngroundedSql(
            f"the statement read from {sorted(table_calls)[0]}(), but the only table it may read is {dataset.table}"
        )

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
        # owns the warehouse round trip and its failure: this module stays
        # generatable with no warehouse at all.
        parts.append(f"What this table currently holds: {profile_block}")
    parts.append(f"Request: {payload.prompt}")
    if payload.current_sql:
        # The iteration path ("edit with prompt").
        parts.append(f"Edit this existing query rather than starting over:\n{payload.current_sql}")
    if retry_reason:
        parts.append(f"Your previous answer was rejected because {retry_reason}. Answer again, correctly.")
    return "\n\n".join(parts)


def generate_sql(llm: LlmClient, payload: GenerateSqlIn, *, profile_block: str | None = None) -> GenerateSqlOut:
    """Generate, check, and retry once with the reason it was refused.

    One retry, not a loop: a second failure is a model that cannot satisfy the
    constraint for this prompt, and the manual path beats a third wait.
    """
    # Checked before the first call, not after the second refusal. A Redash data
    # source can expose a tree that browses like a schema and is really API
    # documentation ("1. feeds > params"), which no FROM clause can name, so both
    # attempts would be refused and the model blamed for the request's fault.
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
