import re
from typing import Any

MAX_PARAMETERS = 20
MAX_TITLE_CHARS = 255
MAX_ENUM_OPTIONS_CHARS = 4_000
MAX_VALUE_CHARS = 1_000

PARAMETER_TYPES = (
    "text",
    "number",
    "enum",
    "query",
    "date",
    "datetime-local",
    "datetime-with-seconds",
    "date-range",
    "datetime-range",
    "datetime-range-with-seconds",
)
QUOTES = ("none", "single", "double")
DEFINITION_KEYS = frozenset({"name", "title", "type", "value", "enumOptions", "queryId", "multi", "quote"})

TAG_RE = re.compile(r"\{\{\s*([A-Za-z_][\w.]*)\s*\}\}")
NAME_RE = re.compile(r"^[A-Za-z_]\w*$")

PARAMETERS_SCHEMA: dict[str, Any] = {
    "type": "array",
    "maxItems": MAX_PARAMETERS,
    "description": (
        "The full list of parameter definitions. Every `{{ name }}` in the SQL needs exactly one definition and "
        "every definition must appear in the SQL. A date range is referenced as `{{ name.start }}` and "
        "`{{ name.end }}`."
    ),
    "items": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "The name used inside `{{ }}`: letters, digits, underscore."},
            "title": {"type": "string", "description": "The label the analyst sees. Defaults to the name."},
            "type": {"type": "string", "enum": list(PARAMETER_TYPES)},
            "value": {"description": "The default value."},
            "enumOptions": {"type": "string", "description": "For enum: the allowed values, one per line."},
            "queryId": {"type": "integer", "description": "For query: the id of the query that lists the values."},
            "multi": {"type": "boolean", "description": "For enum and query: allow several values."},
            "quote": {"type": "string", "enum": list(QUOTES), "description": "For multi values: how to quote them."},
        },
        "required": ["name", "type"],
    },
}


def _is_count(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _definition_problem(definition: Any) -> str | None:
    if not isinstance(definition, dict):
        return "each parameter definition must be an object"
    unknown = sorted(set(definition) - DEFINITION_KEYS)
    if unknown:
        return f"a parameter definition has {unknown[0]!r}, which is not a field of a parameter"
    name = definition.get("name")
    if not isinstance(name, str) or not NAME_RE.match(name):
        return "each parameter needs a name of letters, digits and underscores that does not start with a digit"
    if definition.get("type") not in PARAMETER_TYPES:
        return f"parameter {name!r} needs a type, one of {', '.join(PARAMETER_TYPES)}"
    title = definition.get("title")
    if title is not None and not (isinstance(title, str) and len(title) <= MAX_TITLE_CHARS):
        return f"parameter {name!r} has a title that is not a string of at most {MAX_TITLE_CHARS} characters"
    options = definition.get("enumOptions")
    if definition["type"] == "enum" and not (isinstance(options, str) and options.strip()):
        return f"parameter {name!r} is an enum and needs enumOptions, the allowed values one per line"
    if options is not None and not (isinstance(options, str) and len(options) <= MAX_ENUM_OPTIONS_CHARS):
        return f"parameter {name!r} has enumOptions over {MAX_ENUM_OPTIONS_CHARS} characters or not a string"
    if definition["type"] == "query" and not _is_count(definition.get("queryId")):
        return f"parameter {name!r} is a query parameter and needs queryId, the id of the query that lists its values"
    if "queryId" in definition and not _is_count(definition["queryId"]):
        return f"parameter {name!r} has a queryId that is not a query id"
    if "multi" in definition and not isinstance(definition["multi"], bool):
        return f"parameter {name!r} has a multi that is not true or false"
    if "quote" in definition and definition["quote"] not in QUOTES:
        return f"parameter {name!r} has a quote that is not one of {', '.join(QUOTES)}"
    if len(repr(definition.get("value"))) > MAX_VALUE_CHARS:
        return f"parameter {name!r} has a default value over {MAX_VALUE_CHARS} characters"
    return None


def check_definitions(definitions: Any) -> str | None:
    if not isinstance(definitions, list):
        return "parameters must be a list of parameter definitions"
    if len(definitions) > MAX_PARAMETERS:
        return f"parameters names more than {MAX_PARAMETERS} parameters"
    seen: set[str] = set()
    for definition in definitions:
        problem = _definition_problem(definition)
        if problem is not None:
            return problem
        name = definition["name"]
        if name in seen:
            return f"parameter {name!r} is defined more than once"
        seen.add(name)
    return None


def referenced_names(sql: str) -> list[str]:
    names: list[str] = []
    for match in TAG_RE.finditer(sql):
        base = match.group(1).split(".")[0]
        if base not in names:
            names.append(base)
    return names


def check_parameters(sql: str, definitions: Any) -> str | None:
    problem = check_definitions(definitions)
    if problem is not None:
        return problem
    return check_parameter_names(sql, definitions)


def check_parameter_names(sql: str, definitions: list[Any]) -> str | None:
    defined = [one["name"] for one in definitions if isinstance(one, dict) and isinstance(one.get("name"), str)]
    for name in referenced_names(sql):
        if name not in defined:
            return f"the SQL uses a parameter called {name!r} that parameters does not define"
    used = set(referenced_names(sql))
    for name in defined:
        if name not in used:
            return f"parameters defines {name!r}, but the SQL never uses it as a parameter"
    return None
