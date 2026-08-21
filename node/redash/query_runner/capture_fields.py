"""
Historical capture toggles shared by every registered source type.

connector_base.build_configuration_schema used to add its own
enable_historical_capture and historical_retention_days fields. This module
is now the single source of truth: it is applied to every runner's served
schema (BaseQueryRunner.to_dict and get_configuration_schema_for_query_runner_type)
so connectors and plain SQL runners carry the same three fields.
"""

HISTORICAL_CAPTURE_FIELDS = {
    "enable_historical_capture": {
        "type": "boolean",
        "title": "Historical capture (scheduled runs → warehouse)",
        "default": False,
    },
    "capture_manual_runs": {
        "type": "boolean",
        "title": "Capture manual runs too",
        "default": False,
    },
    "historical_retention_days": {
        "type": "number",
        "title": "Historical retention (days, 0 = keep forever)",
        "default": 0,
    },
}


def add_historical_capture_fields(schema):
    """
    Return a copy of `schema` with the historical-capture toggle fields added.

    A field is only added when the schema does not already define a property
    of that name. The input schema is never mutated.
    """
    augmented = dict(schema)
    properties = dict(augmented.get("properties", {}))
    for name, field in HISTORICAL_CAPTURE_FIELDS.items():
        if name not in properties:
            properties[name] = dict(field)
    augmented["properties"] = properties
    augmented.setdefault("type", "object")
    return augmented
