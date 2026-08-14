"""What generated SQL is allowed to leave this service.

The frontend puts this SQL straight into the editor, where an analyst runs it
under their own Redash credential, so these are not style checks. Each one
describes a statement that must never reach that editor.
"""

from typing import cast

import pytest

from tests.ai_stubs import FakeLlm
from veodyn_api.errors import ApiError, ErrorId
from veodyn_api.schemas.ai import AiDatasetColumnIn, AiDatasetIn, GenerateSqlIn
from veodyn_api.services.ai_sql import UngroundedSql, generate_sql, validate_sql
from veodyn_api.services.llm import LlmClient

DATASET = AiDatasetIn(
    table="historical.regional_speeds",
    columns=[
        AiDatasetColumnIn(name="captured_at", type="datetime"),
        AiDatasetColumnIn(name="speed_mph", type="float"),
        AiDatasetColumnIn(name="created_at", type="datetime"),
    ],
)


def payload(prompt: str = "average speed by hour") -> GenerateSqlIn:
    return GenerateSqlIn(prompt=prompt, dataset=DATASET)


def refusal(sql: str) -> str:
    with pytest.raises(UngroundedSql) as refused:
        validate_sql(sql, DATASET)
    return str(refused.value)


def test_a_plain_select_over_the_requested_table_is_allowed() -> None:
    sql = "SELECT toStartOfHour(captured_at) AS hour, avg(speed_mph) FROM historical.regional_speeds GROUP BY hour"

    assert validate_sql(sql, DATASET) == sql


def test_a_leading_with_clause_is_allowed() -> None:
    sql = "WITH hourly AS (SELECT speed_mph FROM regional_speeds) SELECT avg(speed_mph) FROM hourly"

    assert validate_sql(sql, DATASET).startswith("WITH")


def test_a_trailing_semicolon_is_stripped_rather_than_refused() -> None:
    assert validate_sql("SELECT speed_mph FROM regional_speeds;", DATASET) == "SELECT speed_mph FROM regional_speeds"


def test_a_second_statement_is_refused() -> None:
    """The whole point of the single-statement rule: a benign SELECT followed by
    a DROP is what a prompt injection in a column description would produce."""
    assert "more than one statement" in refusal("SELECT speed_mph FROM regional_speeds; DROP TABLE regional_speeds")


@pytest.mark.parametrize(
    "sql",
    [
        "DROP TABLE historical.regional_speeds",
        "INSERT INTO historical.regional_speeds VALUES (1)",
        "ALTER TABLE historical.regional_speeds DELETE WHERE 1=1",
        "SELECT speed_mph FROM regional_speeds INTO OUTFILE '/tmp/x'",
    ],
)
def test_a_statement_that_changes_state_is_refused(sql: str) -> None:
    with pytest.raises(UngroundedSql):
        validate_sql(sql, DATASET)


def test_a_column_named_created_at_is_not_mistaken_for_the_create_keyword() -> None:
    """The keyword check is word-boundary matched. A substring match would refuse
    every query over a table with a created_at column, which is most of them."""
    sql = "SELECT created_at, speed_mph FROM regional_speeds WHERE created_at > now() - 3600"

    assert validate_sql(sql, DATASET) == sql


def test_the_word_drop_inside_a_comment_or_a_string_is_not_a_keyword() -> None:
    sql = "SELECT speed_mph FROM regional_speeds WHERE note != 'drop' -- drop the nulls"

    assert validate_sql(sql, DATASET) == sql


def test_a_sibling_table_in_the_same_database_is_refused() -> None:
    """The regression this check was rewritten for. Looking for the dataset name
    anywhere in the statement passed every table in `historical`, because the
    database part of the qualified name matched."""
    assert "regional_boardings" in refusal("SELECT rider_id FROM historical.regional_boardings")


def test_a_join_to_another_table_is_refused() -> None:
    """A join reads a table the analyst has no catalog metadata for, and the
    prompt bar is scoped to one dataset. Cross-dataset joins are PRO territory."""
    sql = "SELECT s.speed_mph FROM regional_speeds s JOIN regional_boardings b ON b.stop = s.stop"

    assert "regional_boardings" in refusal(sql)


def test_a_cte_the_query_defines_is_not_mistaken_for_another_table() -> None:
    sql = "WITH hourly AS (SELECT speed_mph FROM regional_speeds) SELECT avg(speed_mph) FROM hourly"

    assert validate_sql(sql, DATASET) == sql


def test_a_read_of_a_system_table_is_refused_as_a_keyword() -> None:
    """`system.users` never reaches the table check: SYSTEM is refused outright,
    which is the stricter of the two rules and the one that should win."""
    assert "SYSTEM" in refusal("SELECT name FROM system.users")


