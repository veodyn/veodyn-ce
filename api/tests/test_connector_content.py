from veodyn_api.services.connector_content import contract_violations, counted_length
from veodyn_api.services.connector_contract import ContentContract, Rendering

SMS = ContentContract(max_length=160, supports_markup=False, required_footer="Reply STOP to opt out.")
POST = ContentContract(max_length=280, supports_markup=False, url_counts_as_characters=23)
PAGE = ContentContract(supports_markup=True)

LONG_URL = "https://transit.example.org/alerts/2026/elevator-outage-market-street-northbound"


def test_a_contract_is_read_by_code_that_never_saw_the_connector_that_declared_it() -> None:
    contract = ContentContract(max_length=10)
    assert contract_violations(contract, Rendering(body="fits")) == ()
    assert len(contract_violations(contract, Rendering(body="far too long to fit at all"))) == 1


def test_every_url_counts_at_the_fixed_length_the_contract_declares() -> None:
    body = f"Elevator out at Market St. {LONG_URL}"
    rendering = Rendering(body=body, urls=(LONG_URL,))
    assert counted_length(POST, rendering) == len(body) - len(LONG_URL) + 23
    assert contract_violations(POST, rendering) == ()


def test_a_url_the_contract_does_not_count_is_measured_at_its_own_length() -> None:
    body = f"Elevator out at Market St. {LONG_URL}"
    rendering = Rendering(body=body, urls=(LONG_URL,))
    plain = ContentContract(max_length=280)
    assert counted_length(plain, rendering) == len(body)


def test_a_rendering_over_the_limit_names_both_numbers() -> None:
    rendering = Rendering(body="x" * 300)
    problems = contract_violations(POST, rendering)
    assert len(problems) == 1
    assert "300" in problems[0]
    assert "280" in problems[0]


def test_markup_is_refused_on_a_plain_text_channel_and_allowed_where_declared() -> None:
    marked_up = Rendering(body="The <b>12</b> line is on detour.")
    assert any("plain text" in problem for problem in contract_violations(POST, marked_up))
    assert contract_violations(PAGE, marked_up) == ()


def test_a_missing_required_footer_is_a_violation_and_a_trailing_one_is_not() -> None:
    without = Rendering(body="The 12 line is on detour.")
    assert any("Reply STOP" in problem for problem in contract_violations(SMS, without))
    with_footer = Rendering(body="The 12 line is on detour. Reply STOP to opt out.\n")
    assert contract_violations(SMS, with_footer) == ()


def test_every_violation_of_one_rendering_is_reported_at_once() -> None:
    rendering = Rendering(body="**Detour** " + "x" * 200)
    problems = contract_violations(SMS, rendering)
    assert len(problems) == 3
