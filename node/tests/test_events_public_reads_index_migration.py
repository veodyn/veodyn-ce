import importlib.util
import os

from sqlalchemy import text

from redash.models import db
from tests import BaseTestCase

MIGRATION_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "migrations",
    "versions",
    "a41d2c8f9b07_index_public_reads_on_events.py",
)


def load_migration():
    """Import the revision by path.

    migrations/versions is not a package, so there is no import to write. It is
    still worth reaching for the real file rather than restating its SQL here:
    a copy in the test would keep passing while the migration that ships drifted
    into something else.
    """
    spec = importlib.util.spec_from_file_location("migration_a41d2c8f9b07", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestEventsPublicReadsIndexMigration(BaseTestCase):
    """Drive the migration against a real database.

    Unlike the api_keys index, this one is not declared in any model, so
    db.create_all() does not build it and every test starts from "absent",
    which is the state a database that has not run this revision is in.

    Everything runs on a second connection in autocommit, because CREATE INDEX
    CONCURRENTLY cannot run inside a transaction block.
    """

    def setUp(self):
        super().setUp()
        self.migration = load_migration()
        db.session.rollback()
        self.connection = db.engine.connect().execution_options(isolation_level="AUTOCOMMIT")
        self.addCleanup(self.connection.close)
        self.addCleanup(lambda: self.connection.execute(text(self.migration.DROP_INDEX)))

    def state(self):
        return self.migration.index_state(self.connection)

    def test_builds_an_index_matching_what_the_revision_defines(self):
        # Also the only check that the predicate written in the migration and
        # the predicate this file compares against survive a round trip through
        # the catalog, which rewrites both the spacing and the casts.
        self.assertEqual(self.state(), "absent")

        self.migration.build_index(self.connection)

        self.assertEqual(self.state(), "valid")

    def test_is_idempotent(self):
        self.migration.build_index(self.connection)
        self.migration.build_index(self.connection)

        self.assertEqual(self.state(), "valid")

    def test_rebuilds_an_index_that_holds_the_name_but_not_the_definition(self):
        # What an operator working around a failed build leaves behind, or what
        # an earlier version of this file created. It is valid and it is useless
        # to the query the console runs, and reading indisvalid alone would call
        # it done.
        self.connection.execute(
            text("CREATE INDEX {} ON events (object_type)".format(self.migration.INDEX_NAME))
        )
        self.assertEqual(self.state(), "mismatched")

        self.migration.build_index(self.connection)

        self.assertEqual(self.state(), "valid")

    def test_refuses_when_the_name_belongs_to_another_table(self):
        # Dropping it would be destroying an object this revision has no claim
        # on, so it stops instead.
        self.connection.execute(
            text("CREATE INDEX {} ON api_keys (object_type)".format(self.migration.INDEX_NAME))
        )

        with self.assertRaises(RuntimeError):
            self.migration.build_index(self.connection)

        self.assertEqual(self.state(), "foreign")
