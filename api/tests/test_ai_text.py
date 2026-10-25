from veodyn_api.services.ai_text import one_of, picked_id, text_of


def test_text_of_trims_and_clamps() -> None:
    assert text_of("  abc  ", 2) == "ab"
    assert text_of(None) == ""


def test_picked_id_refuses_a_bool() -> None:
    assert picked_id(True) is None
    assert picked_id(7) == 7
    assert picked_id("7") is None


def test_one_of_clamps_to_the_fallback() -> None:
    assert one_of("daily", ("hourly", "daily"), "hourly") == "daily"
    assert one_of("monthly", ("hourly", "daily"), "hourly") == "hourly"
