"""The Redash half of the catalog seed: creating sources, queries and dashboards,
and finding them again on a re-run.

Split from seed-catalog.py so that file stays the orchestrator. Everything here
needs an app context and the `redash` package; nothing here touches ClickHouse or
the sidecar database.

Imported, not run. seed-catalog.py holds the entry point.
"""

from __future__ import annotations

from datetime import datetime, timezone


def _result_payload(spec):
    """A Redash query result document built from the fixture's columns and rows.

    Without one of these a dashboard widget has no stored data and falls back to
    running the query, which for the two inert sources means a live call to a
    host that does not resolve. Every widget then reads "No data" on a stack whose
    whole point is to show something offline.
    """
    columns = [{"name": name, "type": kind, "friendly_name": name} for name, kind in spec["columns"]]
    names = [name for name, _ in spec["columns"]]
    return {
        "columns": columns,
        "rows": [dict(zip(names, row)) for row in spec.get("rows", [])],
    }


def create_sources(models, org, fixture, query_runners, ConfigurationContainer, log):
    sources = {}
    for spec in fixture["data_sources"]:
        # Look before creating, so this phase reconciles rather than duplicates.
        # The completion marker lives in ClickHouse and the rows land in Postgres,
        # so the two cannot be written atomically: a run interrupted between the
        # commit and the marker leaves the rows durable and the phase looking
        # unstarted. `data_sources` has no unique constraint on `name`, so without
        # this the retry would add a second set of everything.
        existing = models.DataSource.query.filter(
            models.DataSource.org == org, models.DataSource.name == spec["name"]
        ).first()
        if existing is not None:
            sources[spec["key"]] = existing
            log(f"data source {spec['name']} already exists")
            continue

        runner = query_runners.get(spec["type"])
        if runner is None:
            # Reachable only if a runner leaves default_query_runners. Loud,
            # because the alternative is a catalog quietly missing a third of
            # itself with every other line of output identical.
            raise RuntimeError(f"no query runner registered for type {spec['type']!r}")
        options = ConfigurationContainer(spec["options"], runner.configuration_schema())
        if not options.is_valid():
            # Almost always a required option that expanded to "". Naming the
            # source beats the schema library's own message, which does not.
            raise RuntimeError(f"invalid options for data source {spec['name']!r}")
        sources[spec["key"]] = models.DataSource.create_with_group(
            name=spec["name"], type=spec["type"], options=options, org=org
        )
        log(f"data source {spec['name']} ({spec['type']})")
    # Flush, NOT commit. All three creation steps share one transaction and the
    # caller commits once, after the dashboards. Committing here would leave three
    # data sources behind if query creation then failed, with the `catalog` marker
    # still unset, so the next run would create three more: `data_sources` has no
    # unique constraint on `name`.
    models.db.session.flush()
    return sources


def create_queries(models, org, admin, fixture, sources, gen_query_hash, log):
    """Queries, their stored result, and any visualization beyond the default one."""
    queries = {}
    visualizations = {}
    for spec in fixture["queries"]:
        source = sources[spec["source"]]
        # Same reconcile-before-create rule as the sources above, and for the same
        # reason. An existing query keeps whatever the developer has done to it;
        # only its visualizations are topped up, since a widget below needs one by
        # name and a missing one would fail the dashboard step instead.
        existing = models.Query.query.filter(
            models.Query.org == org, models.Query.name == spec["name"]
        ).first()
        if existing is not None:
            queries[spec["key"]] = existing
            for vis in existing.visualizations:
                visualizations[(spec["key"], vis.name)] = vis
            log(f"query {spec['name']} already exists")
            continue

        query = models.Query.create(
            name=spec["name"],
            description=spec.get("description", ""),
            query_text=spec["query"],
            query_hash=gen_query_hash(spec["query"]),
            data_source=source,
            org=org,
            user=admin,
            is_draft=False,
            is_archived=False,
            # Unscheduled. A laptop stack polling public feeds forever is a
            # surprising thing to install, and the captured history the caller
            # loads is what a schedule would eventually have produced. Schedule
            # one by hand to exercise the capture path.
            schedule=None,
            options={},
            tags=spec.get("tags", []),
        )
        models.db.session.add(query)
        models.db.session.flush()

        result = models.QueryResult(
            org=org,
            data_source=source,
            query_hash=query.query_hash,
            query_text=query.query_text,
            data=_result_payload(spec),
            runtime=0.0,
            retrieved_at=datetime.now(timezone.utc),
        )
        models.db.session.add(result)
        models.db.session.flush()
        query.latest_query_data = result

        queries[spec["key"]] = query
        # Query.create already added a TABLE visualization named "Table", so the
        # fixture's entry of that name is a reference to it rather than a second
        # one to create.
        by_name = {vis.name: vis for vis in query.visualizations}
        for vis_spec in spec.get("visualizations", []):
            existing = by_name.get(vis_spec["name"])
            if existing is None:
                existing = models.Visualization(
                    query_rel=query,
                    name=vis_spec["name"],
                    type=vis_spec["type"],
                    description="",
                    options=vis_spec.get("options", {}),
                )
                models.db.session.add(existing)
                models.db.session.flush()
            visualizations[(spec["key"], vis_spec["name"])] = existing
        log(f"query {spec['name']} ({len(spec.get('rows', []))} stored rows)")
    models.db.session.flush()
    return queries, visualizations


def create_dashboards(models, org, admin, fixture, visualizations, log):
    for spec in fixture["dashboards"]:
        # By slug, which is what a URL points at, and unlike `name` it is the thing
        # a second copy would collide on visibly. Same reconcile rule as above.
        if models.Dashboard.query.filter(
            models.Dashboard.org == org, models.Dashboard.slug == spec["slug"]
        ).first():
            log(f"dashboard {spec['name']} already exists")
            continue

        dashboard = models.Dashboard(
            name=spec["name"],
            slug=spec["slug"],
            org=org,
            user=admin,
            is_draft=False,
            is_archived=False,
            layout=[],
            tags=spec.get("tags", []),
        )
        models.db.session.add(dashboard)
        models.db.session.flush()
        for widget_spec in spec["widgets"]:
            models.db.session.add(
                models.Widget(
                    dashboard=dashboard,
                    visualization=visualizations[(widget_spec["query"], widget_spec["visualization"])],
                    text="",
                    width=1,
                    options={
                        "position": widget_spec["position"],
                        "isHidden": False,
                        "parameterMappings": {},
                    },
                )
            )
        log(f"dashboard {spec['name']}")
    # The single commit for all three creation steps. Until it lands, a failure
    # anywhere in the catalog phase leaves the database exactly as it was.
    models.db.session.commit()


def find_queries(models, org, fixture):
    """The queries a previous run created, by name.

    Needed because the later phases key their tokens on query ids, so a re-run
    that skips creation still has to know them. By name and not by id: ids are
    assigned by a sequence this fixture does not control.
    """
    queries = {}
    for spec in fixture["queries"]:
        query = models.Query.query.filter(
            models.Query.org == org, models.Query.name == spec["name"]
        ).first()
        if query is None:
            raise RuntimeError(
                f"query {spec['name']!r} is missing from a stack that was already seeded. "
                "The fixture and this instance have diverged; `down -v` and seed again."
            )
        queries[spec["key"]] = query
    return queries
