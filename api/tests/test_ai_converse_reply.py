"""What the analyst actually reads back from an interview turn.

Split out of test_ai_converse.py, which is about the ids in a proposal. This
module is about the words beside them: the ready/proposal invariant that decides
whether there is a card at all, and the recovery when the model answers with a
proposal and no sentence to go with it.

That last one is the failure this file exists for. `reply` is a required tool
field and a forced tool call does not reliably deliver it, so the turn has to
survive its absence rather than spend the analyst's turn on a canned sentence.
"""

import logging
from collections.abc import Iterator
from typing import Any, cast

import pytest
from pydantic import ValidationError

from tests.converse_stubs import QUERIES, FakeChatLlm, answer, ask, turn
from veodyn_api.schemas.ai_create import ConverseOut
from veodyn_api.services.ai_converse import NO_REPLY_FALLBACK
from veodyn_api.services.ai_converse_grounding import Grounding, clear_grounding_cache


@pytest.fixture(autouse=True)
def _clear_grounding() -> Iterator[None]:
    clear_grounding_cache()
    yield
    clear_grounding_cache()


# --- the ready/proposal invariant -------------------------------------------


# Both build a model that is complete apart from the invariant, and both match
# the invariant's own message. Leaving a required field out instead would raise
# a ValidationError for that reason, and the test would go on passing with the
# validator deleted.
INVARIANT = "ready must be true if and only if a proposal is present"


def test_ready_without_a_proposal_cannot_be_represented() -> None:
    with pytest.raises(ValidationError, match=INVARIANT):
        ConverseOut(reply="Here is your dashboard.", suggested_answers=[], ready=True, proposal=None, focus_table=None)


def test_a_proposal_without_ready_cannot_be_represented() -> None:
    snippet = {"kind": "snippet", "trigger": "t", "snippet": "s", "description": "d"}
    with pytest.raises(ValidationError, match=INVARIANT):
        ConverseOut(
            reply="Still thinking.", suggested_answers=[], ready=False, proposal=cast(Any, snippet), focus_table=None
        )


def test_a_ready_answer_with_an_empty_proposal_degrades_instead_of_failing() -> None:
    """The model claiming ready and filling in nothing is a shape this service
    has to survive, because the alternative is a 500 in the middle of a chat."""
    llm = FakeChatLlm({"reply": "Done!", "suggestedAnswers": [], "ready": True})

    result = ask(llm, turn("snippet"), Grounding("snippet"))

    assert (result.ready, result.proposal) == (False, None)


def test_a_ready_snippet_needs_both_a_trigger_and_a_body() -> None:
    llm = FakeChatLlm(answer(trigger="last7", snippet="", description="A week"))

    result = ask(llm, turn("snippet"), Grounding("snippet"))

    assert (result.ready, result.proposal) == (False, None)


def test_a_not_ready_turn_keeps_the_models_reply_and_chips() -> None:
    asked = {"reply": "Which corridor?", "suggestedAnswers": ["Route 1", "Route 2", "", "Route 3"], "ready": False}
    llm = FakeChatLlm(asked)

    result = ask(llm, turn("snippet"), Grounding("snippet"))

    assert result.reply == "Which corridor?"
    assert result.suggested_answers == ["Route 1", "Route 2", "Route 3"]


def test_a_degraded_turn_drops_the_models_own_reply() -> None:
    """The model's reply for a ready turn says "here is your dashboard".
    Shipping it beside a dropped proposal tells the analyst something exists
    when nothing does."""
    llm = FakeChatLlm(answer(name="Transit", widgets=[{"queryId": 4242}]))

    result = ask(llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES))

    assert "Here it is." not in result.reply
    assert result.suggested_answers == []


# --- a turn that came back with no words ------------------------------------


def test_a_turn_with_no_reply_is_asked_again_before_the_fallback(caplog: pytest.LogCaptureFixture) -> None:
    """`reply` is a required tool field, and a forced tool call does not
    reliably deliver one. Observed on stage: a dashboard turn came back
    `known=['proposal', 'ready']`, so the model had answered with a proposal it
    flagged not-ready and no words at all. The turn is unusable either way, and
    the analyst spent one of twelve on it, so it is asked again rather than
    answered with this service's own sentence."""
    llm = FakeChatLlm({}, {})

    with caplog.at_level(logging.WARNING, logger="veodyn_api.services.ai_converse"):
        result = ask(llm, turn("report"), Grounding("report", queries=QUERIES))

    assert llm.calls == 2
    assert result.reply == NO_REPLY_FALLBACK
    assert result.suggested_answers == []
    # Both attempts are logged, so the retry's own success rate is readable
    # from the log rather than inferred.
    assert caplog.text.count("no reply text") == 2
    assert "report" in caplog.text


