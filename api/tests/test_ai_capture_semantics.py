"""The one paragraph that decides whether a generated number is right."""

from veodyn_api.services.ai_capture_semantics import CAPTURE_SEMANTICS
from veodyn_api.services.ai_sql import SYSTEM


def test_the_contract_states_what_a_row_is() -> None:
    # Each of these is a wrong answer someone would otherwise ship: a count of
    # rows read as a count of things, an average weighted by capture frequency,
    # and "the current state" taken as the whole table.
    assert "captured_at" in CAPTURE_SEMANTICS
    assert "count(*)" in CAPTURE_SEMANTICS
    assert "max(captured_at)" in CAPTURE_SEMANTICS


def test_the_sql_writer_is_given_the_contract() -> None:
    assert CAPTURE_SEMANTICS in SYSTEM
