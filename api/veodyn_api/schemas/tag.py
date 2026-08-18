"""Wire shapes for the tag endpoints.

Tags are free-text labels for discovery, with no controlled list and no per-tag
permission. The size caps (100 characters per tag, 50 tags per object) live in
services/tag_rules.py rather than as pydantic Field constraints, so the router
can answer a distinct ApiError cause per refusal instead of one generic
VEODYN_INVALID_REQUEST.

`TagCountOut` matches the item shape Redash's QueryTagsResource returns
(`node/redash/handlers/queries.py:490`), so one frontend mapper covers both.
"""

from pydantic import BaseModel


class TagsIn(BaseModel):
    """The whole set for one object: a replace, not an add/remove pair."""

    tags: list[str]


class TagsOut(BaseModel):
    """What is actually stored, after normalization: `  Rail  ` comes back `rail`."""

    tags: list[str]


class TagCountOut(BaseModel):
    name: str
    count: int