def test_the_second_ask_is_what_the_analyst_reads() -> None:
    """The recovery case, and the reason the retry is worth a call: the model
    answers properly the second time and the turn is not wasted."""
    llm = FakeChatLlm({"ready": False, "proposal": {}}, {"reply": "Which corridor?", "suggestedAnswers": []})

    result = ask(llm, turn("dashboard"), Grounding("dashboard", queries=QUERIES))

    assert result.reply == "Which corridor?"
    assert result.ready is False
    # The nudge names the field that was missing, and only on the second ask.
    assert "no `reply`" not in llm.systems[0]
    assert "no `reply`" in llm.systems[1]


def test_the_second_ask_cannot_be_answered_with_a_proposal_again() -> None:
    """Why asking the identical question twice was not enough. Observed on
    stage on 2026-07-29, a report turn: `known=['proposal', 'ready']` on attempt
    1 AND on attempt 2, so the analyst read the fallback anyway. The words go
    missing exactly when the model has a proposal to write, so the second ask
    takes the proposal off the table and asks for the words alone."""
    llm = FakeChatLlm({"ready": False, "proposal": {}}, {"reply": "Which corridor?", "suggestedAnswers": []})

    ask(llm, turn("report"), Grounding("report", queries=QUERIES))

    assert "proposal" in llm.schemas[0]["properties"]
    assert "proposal" not in llm.schemas[1]["properties"]
    assert llm.schemas[1]["required"] == ["reply", "suggestedAnswers"]


def test_the_proposal_from_the_first_ask_survives_the_missing_reply() -> None:
    """The turn the analyst actually lost. The model had the whole outline and
    only the words were missing, so re-asking must not throw the outline away:
    the second call supplies the sentence, the first call's proposal is built."""
    outline = {"goal": "How is transit doing?", "sections": [{"title": "Speeds", "intent": "x", "queryId": 11}]}
    llm = FakeChatLlm(
        {"ready": True, "proposal": {"outline": outline}},
        {"reply": "Here is the outline.", "suggestedAnswers": []},
    )

    result = ask(llm, turn("report"), Grounding("report", queries=QUERIES))

    assert result.reply == "Here is the outline."
    assert result.ready is True
    assert result.proposal is not None
    assert result.proposal.model_dump()["outline"]["sections"][0]["source_query_id"] == 11


def test_the_chips_come_from_whichever_ask_produced_the_words() -> None:
    """Chips are answers to the sentence beside them. Keeping the first ask's
    chips next to the second ask's question would offer replies to a question
    the analyst never read."""
    llm = FakeChatLlm(
        {"ready": False, "suggestedAnswers": ["Speeds", "Boardings"]},
        {"reply": "Which corridor?", "suggestedAnswers": ["Route 1"]},
    )

    result = ask(llm, turn("report"), Grounding("report", queries=QUERIES))

    assert result.suggested_answers == ["Route 1"]


def test_the_log_line_never_prints_a_key_the_model_invented(caplog: pytest.LogCaptureFixture) -> None:
    """A key name is model output too. The schema allows extra properties, so a
    model that answers with `{"here is the user's password": ...}` would put the
    transcript it derived that from into a pod log."""
    llm = FakeChatLlm({"smuggled-from-the-transcript": "x"}, {"smuggled-from-the-transcript": "x"})

    with caplog.at_level(logging.WARNING, logger="veodyn_api.services.ai_converse"):
        ask(llm, turn("report"), Grounding("report", queries=QUERIES))

    assert "smuggled" not in caplog.text
    # Counted instead, so the shape of the answer is still diagnosable.
    assert "unknown=1" in caplog.text


def test_a_turn_that_carries_a_reply_logs_nothing(caplog: pytest.LogCaptureFixture) -> None:
    """The sibling: the line marks a defect, so a healthy turn must not write
    one or the signal is noise."""
    llm = FakeChatLlm({"reply": "Which corridor?", "suggestedAnswers": [], "ready": False})

    with caplog.at_level(logging.WARNING, logger="veodyn_api.services.ai_converse"):
        ask(llm, turn("report"), Grounding("report", queries=QUERIES))

    assert caplog.records == []
