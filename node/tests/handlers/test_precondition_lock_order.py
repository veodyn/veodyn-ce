import threading
from contextlib import contextmanager
from urllib.parse import quote

from sqlalchemy import event

from redash import models
from redash.models import User, db
from tests import BaseTestCase

ADVISORY = "pg_advisory_xact_lock"
ROW_LOCK = "FOR UPDATE"


@contextmanager
def recorded_lock_statements(statements):
    def record(conn, cursor, statement, parameters, context, executemany):
        if ADVISORY in statement:
            statements.append((ADVISORY, parameters))
        elif ROW_LOCK in statement:
            statements.append((ROW_LOCK, parameters))

    event.listen(db.engine, "before_cursor_execute", record)
    try:
        yield
    finally:
        event.remove(db.engine, "before_cursor_execute", record)


class TestAdvisoryLockPrecedesRowLock(BaseTestCase):
    def conditional_delete(self, path, updated_at):
        statements = []
        with recorded_lock_statements(statements):
            rv = self.make_request("delete", "{}?expected_updated_at={}".format(path, quote(updated_at)))
        return rv, statements

    def kinds(self, statements):
        return [kind for kind, _ in statements]

    def test_dashboard(self):
        dashboard = self.factory.create_dashboard()
        path = "/api/dashboards/{}".format(dashboard.id)
        updated_at = self.make_request("get", path).json["updated_at"]

        rv, statements = self.conditional_delete(path, updated_at)

        self.assertEqual(rv.status_code, 200)
        kinds = self.kinds(statements)
        self.assertLess(kinds.index(ADVISORY), kinds.index(ROW_LOCK))

    def test_visualization(self):
        vis = self.factory.create_visualization()
        query = self.make_request("get", "/api/queries/{}".format(vis.query_id)).json
        updated_at = next(v for v in query["visualizations"] if v["id"] == vis.id)["updated_at"]

        rv, statements = self.conditional_delete("/api/visualizations/{}".format(vis.id), updated_at)

        self.assertEqual(rv.status_code, 200)
        kinds = self.kinds(statements)
        self.assertLess(kinds.index(ADVISORY), kinds.index(ROW_LOCK))

    def test_query_locks_each_visualization_by_id_before_the_row(self):
        query = self.factory.create_query()
        self.factory.create_visualization(query_rel=query)
        self.factory.create_visualization(query_rel=query)
        path = "/api/queries/{}".format(query.id)
        updated_at = self.make_request("get", path).json["updated_at"]

        rv, statements = self.conditional_delete(path, updated_at)

        self.assertEqual(rv.status_code, 200)
        kinds = self.kinds(statements)
        first_row_lock = kinds.index(ROW_LOCK)
        before_row = [parameters for kind, parameters in statements[:first_row_lock] if kind == ADVISORY]
        self.assertEqual(len(before_row), 2)
        ids = [parameters["object_id"] for parameters in before_row]
        self.assertEqual(ids, sorted(ids))


class TestConcurrentConditionalAndUnconditionalArchive(BaseTestCase):
    def test_dashboard_archive_does_not_deadlock(self):
        user_id = self.factory.user.id
        org_slug = self.factory.org.slug
        for _ in range(5):
            dashboard = self.factory.create_dashboard()
            path = "/{}/api/dashboards/{}".format(org_slug, dashboard.id)
            db.session.commit()
            updated_at = self.make_request("get", "/api/dashboards/{}".format(dashboard.id)).json["updated_at"]
            statuses = []
            errors = []
            barrier = threading.Barrier(2, timeout=20)

            def run(url):
                with self.app.app_context():
                    try:
                        client = self.app.test_client()
                        with client.session_transaction() as session:
                            session["_user_id"] = User.query.get(user_id).get_id()
                        barrier.wait()
                        statuses.append(client.delete(url).status_code)
                    except Exception as error:
                        errors.append(error)
                    finally:
                        db.session.rollback()
                        db.session.remove()

            urls = [path, "{}?expected_updated_at={}".format(path, quote(updated_at))]
            threads = [threading.Thread(target=run, args=(url,)) for url in urls]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=60)
                self.assertFalse(thread.is_alive())

            self.assertEqual(errors, [])
            self.assertNotIn(500, statuses)
            self.assertIn(200, statuses)
            db.session.expire_all()
            self.assertTrue(models.Dashboard.query.get(dashboard.id).is_archived)
