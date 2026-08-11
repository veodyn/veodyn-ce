"""Wire shapes for the tag endpoints.

Tags here are for discovery and navigation, not governance: free-text labels
that let a person pivot from one object to everything related to it, across
entity types. There is no controlled list and no per-tag permission, which is
why nothing in this file enumerates allowed values.

Nothing here constrains a value either, and that is deliberate rather than
missing. The size caps (100 characters per tag, 50 tags per object) live in
services/tag_rules.py and are refused by the router as ApiError, because a
pydantic Field constraint can only answer the one generic VEODYN_INVALID_REQUEST
cause. Everything the tag endpoint refuses answers 422, so a caller reading the
status alone cannot tell a too-long label from the reserved `domain:` prefix,
and the frontend was telling people the prefix was reserved when they had
simply typed too much.

`TagCountOut` is deliberately the item shape Redash's QueryTagsResource returns
(`node/redash/handlers/queries.py:490`), so the frontend merges this
service's vocabulary with the query and dashboard ones without writing a second
mapper.
"""

from pydantic import BaseModel


class TagsIn(BaseModel):
    """The whole set for one object.

    A replace rather than an add/remove pair, because the frontend's
    TagsControl hands back the full array on every change, and replace is
    idempotent under retry where an add is not.
    """

    tags: list[str]


class TagsOut(BaseModel):
    """What is actually stored, after normalization.

    Echoed back rather than left to the client to assume, so the chips render
    what was kept rather than what was sent: `  Rail  ` went in and `rail` is
    what the next reader will match on.
    """

    tags: list[str]


class TagCountOut(BaseModel):
    name: str
    count: int
