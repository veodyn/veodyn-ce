"""Turning a pack on: an env var naming the dotted modules to import.

The shape mirrors Redash's own `REDASH_ADDITIONAL_QUERY_RUNNERS`, which is the
pattern this repository already runs on, and it means a pack is enabled by
being installed and named rather than by a code change here.
"""

import importlib

BUILTIN_MODULE = "veodyn_api.routers"
"""Importing this is what registers everything built in.

The routers package pulls in every built-in router module, and each of those
calls `register_*` at import time. The worker needs it as well as the API,
because the jobs are registered the same way and a worker with an empty job
registry is a process that runs perfectly and does nothing at all.
"""


def load_extra_modules(env_value: str) -> list[str]:
    """Import each dotted module named in a comma-separated env var, so a pack
    can register routers, jobs, object types and providers by being installed
    and named. Returns what was imported, in order.

    Import is the registration trigger: each module calls `register_*` at import
    time. A module that is named and missing is a configuration error and is
    raised, not swallowed. A pack that is installed but not named is inert,
    which is what makes the community edition's behaviour with no packs the
    default rather than a special case.

    Nothing here catches anything. A pack that half imports and then fails has
    registered some of its surfaces and none of the rest, and a service that
    starts in that state is the same dead-feature failure as one that never
    imported the pack at all.
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

    One function so the API and the worker load the same set. Both are cheap to
    repeat: an import of a module already in `sys.modules` does nothing, which
    is also why this cannot resurrect a registry a test has deliberately
    emptied.
    """
    importlib.import_module(BUILTIN_MODULE)
    return load_extra_modules(extra_modules)
