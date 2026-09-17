from tests.converse_stubs import FakeChatLlm, answer, ask, turn
from veodyn_api.schemas.ai_create import MessageProposalOut
from veodyn_api.services.ai_converse_grounding import Grounding

FORBIDS = "Never state a route number, a stop name, a stop id, a time, a date or a cause."

WORDING = {
    "title": "Elevator out of service",
    "header": "Elevator out of service at this station",
    "description": "The elevator is out of service. Staff can direct you to the nearest accessible entrance.",
}


def test_a_message_turn_reaches_the_model_forbidden_from_naming_a_route_a_time_or_a_cause() -> None:
    llm = FakeChatLlm(answer(**WORDING))

    result = ask(llm, turn("message", "riders need to know the elevator is out"), Grounding("message"))

    assert llm.calls == 1
    assert FORBIDS in llm.systems[0]
    assert isinstance(result.proposal, MessageProposalOut)
    assert result.ready is True
    assert (result.proposal.title, result.proposal.header, result.proposal.description) == (
        WORDING["title"],
        WORDING["header"],
        WORDING["description"],
    )


def test_a_message_proposal_carries_the_wording_and_nothing_the_author_picks() -> None:
    llm = FakeChatLlm(
        answer(
            **WORDING,
            entities=[{"routeId": "12", "stopId": "4021"}],
            severity="SEVERE",
            cause="MAINTENANCE",
            effect="ACCESSIBILITY_ISSUE",
            activePeriods=[{"start": 1787000000, "end": 1787600000}],
        )
    )

    result = ask(llm, turn("message"), Grounding("message"))

    assert isinstance(result.proposal, MessageProposalOut)
    assert result.proposal.model_dump() == {"kind": "message", **WORDING}
