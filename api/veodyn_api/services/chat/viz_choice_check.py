from typing import Any

from veodyn_api.services.ai_viz_catalog import VizCatalog


def missing_viz_choice(arguments: dict[str, Any], catalog: VizCatalog) -> str | None:
    value = arguments.get("vizChoiceId")
    if isinstance(value, str) and value.strip():
        return None
    choices = ", ".join(catalog.ids)
    return f"give vizChoiceId: how the analyst sees this result, one of: {choices}. Use table for a lookup step."
