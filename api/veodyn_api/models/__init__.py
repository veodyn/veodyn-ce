"""The community tables this service owns.

`migrations/env.py` reaches `target_metadata` through this module alone, so
every community model must be imported here: one that is missing is invisible to
autogenerate on the metadata side while `include_name` still reflects its table
out of the database, and the sweep proposes dropping it. `kpi`,
`kpi_history_point`, `report` and `external_access` are enterprise and stay out,
the pack imports them itself.
"""

from veodyn_api.models.base import Base
from veodyn_api.models.capture_expectation import CaptureExpectation
from veodyn_api.models.favorite import Favorite
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.models.tag_assignment import TagAssignment

__all__ = [
    "Base",
    "CaptureExpectation",
    "Favorite",
    "PublishAttempt",
    "PublishedFeed",
    "TagAssignment",
]
