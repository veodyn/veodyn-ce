"""The pure half of compose/seed-catalog.py: reading a fixture, not applying one.

Split out for the same reason seed_redash_groups.py is, and importable for the
same reason: it holds decisions that can be exercised without a database, a
ClickHouse or a Redash app context, which is all three of the things the seed
script itself needs before it can do anything at all.

Importable as a module because the filename has underscores. `seed-catalog.py`
cannot be imported and does not need to be.
"""

from __future__ import annotations

import re

# ${NAME} and ${NAME:-fallback}, the two shapes the fixture uses. Expanded here
# rather than by a shell because the fixture is JSON and never touches one.
#
# A fallback may not contain a closing brace: this reads to the first one. The
# placeholder GTFS feed URL in catalog.json carries no `{routes}` segment for
# exactly that reason.
_ENV_REF = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")

# The prefix is anchored but the rest is case-insensitive: the query and table
# tokens carry the fixture's own lowercase keys (__QID_transit_vehicles__), and an
# uppercase-only pattern reports a clean substitution over an unresolved token.
_TOKEN = re.compile(r"__[A-Za-z][A-Za-z0-9_]*__")


def expand(value, environ):
    """Resolve ${VAR} and ${VAR:-fallback} through `environ`, recursively.

    An empty environment value takes the fallback rather than winning, because
    compose passes every optional variable through as `${VAR:-}` and an unset one
    therefore arrives as "" rather than as absent.
    """
    if isinstance(value, str):
        return _ENV_REF.sub(lambda m: environ.get(m.group(1)) or (m.group(2) or ""), value)
    if isinstance(value, dict):
        return {key: expand(item, environ) for key, item in value.items()}
    if isinstance(value, list):
        return [expand(item, environ) for item in value]
    return value


def substitute(text, tokens):
    """Replace every __TOKEN__, and refuse text still carrying one afterwards."""
    for token, value in tokens.items():
        text = text.replace(token, value)
    leftover = sorted(set(_TOKEN.findall(text)))
    if leftover:
        raise RuntimeError(f"fixture refers to tokens nothing defines: {', '.join(leftover)}")
    return text


def split_statements(sql):
    """Line comments out, then split on `;`.

    Not a SQL parser: a `;` or a `--` inside a string literal would break it. The
    fixtures have neither, and the alternative is a dependency for one file.

    The comments have to go FIRST. Splitting first and then skipping any chunk
    that begins with `--` looks equivalent and is not: every statement in the
    fixture is preceded by a comment, so every chunk begins with one and every
    statement was dropped, while the caller reported the rows loaded. That is what
    this did until a row count in ClickHouse said otherwise.
    """
    without_comments = re.sub(r"(?m)^\s*--.*$", "", sql)
    return [part.strip() for part in without_comments.split(";") if part.strip()]
