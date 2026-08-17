"""Old type strings for the connectors renamed off the customer prefix.

A data source row stores its runner's type() string, so renaming a runner
without this would orphan every existing row. Each alias subclasses the
renamed runner and answers to the old string; migration e369133dda9a rewrites
the rows, and these classes exist so an image rolled back to the previous
release still finds its runners.

Two of the nine renames in the original plan are NOT pure renames and are
handled separately, see NEEDS_MANUAL_MIGRATION below: aliasing them to the
new class would connect an existing row using a shape the new runner does
not support, which is worse than leaving the row orphaned until an operator
looks at it.

Aliases are built by looking up the new type string in `query_runners`,
the registry `redash.query_runner.register` fills in, rather than by
importing each runner module directly. A target absent from the registry
(because `REDASH_DISABLED_QUERY_RUNNERS` disabled it, or its dependencies are
missing) simply gets no alias, instead of this module importing the module
directly and re-registering it regardless of the disable setting.

`register_legacy_aliases()` builds the aliases but is not called at import
time: `redash/__init__.py` calls it after `import_query_runners()` has
imported every module in `settings.QUERY_RUNNERS`, so every runner enabled
for this process is registered before aliasing decides anything. Building
aliases as a side effect of this module's own import used to make the
result depend on where `legacy_types` sits in `REDASH_ENABLED_QUERY_RUNNERS`:
a target listed after it had not registered yet and was skipped for reasons
of import order, not because it was disabled.

Every alias is marked `deprecated = True` so the create-data-source dialog and
`/api/data_sources/types` stop offering the customer-prefixed strings this
migration removes; only rows that already exist under the old string resolve
through it.

Delete one release after the migration has shipped everywhere.
"""

from redash.query_runner import query_runners, register

TYPE_RENAMES = {
    "riits_airnow": "airnow",
    "riits_gbfs": "gbfs",
    "riits_geotab": "geotab",
    "riits_go511": "go511",
    "riits_mca": "metrocloudalliance",
    "riits_openweathermap": "openweathermap",
    "riits_socaltransport": "socaltransport",
    "riits_trafficland": "trafficland",
    "riits_waze": "waze",
}

# Types whose runner was deleted outright, not renamed. Rows of these types
# are reported by bin/report_data_source_types.py and retired by hand; there
# is nothing to alias them to.
RETIRED_TYPES = ("riits_nextbus", "riits_twitter")

# Types that look like a rename but are not: the new runner cannot represent
# what an existing row of the old type means, so aliasing it would silently
# connect the row wrong instead of leaving it visibly broken. Reported by
# bin/report_data_source_types.py; an operator must resolve each row by hand,
# there is no code path that migrates them automatically.
#
# EMPTY, and that is a decision rather than an oversight. Both entries that
# were here, riits_gtfsrt and riits_geojson, moved to PACK_PROVIDED_TYPES
# below when their runners moved into veodyn-pack-riits instead of being
# migrated onto a community connector. The reasoning is recorded there.
#
# Keep the mechanism. The next connector rename that cannot represent an
# existing row belongs here, and an empty dict is what makes the gate a no-op
# rather than absent: bin/report_data_source_types.py folds this into
# build_blocking_reasons() unconditionally.
NEEDS_MANUAL_MIGRATION: dict[str, str] = {}

# Types whose runner is no longer in this image: it moved to a customer pack
# that a deployment installs on top. The rows are not orphaned and there is
# nothing to migrate, but a node without the pack cannot run them, so the
# preflight names them rather than letting the deploy look clean.
PACK_PROVIDED_TYPES = {
    "riits_api": (
        "provided by the veodyn-pack-riits distribution; install it in the image "
        "and name veodyn_pack_riits.query_runner.riits_api in "
        "REDASH_ADDITIONAL_QUERY_RUNNERS, or these data sources cannot run"
    ),
    # These two were in NEEDS_MANUAL_MIGRATION until the first deploy that ran
    # the preflight against a real database. It blocked, correctly, on four
    # rows; two were retired by hand and these two turned out to be worth
    # keeping in their original shape rather than migrating.
    #
    # The trade the migration would have required, for gtfs_realtime: one data
    # source split into two, five saved queries repointed and rewritten for
    # renamed fields, four of them on dashboards. For static_geojson: a new
    # data source and seven queries repointed, two of them scheduled and so
    # failing unattended if missed. Moving the runner into the pack that is
    # already installed on this node costs none of that, and the layer data the
    # geojson runner reads had already moved into the same pack.
    #
    # This is what the mechanism is for. A pack-provided type is reported but
    # does not gate, because an operator running the pack-installed image is in
    # a correct state.
    "riits_gtfsrt": (
        "provided by the veodyn-pack-riits distribution; install it in the image "
        "and name veodyn_pack_riits.query_runner.riits_gtfsrt in "
        "REDASH_ADDITIONAL_QUERY_RUNNERS, or these data sources cannot run. Kept "
        "rather than migrated to gtfs_realtime: it serves two feeds and two "
        "resources that the community connector cannot represent as one row."
    ),
    "riits_geojson": (
        "provided by the veodyn-pack-riits distribution; install it in the image "
        "and name veodyn_pack_riits.query_runner.riits_geojson in "
        "REDASH_ADDITIONAL_QUERY_RUNNERS, or these data sources cannot run. Kept "
        "rather than migrated to static_geojson: it reads layer data bundled beside "
        "itself, which moved into the same pack."
    ),
}


def _alias(base, old_type):
    """Build a registered subclass of `base` answering to `old_type`.

    Marked deprecated so it still resolves for existing rows but is never
    offered as a choice for a new data source.
    """

    class Legacy(base):
        deprecated = True

        @classmethod
        def type(cls):
            return old_type

        @classmethod
        def name(cls):
            return f"{base.name()} (legacy {old_type})"

    Legacy.__name__ = f"Legacy{base.__name__}"
    Legacy.__qualname__ = Legacy.__name__
    register(Legacy)
    return Legacy


def register_legacy_aliases():
    """Create an alias for every renamed type whose target this deployment
    has enabled.

    Reads `query_runners` at call time rather than at this module's import
    time, so it does not matter whether `legacy_types` was imported before or
    after the runner modules it aliases; see the module docstring. A target
    that is disabled, or whose dependencies are missing, is simply absent
    from `query_runners` and gets no alias, which is the intended "clean
    absence" outcome, not an ordering accident.
    """
    for old_type, new_type in TYPE_RENAMES.items():
        base = query_runners.get(new_type)
        if base is not None:
            _alias(base, old_type)
