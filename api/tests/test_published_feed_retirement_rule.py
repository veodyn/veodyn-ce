from typing import Any

import pytest
from pydantic import ValidationError

from tests.test_published_feeds_wire import AGGREGATE, _gtfs_rt, bulletins_registered
from veodyn_api.schemas.published_feed import PublishedFeedIn
from veodyn_api.services import publish_produce

WITHDRAWABLE = publish_produce.Needs(query=False, static_reference=True, column_map=False, retirement_on_failure=True)


def _body(**overrides: Any) -> dict[str, Any]:
    body = _gtfs_rt(entity="bulletins", columnMap={}, **overrides)
    body.pop("queryId")
    return body


def test_an_entity_whose_rows_can_be_withdrawn_refuses_a_binding_that_would_keep_a_stale_artifact() -> None:
    with bulletins_registered(WITHDRAWABLE):
        with pytest.raises(ValidationError, match="failed to replace"):
            PublishedFeedIn.model_validate(_body())


def test_that_entity_cannot_be_bound_to_last_good_either() -> None:
    with bulletins_registered(WITHDRAWABLE):
        with pytest.raises(ValidationError, match="failed to replace"):
            PublishedFeedIn.model_validate(_body(onError="last_good", lastGoodMaxAgeSeconds=300))


def test_that_entity_is_accepted_once_the_binding_retires_on_failure() -> None:
    with bulletins_registered(WITHDRAWABLE):
        parsed = PublishedFeedIn.model_validate(_body(retireOnFailure=True))

    assert (parsed.on_error, parsed.retire_on_failure) == ("block", True)


def test_an_entity_that_does_not_ask_for_retirement_is_left_alone_by_that_rule() -> None:
    with bulletins_registered(AGGREGATE):
        parsed = PublishedFeedIn.model_validate(_body())

    assert parsed.retire_on_failure is False
