"""Small Redash reads that label something this service already assembled.

A lookup lands here once a SECOND feature needs it. `data_source_names` started
in ai_data_sources.py, beside the paragraph that tells the model what a source
label means; Feed Health then needed the same map to say which system a capture
runs against, and a non-AI service importing an `ai_*` module to get it would
have been the wrong shape. The prompt prose stayed there, which is what that
module is actually about.

The auth posture is the CALLER's choice, not this module's, which is why both
credentials are parameters and neither has a default that picks for you. The two
callers differ on purpose: the AI grounding runs as the Redash service account,
because the relay in veodyn-de strips the browser cookie before calling out, so
this service cannot know who is asking. Feed Health runs as the reader, so a
data source they cannot see goes unnamed rather than named for them.
"""

import logging

from veodyn_api.errors import ApiError
from veodyn_api.services.redash import RedashClient

logger = logging.getLogger(__name__)


def data_source_names(
    redash: RedashClient, *, api_key: str | None = None, cookie: str | None = None
) -> dict[int, str]:
    """Every data source this credential can see, id to name.

    Empty is "we could not find out", and every caller treats it that way: the
    thing being labelled is returned unlabelled rather than not returned. Losing
    a whole grounding, or a whole feed list, because a side lookup failed would
    be a far worse trade than an answer that says less than it could.
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