def test_the_bare_table_name_counts_as_naming_a_qualified_dataset() -> None:
    assert validate_sql("SELECT speed_mph FROM regional_speeds LIMIT 10", DATASET).endswith("LIMIT 10")


# The two structural holes. Each of these statements was confirmed against this
# validator before the fix and came back unchanged, so the model could read
# outside the requested dataset while the guard reported success. The keyword
# denylist could never have caught any of them: none is a state-changing verb.


@pytest.mark.parametrize(
    "opener",
    ["--", "/*"],
)
def test_a_comment_delimiter_inside_a_string_cannot_hide_a_union(opener: str) -> None:
    """The worst of the three, and the most general.

    _strip_noise used to remove comments before strings, so a delimiter inside a
    string literal erased everything after it. The validator checked
    `SELECT ... WHERE note = '` and never saw the union, while ClickHouse reads
    the literal as data and runs it. Any trailing statement could hide this way,
    not just a union.
    """
    sql = f"SELECT speed_mph FROM regional_speeds WHERE note = '{opener}' UNION ALL SELECT x FROM regional_boardings"

    assert "regional_boardings" in refusal(sql)


def test_a_string_holding_a_comment_delimiter_is_still_ordinary_data() -> None:
    """The other direction. Reversing the old order would have broken this."""
    sql = "SELECT speed_mph FROM regional_speeds WHERE note = '/* not a comment */ -- nor this'"

    assert validate_sql(sql, DATASET) == sql


def test_an_apostrophe_inside_a_comment_does_not_swallow_the_statement() -> None:
    sql = "SELECT speed_mph FROM regional_speeds -- don't drop the nulls\nLIMIT 10"

    assert validate_sql(sql, DATASET) == sql


def test_a_comma_join_to_a_second_table_is_refused() -> None:
    """The scan read the name after FROM and stopped, so everything past the
    comma was invisible and this passed with the second table unexamined."""
    sql = "SELECT speed_mph FROM regional_speeds, historical.regional_boardings"

    assert "comma join" in refusal(sql)


def test_a_comma_join_to_a_table_function_is_refused() -> None:
    """The same hole, reaching a network rather than a sibling table."""
    sql = "SELECT * FROM regional_speeds, url('http://elsewhere.invalid/x', CSV, 'c String')"

    assert "comma join" in refusal(sql)


def test_a_backtick_quoted_second_table_is_refused() -> None:
    """The scan needed an identifier character straight after JOIN, so a quoted
    name matched nothing at all and the statement read as single-table."""
    sql = "SELECT speed_mph FROM regional_speeds JOIN `historical`.`regional_boardings` ON 1"

    assert "regional_boardings" in refusal(sql)


def test_a_double_quoted_second_table_is_refused() -> None:
    sql = 'SELECT speed_mph FROM regional_speeds JOIN "regional_boardings" ON 1'

    assert "regional_boardings" in refusal(sql)


@pytest.mark.parametrize(
    "call",
    [
        "url('http://elsewhere.invalid/x', CSV, 'c String')",
        "file('/etc/passwd', CSV, 'c String')",
        "s3('https://elsewhere.invalid/b', CSV)",
    ],
)
def test_a_table_function_is_refused_by_name(call: str) -> None:
    """url() and s3() read a network, file() a filesystem. None is a table this
    dataset could authorise, so the reason says that rather than reporting a
    table name that does not exist."""
    assert "()" in refusal(f"SELECT * FROM {call}")


def test_dict_get_is_refused() -> None:
    """A dictionary read sits in a scalar position, so there is no table
    reference to check and only the keyword rule can see it."""
    assert "DICTGET" in refusal("SELECT dictGet('other', 'v', toUInt64(1)) FROM regional_speeds")


# The other half. A guard that refuses real analysis gets turned off, so these
# are as load-bearing as the refusals above.


def test_a_subquery_in_from_is_not_read_as_a_table_named_select() -> None:
    sql = "SELECT speed_mph FROM (SELECT speed_mph FROM regional_speeds WHERE speed_mph > 10) LIMIT 100"

    assert validate_sql(sql, DATASET) == sql


def test_commas_inside_a_function_call_are_not_a_comma_join() -> None:
    sql = (
        "SELECT toStartOfInterval(captured_at, INTERVAL 1 HOUR) AS bucket, avg(speed_mph) "
        "FROM regional_speeds GROUP BY bucket LIMIT 200"
    )

    assert validate_sql(sql, DATASET) == sql


def test_an_explicit_self_join_is_allowed() -> None:
    sql = "SELECT x.speed_mph FROM regional_speeds AS x JOIN regional_speeds AS y ON x.stop = y.stop LIMIT 10"

    assert validate_sql(sql, DATASET) == sql


