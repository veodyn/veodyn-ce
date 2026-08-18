"""Turning a pack on: an env var naming the dotted modules to import.

The shape mirrors Redash's own `REDASH_ADDITIONAL_QUERY_RUNNERS`.
"""

import importlib

BUILTIN_MODULE = "veodyn_api.routers"
"""Importing this is what registers everything built in.

Each built-in router module calls `register_*` at import time. The worker needs
it too: jobs register the same way, and it starts fine with an empty registry.
"""


def load_extra_modules(env_value: str) -> list[str]:
    """Import each dotted module named in a comma-separated env var, in order.

    Import is the registration trigger. Nothing is caught: a named module that
    is missing, or one that half imports, must fail the start rather than leave
    the service running with some of a pack's surfaces registered.
    """
    imported = []
    for name in (candidate.strip() for candidate in env_value.split(",")):
        if not name:
            continue
        importlib.import_module(name)
        imported.append(name)
    return imported


def load_registrations(extra_modules: str) -> list[str]:
    """Everything that registers a surface: the built-ins first, then the packs.

    One function so the API and the worker load the same set. Repeating it is a
    no-op, so it cannot refill a registry a test emptied.
    """
    importlib.import_module(BUILTIN_MODULE)
    return load_extra_modules(extra_modules)
