"""The tables this service owns.

The community ones, which are the models imported below. `kpi`,
`kpi_history_point`, `report` and `external_access` are enterprise and live in
the pack, which imports them itself; importing one from here would put it into
`Base.metadata` on a build that has no migration to create it, and `create_all`
or an autogenerate sweep would then either build a table nothing reads or
propose dropping one nothing owns.

**Importing a community model here is not optional bookkeeping.**
`migrations/env.py` reaches `target_metadata` through this module and nothing
else, so a model absent from this list is invisible to autogenerate on the
metadata side while `include_name` still reflects its table out of the
database. The sweep then proposes dropping a table the chain itself created,
which is the exact failure `migrations/ownership.py` exists to prevent. A test
module that imports the model directly hides this, because collection
populates the metadata as a side effect.
"""

from veodyn_api.models.base import Base
from veodyn_api.models.favorite import Favorite
from veodyn_api.models.feed_expectation import FeedExpectation
from veodyn_api.models.publish_attempt import PublishAttempt
from veodyn_api.models.published_feed import PublishedFeed
from veodyn_api.models.tag_assignment import TagAssignment

__all__ = [
    "Base",
    "Favorite",
    "FeedExpectation",
    "PublishAttempt",
    "PublishedFeed",
    "TagAssignment",
]
