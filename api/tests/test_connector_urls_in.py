from veodyn_api.services.connector_content import urls_in

A_LINK = "https://transit.example.org/alerts/2026/elevator-outage"
A_LINK_WITH_A_PORT = "http://transit.example.org:8080/alerts/1"


def test_finds_every_link_a_body_carries_in_the_order_it_carries_them() -> None:
    body = f"Elevator out. {A_LINK} and again {A_LINK_WITH_A_PORT}"

    assert urls_in(body) == (A_LINK, A_LINK_WITH_A_PORT)


def test_counts_a_repeated_link_once_per_occurrence() -> None:
    assert urls_in(f"{A_LINK} {A_LINK}") == (A_LINK, A_LINK)


def test_a_scheme_followed_by_a_long_token_with_no_host_is_not_a_link() -> None:
    assert urls_in("https://" + "a" * 300) == ()


def test_a_host_with_no_dot_in_it_is_not_a_link() -> None:
    assert urls_in("https://localhost:8080/alerts") == ()


def test_a_body_that_carries_no_link_finds_nothing() -> None:
    assert urls_in("Elevator out at Market Street. Use the Grand Avenue entrance.") == ()
