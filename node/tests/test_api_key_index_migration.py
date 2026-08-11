import importlib.util
import os
from unittest.mock import patch

from sqlalchemy import text
from sqlalchemy.exc import DatabaseError

from redash.models import ApiKey, db
from tests import BaseTestCase

MIGRATION_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "migrations",
    "versions",
    "c3f81de5a4b2_one_active_api_key_per_object.py",
)


def load_migration():
    """Import the revision by path.

    migrations/versions is not a package, so there is no import to write. It is
    still worth reaching for the real file rather than reimplementing it here:
    a copy of the SQL in the test would pass while the migration that ships is
    something else.
    """
    spec = importlib.util.spec_from_file_location("migration_c3f81de5a4b2", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestOneActiveApiKeyPerObjectMigration(BaseTestCase):
    """Drive the migration against a database that already holds duplicates.

    That state cannot be reached through the model any more, because the index
    this revision adds is in ApiKey.__table_args__ and db.create_all() builds
    it. So each test takes the index off first, which leaves the schema exactly
    as a database that has not run this revision yet.

    Everything runs on a second connection in autocommit. CREATE INDEX
    CONCURRENTLY cannot run inside a transaction block, and the reconcile passes
    have to commit one at a time or retrying them means nothing.
    """

    def setUp(self):
        super().setUp()
        self.migration = load_migration()
        self.connection = db.engine.connect().execution_options(isolation_level="AUTOCOMMIT")
        self.addCleanup(self.connection.close)

    def unmigrated(self):
        """Take the index away, leaving the schema as it was before this revision."""
        db.session.rollback()
        self.connection.execute(text("DROP INDEX IF EXISTS {}".format(self.migration.INDEX_NAME)))

    def duplicate_active_keys(self, count):
        """The mess an old deployment leaves: one object, several live tokens.

        Minting used to insert unconditionally, so every extra click on share
        left another active key, and revocation only ever reached the first.
        """
        dashboard = self.factory.create_dashboard()
        keys = [self.factory.create_api_key(object=dashboard) for _ in range(count)]
        db.session.commit()
        ids = sorted(key.id for key in keys)
        db.session.close()
        return dashboard, ids

    def active_key_ids(self, dashboard):
        ids = sorted(key.id for key in ApiKey.all_active_for_object(dashboard))
        db.session.close()
        return ids

    def test_reconciles_existing_duplicates_and_builds_an_enforcing_index(self):
        self.unmigrated()
        dashboard, ids = self.duplicate_active_keys(3)

        self.migration.build_unique_index(self.connection)

        self.assertEqual("valid", self.migration.index_state(self.connection))
        # The lowest id survives: that is the one get_by_object was handing out,
        # so it is the token people are actually holding.
        self.assertEqual([ids[0]], self.active_key_ids(dashboard))
        # Revoked, not deleted, so the row can still answer what that token was.
        self.assertEqual(3, ApiKey.query.filter(ApiKey.id.in_(ids)).count())

    def test_the_index_rejects_a_second_active_key_afterwards(self):
        self.unmigrated()
        dashboard, _ = self.duplicate_active_keys(2)

        self.migration.build_unique_index(self.connection)

        db.session.close()
        with self.assertRaises(DatabaseError):
            self.factory.create_api_key(object=dashboard)
            db.session.commit()
        db.session.rollback()

    def test_re_running_it_changes_nothing(self):
        self.unmigrated()
        dashboard, ids = self.duplicate_active_keys(2)

        self.migration.build_unique_index(self.connection)
        self.migration.build_unique_index(self.connection)

        self.assertEqual("valid", self.migration.index_state(self.connection))
        self.assertEqual([ids[0]], self.active_key_ids(dashboard))

    def test_rebuilds_an_index_a_previous_failed_build_left_invalid(self):
        self.unmigrated()
        dashboard, ids = self.duplicate_active_keys(2)

        # How a failed concurrent build happens for real: it meets a duplicate.
        # What it leaves behind is the whole reason this migration cannot use
        # CREATE INDEX ... IF NOT EXISTS. The index is in the catalog under the
        # right name and it enforces nothing.
        with self.assertRaises(DatabaseError):
            self.connection.execute(text(self.migration.CREATE_INDEX))
        self.assertEqual("invalid", self.migration.index_state(self.connection))

        self.migration.build_unique_index(self.connection)

        self.assertEqual("valid", self.migration.index_state(self.connection))
        self.assertEqual([ids[0]], self.active_key_ids(dashboard))

    def create_index(self, definition):
        """Occupy the name with something that is not this revision's index."""
        self.connection.execute(text(definition.format(self.migration.INDEX_NAME)))

    def assertRejectsASecondActiveKey(self, dashboard):
        db.session.close()
        with self.assertRaises(DatabaseError):
            self.factory.create_api_key(object=dashboard)
            db.session.commit()
        db.session.rollback()

    def test_rebuilds_a_valid_index_of_the_right_name_that_is_not_unique(self):
        # The failure a validity check cannot see. This index is valid, it is on
        # the right table and the right columns, and it rejects nothing at all.
        # Treated as done, the migration returns early and Alembic stamps the
        # revision over a database that still accepts duplicate active keys.
        self.unmigrated()
        dashboard, ids = self.duplicate_active_keys(2)

        self.create_index("CREATE INDEX {} ON api_keys (object_type, object_id) WHERE active")

        self.assertEqual("mismatched", self.migration.index_state(self.connection))

        self.migration.build_unique_index(self.connection)

        self.assertEqual("valid", self.migration.index_state(self.connection))
        self.assertEqual([ids[0]], self.active_key_ids(dashboard))
        self.assertRejectsASecondActiveKey(dashboard)

    def test_rebuilds_a_unique_index_of_the_right_name_over_the_wrong_columns(self):
        # Unique, valid, and unique over something else, so two live tokens for
        # one object pass it without complaint.
        self.unmigrated()
        dashboard, ids = self.duplicate_active_keys(2)

        self.create_index("CREATE UNIQUE INDEX {} ON api_keys (id) WHERE active")

        self.assertEqual("mismatched", self.migration.index_state(self.connection))

        self.migration.build_unique_index(self.connection)

        self.assertEqual("valid", self.migration.index_state(self.connection))
        self.assertEqual([ids[0]], self.active_key_ids(dashboard))
        self.assertRejectsASecondActiveKey(dashboard)

    def test_rebuilds_a_unique_index_of_the_right_name_with_the_wrong_predicate(self):
        # Right columns, right uniqueness, partial on the rows nobody is
        # fighting over. It constrains revoked keys and leaves the live ones
        # alone, which is the constraint upside down.
        self.unmigrated()
        dashboard, ids = self.duplicate_active_keys(2)

        self.create_index("CREATE UNIQUE INDEX {} ON api_keys (object_type, object_id) WHERE NOT active")

        self.assertEqual("mismatched", self.migration.index_state(self.connection))

        self.migration.build_unique_index(self.connection)

        self.assertEqual("valid", self.migration.index_state(self.connection))
        self.assertEqual([ids[0]], self.active_key_ids(dashboard))
        self.assertRejectsASecondActiveKey(dashboard)

    def test_refuses_when_the_name_belongs_to_an_index_on_another_table(self):
        # Same name, different table. Nothing about api_keys is constrained, and
        # the name cannot be reused while it stands. Dropping it would destroy
        # an object this revision has no claim on, so the migration stops.
        self.unmigrated()
        self.duplicate_active_keys(2)

        self.create_index("CREATE UNIQUE INDEX {} ON dashboards (id)")

        self.assertEqual("foreign", self.migration.index_state(self.connection))

        with self.assertRaises(RuntimeError):
            self.migration.build_unique_index(self.connection)

        # Left exactly as it was found, rather than dropped on the way past.
        self.assertEqual("foreign", self.migration.index_state(self.connection))

    def test_refuses_rather_than_leaving_the_constraint_unenforced(self):
        self.unmigrated()
        self.duplicate_active_keys(2)

        # Stands in for a writer that is still minting duplicates, which is what
        # deploying this migration ahead of its application code looks like: the
        # reconcile runs and the duplicates are back, pass after pass.
        with patch.object(self.migration, "DEACTIVATE_DUPLICATES", "SELECT 1"):
            with self.assertRaises(RuntimeError):
                self.migration.build_unique_index(self.connection)

        # Loud and with no index, rather than quiet and with one that is not
        # enforcing anything.
        self.assertEqual("absent", self.migration.index_state(self.connection))
