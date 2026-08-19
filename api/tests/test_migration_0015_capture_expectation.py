"""0015 renames the table and must carry every row across.

An operator's declared interval and the alert link armed from it exist nowhere
else, so a drop and recreate loses them silently: the board simply reads
"not scheduled" again and no error is raised anywhere.
"""

from sqlalchemy import Engine, inspect, text

from tests.conftest import upgrade_to


def test_rename_preserves_rows(alembic_engine_at_0014: Engine) -> None:
    engine = alembic_engine_at_0014
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO feed_expectation "
                "(org_slug, feed_id, expected_interval_seconds, set_by_user_id, alert_id) "
                "VALUES ('acme', 'historical.q_demo_1', 3600, 7, 42)"
            )
        )

    upgrade_to(engine, "0015")

    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT org_slug, feed_id, expected_interval_seconds, set_by_user_id, alert_id "
                "FROM capture_expectation"
            )
        ).one()
    assert row == ("acme", "historical.q_demo_1", 3600, 7, 42)


def test_rename_carries_the_constraint_names_too(alembic_engine_at_0014: Engine) -> None:
    """Postgres does not rename a table's constraints along with the table, so
    the primary key and check constraint would otherwise still read
    feed_expectation_pkey and ck_feed_expectation_positive after 0015."""
    engine = alembic_engine_at_0014

    upgrade_to(engine, "0015")

    inspector = inspect(engine)
    pk = inspector.get_pk_constraint("capture_expectation")
    assert pk["name"] == "capture_expectation_pkey"
    check_names = {c["name"] for c in inspector.get_check_constraints("capture_expectation")}
    assert "ck_capture_expectation_positive" in check_names
