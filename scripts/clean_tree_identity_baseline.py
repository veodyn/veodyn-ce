"""Generated ratchet for scripts/check-clean-tree.py. Do not hand-edit.

Regenerate with `python3 scripts/check-clean-tree.py --write-baseline`, and say in the
commit message why a number moved. A row is (path, total, ((term index, occurrences),
...)). Paths, counts and INDICES only: no identity term appears here, by the same rule
that governs scripts/clean_tree_identity_manifest.py. An index resolves against the
harvest sources that manifest declares, and TERM_FINGERPRINT below fails the run if
those sources changed, so an index cannot come to mean a different term.

The per-term column is what catches a swap: on totals alone, dropping one occurrence
of a term a file already carried while adding a different term elsewhere in it nets
zero.

A row is the recorded size of an open decision, grouped by OPEN_DECISION_BUCKETS in
clean_tree_identity_buckets.py. Growth fails and reaching zero fails, for the buckets
declared CLOSED as much as for the open ones.

TERM_COUNT is how many terms the harvest yielded when this file was written. The next
--write-baseline compares against it and refuses a shrinking term list.
"""

TERM_FINGERPRINT = "0828bdc5221a63d7"
TERM_COUNT = 25

BASELINE = (
    ("README.md", 1, ((12, 1),)),
    ("app/public/db-logos/go511.png", 1, ((11, 1),)),
    ("app/public/db-logos/riits_airnow.png", 1, ((0, 1),)),
    ("app/public/db-logos/riits_api.png", 1, ((0, 1),)),
    ("app/public/db-logos/riits_gbfs.png", 1, ((0, 1),)),
    ("app/public/db-logos/riits_geojson.png", 1, ((0, 1),)),
    ("app/public/db-logos/riits_geotab.png", 1, ((0, 1),)),
    ("app/public/db-logos/riits_go511.png", 2, ((0, 1), (11, 1))),
    ("app/public/db-logos/riits_gtfsrt.png", 1, ((0, 1),)),
    ("app/public/db-logos/riits_mca.png", 1, ((0, 1),)),
    ("app/public/db-logos/riits_openweathermap.png", 1, ((0, 1),)),
    ("app/public/db-logos/riits_socaltransport.png", 2, ((0, 1), (13, 1))),
    ("app/public/db-logos/riits_trafficland.png", 2, ((0, 1), (12, 1))),
    ("app/public/db-logos/riits_waze.png", 1, ((0, 1),)),
    ("app/public/db-logos/socaltransport.png", 1, ((13, 1),)),
    ("app/public/db-logos/trafficland.png", 1, ((12, 1),)),
    ("docs/docs/configuration.md", 1, ((5, 1),)),
    ("docs/docs/connectors.md", 2, ((12, 2),)),
    ("docs/docs/features/data-catalog.md", 1, ((0, 1),)),
    ("docs/docs/getting-started.md", 1, ((6, 1),)),
    ("node/redash/query_runner/go511.py", 9, ((11, 9),)),
    ("node/redash/query_runner/socaltransport.py", 11, ((9, 1), (13, 10))),
    ("node/redash/query_runner/trafficland.py", 10, ((12, 10),)),
    ("node/redash/settings/__init__.py", 3, ((11, 1), (12, 1), (13, 1))),
    ("node/tests/query_runner/db_logo_manifest.txt", 3, ((11, 1), (12, 1), (13, 1))),
    ("node/tests/query_runner/test_connector_base.py", 3, ((0, 3),)),
    ("node/tests/query_runner/test_connector_query_shape.py", 3, ((11, 1), (12, 1), (13, 1))),
    ("node/tests/query_runner/test_db_logo_assets.py", 1, ((0, 1),)),
    ("node/tests/query_runner/test_go511.py", 15, ((11, 15),)),
    ("node/tests/query_runner/test_no_embedded_credentials.py", 1, ((11, 1),)),
    ("node/tests/query_runner/test_socaltransport.py", 20, ((9, 3), (13, 17))),
    ("node/tests/query_runner/test_trafficland.py", 18, ((12, 18),)),
    ("scripts/kpi_specs.py", 5, ((0, 3), (15, 1), (16, 1))),
)
