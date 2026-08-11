"""What counts as a tag: normalization, the reserved prefix, and the size caps.

Pure text rules with no session and no statements, split out of services/tags.py
so the module that owns the SQL owns only the SQL. They are the half the router
applies before it touches the database at all, and the half a test can exercise
without one.

Every rule here is enforced server side as well as in the browser, because this
endpoint is reachable without the UI and a single write that skipped them is
enough to split a tag in two for everyone.
"""

from collections.abc import Iterable

# `domain:` tags drive real domain hubs (services/domains.py scans for them), so
# they are not a label anybody may mint or delete through a chip with an X on
# it. They are refused on the way in and hidden from the vocabulary on the way
# out, which together mean the assignment table can never contain one.
RESERVED_PREFIX = "domain:"

# Long enough for any label a person would actually navigate by, short enough
# that a caller reaching the endpoint without the UI cannot write a document
# into the column. Neither bound is a product rule; both are there so an
# unbounded body cannot become unbounded storage. They live here rather than as
# pydantic Field constraints on the request schema because a Field constraint
# can only answer the one generic "invalid request" cause, and a person who hit
# a length cap would then be told the `domain:` prefix is reserved.
MAX_TAG_LENGTH = 100
MAX_TAGS_PER_OBJECT = 50


def normalize(raw: str) -> str:
    """Trim, collapse inner whitespace, lowercase.

    Matching is exact and case-sensitive by design, mirroring Redash's array
    containment, so this is what stops `rail`, `Rail` and `rail ` from becoming
    three unrelated tags that each find a third of the objects. `str.split()`
    with no argument does the trim and the collapse in one step, including tabs
    and newlines a caller outside the UI can send.
    """
    return " ".join(raw.split()).lower()


def normalize_all(raw: Iterable[str]) -> list[str]:
    """The set to store, from what the caller sent.

    Empty strings after normalization are dropped rather than stored: a chip
    with no text is not a label, and storing one would put an unremovable blank
    in the vocabulary. Duplicates collapse, because two spellings of one tag are
    one fact. Sorted, so the response order is stable and a caller diffing two
    reads sees a change only when something changed.
    """
    return sorted({normalized for normalized in (normalize(tag) for tag in raw) if normalized})


def is_reserved(tag: str) -> bool:
    return tag.startswith(RESERVED_PREFIX)


def reserved_in(tags: Iterable[str]) -> list[str]:
    """The reserved tags in a set, so the refusal can name them.

    Returned rather than silently filtered: a person who types `domain:rail`,
    sees it vanish and concludes the feature is broken is worse served than one
    who is told the prefix is taken.
    """
    return [tag for tag in tags if is_reserved(tag)]


def too_long_in(tags: Iterable[str]) -> list[str]:
    """The tags over the length cap, so the refusal can name one of them.

    Judged after normalization, because the cap bounds what is stored and
    normalization is what decides that: a label padded out to 101 characters of
    tabs is a short tag by the time it reaches the column, and refusing it would
    be refusing something nobody sent.
    """
    return [tag for tag in tags if len(tag) > MAX_TAG_LENGTH]
