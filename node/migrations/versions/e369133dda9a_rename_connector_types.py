"""rename connector types off the customer prefix

Revision ID: e369133dda9a
Revises: a41d2c8f9b07
Create Date: 2026-08-04 22:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "e369133dda9a"
down_revision = "a41d2c8f9b07"
branch_labels = None
depends_on = None

# riits_gtfsrt -> gtfs_realtime and riits_geojson -> static_geojson are
# deliberately absent: they are not pure renames (see NEEDS_MANUAL_MIGRATION
# in redash/query_runner/legacy_types.py) and rewriting those rows would
# silently connect them with a config shape the new runner does not support.
# Their rows are left as-is; bin/report_data_source_types.py flags them for
# an operator to migrate by hand.
TYPE_RENAMES = {
    "riits_airnow": "airnow",
    "riits_gbfs": "gbfs",
    "riits_geotab": "geotab",
    "riits_mca": "metrocloudalliance",
    "riits_openweathermap": "openweathermap",
    "riits_trafficland": "trafficland",
    "riits_waze": "waze",
}


def _rewrite(mapping):
    connection = op.get_bind()
    for source, target in mapping.items():
        result = connection.execute(
            sa.text("UPDATE data_sources SET type = :target WHERE type = :source"),
            {"target": target, "source": source},
        )
        if result.rowcount:
            print(f"data_sources: {result.rowcount} rows {source} -> {target}")


def upgrade():
    _rewrite(TYPE_RENAMES)


def downgrade():
    _rewrite({new: old for old, new in TYPE_RENAMES.items()})
