"""The tables this service owns.

Three, not seven: `favorite`, `tag_assignment` and `feed_expectation`, which are
the three imported below. The other four, `kpi`, `kpi_history_point`, `report`
and `external_access`, are enterprise and live in the pack, which imports them
itself; importing one from here would put it into `Base.metadata` on a build
that has no migration to create it, and `create_all` or an autogenerate sweep
would then either build a table nothing reads or propose dropping one nothing
owns.
"""

from veodyn_api.models.base import Base
from veodyn_api.models.favorite import Favorite
from veodyn_api.models.feed_expectation import FeedExpectation
from veodyn_api.models.tag_assignment import TagAssignment

__all__ = [
    "Base",
    "Favorite",
    "FeedExpectation",
    "TagAssignment",
]
