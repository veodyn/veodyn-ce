"""Small Redash reads that label something this service already assembled.

A lookup lands here once a SECOND feature needs it.

The auth posture is the CALLER's choice, so both credentials are parameters and
neither has a default. AI grounding runs as the Redash service account, because
the relay in veodyn-de strips the browser cookie and this service cannot know who
is asking. Feed Health runs as the reader, so a data source they cannot see goes
unnamed rather than named for them.
"""

import logging

from veodyn_api.errors import ApiError
from veodyn_api.services.redash import RedashClient

logger = logging.getLogger(__name__)


def data_source_names(
    redash: RedashClient, *, api_key: str | None = None, cookie: str | None = None
) -> dict[int, str]:
    """Every data source this credential can see, id to name.

    Empty means "we could not find out", and every caller treats it that way: the
    thing being labelled comes back unlabelled rather than not at all.
    """
    try:
        sources = redash.list_data_sources(api_key=api_key, cookie=cookie)
    except ApiError:
        logger.info("could not list the data sources; what they label goes unnamed")
        return {}
    return {
        source["id"]: name
        for source in sources
        if isinstance(source.get("id"), int) and (name := str(source.get("name") or "").strip())
    }