def test_the_dataset_quoted_with_backticks_is_allowed() -> None:
    sql = "SELECT speed_mph FROM `historical`.`regional_speeds` LIMIT 10"

    assert validate_sql(sql, DATASET) == sql


def test_a_refused_answer_is_retried_once_with_the_reason() -> None:
    llm = FakeLlm(
        {"sql": "DROP TABLE regional_speeds", "rationale": "removes the table"},
        {"sql": "SELECT avg(speed_mph) FROM regional_speeds", "rationale": "averages the speed"},
    )

    result = generate_sql(cast(LlmClient, llm), payload())

    assert result.sql == "SELECT avg(speed_mph) FROM regional_speeds"
    assert llm.calls == 2
    # The retry has to say what was wrong, or it is just a second roll of the
    # dice on the same prompt.
    assert "DROP" in llm.prompts[1] and "rejected" in llm.prompts[1]


def test_two_refused_answers_fail_the_request_rather_than_looping() -> None:
    llm = FakeLlm(
        {"sql": "DROP TABLE regional_speeds", "rationale": ""},
        {"sql": "DELETE FROM regional_speeds", "rationale": ""},
    )

    with pytest.raises(ApiError) as failed:
        generate_sql(cast(LlmClient, llm), payload())

    assert failed.value.error_id == ErrorId.AI_UNGROUNDED
    assert llm.calls == 2


def test_the_iteration_path_sends_the_existing_query() -> None:
    llm = FakeLlm({"sql": "SELECT max(speed_mph) FROM regional_speeds", "rationale": "the max"})
    request = GenerateSqlIn(prompt="use the max instead", dataset=DATASET, current_sql="SELECT avg(speed_mph) FROM x")

    generate_sql(cast(LlmClient, llm), request)

    assert "SELECT avg(speed_mph) FROM x" in llm.prompts[0]


def test_a_missing_rationale_does_not_lose_the_sql() -> None:
    llm = FakeLlm({"sql": "SELECT speed_mph FROM regional_speeds", "rationale": "   "})

    assert generate_sql(cast(LlmClient, llm), payload()).rationale != ""


# --- a dataset that is not a table -----------------------------------------


def test_a_dataset_whose_table_is_not_a_table_is_refused_before_the_model_runs() -> None:
    """A Redash data source can expose a tree that browses like a schema and is
    really API documentation: "1. feeds > params", "__ Query Examples __". No
    statement can put that in a FROM clause, so the validator refuses whatever
    comes back, both attempts, and the caller waits through two generations to
    be told the model is at fault. It is not."""
    llm = FakeLlm({"sql": "SELECT 1", "rationale": "x"})

    with pytest.raises(ApiError) as refused:
        generate_sql(
            llm,
            GenerateSqlIn(
                prompt="show me the stations",
                dataset=AiDatasetIn(table="2. station_information > returns", columns=[]),
            ),
        )

    assert refused.value.error_id is ErrorId.AI_DATASET_NOT_QUERYABLE
    # A 4xx, because the caller named the thing that cannot work. A 502 would
    # say the provider is at fault, which is what the browser was being told.
    assert refused.value.status_code == 400
    # And the provider was never called: the point is the two wasted round trips.
    assert llm.calls == 0


def test_the_profile_reaches_the_prompt_when_there_is_one() -> None:
    llm = FakeLlm({"sql": "SELECT count() FROM regional_bikes", "rationale": "counts"})

    generate_sql(
        cast(LlmClient, llm),
        GenerateSqlIn(prompt="how many", dataset=AiDatasetIn(table="regional_bikes", columns=[])),
        profile_block='{"table":"regional_bikes","snapshots":4112}',
    )

    assert "4112" in llm.prompts[0]


def test_the_prompt_says_nothing_about_the_table_when_there_is_no_profile() -> None:
    """Asserting on the sentence the profile is introduced with, not on the word
    "Profile", which appears in neither branch and so cannot fail."""
    llm = FakeLlm({"sql": "SELECT count() FROM regional_bikes", "rationale": "counts"})

    generate_sql(
        cast(LlmClient, llm),
        GenerateSqlIn(prompt="how many", dataset=AiDatasetIn(table="regional_bikes", columns=[])),
    )

    assert "currently holds" not in llm.prompts[0]


def test_a_qualified_table_is_still_queryable() -> None:
    """The sibling. `historical.stations` is exactly the shape this app's own
    datasets carry, and a guard that refused it would switch generation off for
    everyone."""
    llm = FakeLlm({"sql": "SELECT lat FROM historical.stations", "rationale": "Stations."})

    result = generate_sql(
        llm,
        GenerateSqlIn(
            prompt="stations",
            dataset=AiDatasetIn(table="historical.stations", columns=[AiDatasetColumnIn(name="lat", type="Float64")]),
        ),
    )

    assert result.sql == "SELECT lat FROM historical.stations"
