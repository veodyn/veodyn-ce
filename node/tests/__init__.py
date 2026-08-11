import datetime
import logging
import os
from contextlib import contextmanager
from unittest import TestCase

# Under pytest-xdist each worker gets its own postgres database and its own
# pair of redis databases, because the suite empties both between every test.
# gw0 takes redis 2 and 3, gw1 takes 4 and 5, and so on; redis ships 16
# databases, so this holds to -n 7. Serial runs keep upstream's 5 and 6.
_worker = os.environ.get("PYTEST_XDIST_WORKER")
_slot = int(_worker[2:]) if _worker else None

if _slot is None:
    _redash_db, _rq_db = 5, 6
else:
    _redash_db, _rq_db = 2 + 2 * _slot, 3 + 2 * _slot
    if _rq_db > 15:
        raise RuntimeError("pytest-xdist worker {} has no redis database left; use -n 7 or fewer".format(_worker))

os.environ["REDASH_REDIS_URL"] = os.environ.get("REDASH_REDIS_URL", "redis://localhost:6379/0").replace(
    "/0", "/{}".format(_redash_db)
)
# Use different url for RQ to avoid DB being cleaned up:
os.environ["RQ_REDIS_URL"] = os.environ["REDASH_REDIS_URL"].replace(
    "/{}".format(_redash_db), "/{}".format(_rq_db)
)

if _worker:
    os.environ["REDASH_DATABASE_URL"] = (
        os.environ.get("REDASH_DATABASE_URL", "postgresql://postgres@postgres/tests") + "_" + _worker
    )

# Dummy values for oauth login
os.environ["REDASH_GOOGLE_CLIENT_ID"] = "dummy"
os.environ["REDASH_GOOGLE_CLIENT_SECRET"] = "dummy"
os.environ["REDASH_MULTI_ORG"] = "true"

# Make sure rate limit is enabled
os.environ["REDASH_RATELIMIT_ENABLED"] = "true"

os.environ["REDASH_ENFORCE_CSRF"] = "false"

from redash import limiter, redis_connection  # noqa: E402
from redash.app import create_app  # noqa: E402
from redash.models import db  # noqa: E402
from redash.utils import json_dumps  # noqa: E402
from tests.factories import Factory, user_factory  # noqa: E402

logging.disable(logging.INFO)
logging.getLogger("metrics").setLevel(logging.ERROR)


def authenticate_request(c, user):
    with c.session_transaction() as sess:
        sess["_user_id"] = user.get_id()


@contextmanager
def authenticated_user(c, user=None):
    if not user:
        user = user_factory.create()
        db.session.commit()
    authenticate_request(c, user)

    yield user


_app = None


def create_worker_database():
    """Create this xdist worker's own database, once, before anything connects.

    The CI job creates `tests`; the per-worker `tests_gwN` are ours to make.
    Each worker owns its own name, so there is nothing to race against and any
    error here is a real one worth surfacing.
    """
    from sqlalchemy import create_engine, text

    url = os.environ["REDASH_DATABASE_URL"]
    server, _, name = url.rpartition("/")
    engine = create_engine(server + "/postgres", isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as conn:
            conn.execute(text('DROP DATABASE IF EXISTS "{}"'.format(name)))
            conn.execute(text('CREATE DATABASE "{}"'.format(name)))
    finally:
        engine.dispose()


def get_test_app():
    """One app and one schema for the whole session.

    create_app() costs ~38ms and building the schema costs ~100ms, and the
    original setUp paid both per test, which was ~95% of the suite's runtime.
    """
    global _app
    if _app is None:
        from sqlalchemy.orm import configure_mappers

        if _worker:
            create_worker_database()
        app = create_app()
        app.config["TESTING"] = True
        with app.app_context():
            # sqlalchemy_searchable attaches the search-trigger DDL to
            # after_create when mappers are configured, which is lazy. Building
            # the schema before that leaves queries.search_vector with no
            # trigger and every full-text search test finds nothing.
            configure_mappers()
            db.drop_all()
            db.create_all()
        _app = app
    return _app


def reset_tables():
    """Empty every table between tests, in place of drop_all + create_all.

    TRUNCATE ... RESTART IDENTITY leaves the same state a fresh schema does
    (no rows, sequences back to 1) for about a seventh of the cost.
    """
    db.session.rollback()
    tables = ", ".join('"{}"'.format(name) for name in db.metadata.tables)
    db.session.execute(db.text("TRUNCATE {} RESTART IDENTITY CASCADE".format(tables)))
    db.session.commit()


class BaseTestCase(TestCase):
    def setUp(self):
        self.app = get_test_app()
        self.db = db
        limiter.enabled = False
        self.app_ctx = self.app.app_context()
        self.app_ctx.push()
        db.session.close()
        reset_tables()
        self.factory = Factory()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        self.app_ctx.pop()
        redis_connection.flushdb()

    def make_request(
        self,
        method,
        path,
        org=None,
        user=None,
        data=None,
        is_json=True,
        follow_redirects=False,
    ):
        if user is None:
            user = self.factory.user

        if org is None:
            org = self.factory.org

        if org is not False:
            path = "/{}{}".format(org.slug, path)

        if user:
            authenticate_request(self.client, user)

        method_fn = getattr(self.client, method.lower())
        headers = {}

        if data and is_json:
            data = json_dumps(data)

        if is_json:
            content_type = "application/json"
        else:
            content_type = None

        response = method_fn(
            path,
            data=data,
            headers=headers,
            content_type=content_type,
            follow_redirects=follow_redirects,
        )
        return response

    def get_request(self, path, org=None, headers=None, client=None):
        if org:
            path = "/{}{}".format(org.slug, path)

        if client is None:
            client = self.client
        return client.get(path, headers=headers)

    def post_request(self, path, data=None, org=None, headers=None):
        if org:
            path = "/{}{}".format(org.slug, path)

        return self.client.post(path, data=data, headers=headers)

    def assertResponseEqual(self, expected, actual):
        for k, v in expected.items():
            if isinstance(v, datetime.datetime) or isinstance(actual[k], datetime.datetime):
                continue

            if isinstance(v, list):
                continue

            if isinstance(v, dict):
                self.assertResponseEqual(v, actual[k])
                continue

            self.assertEqual(
                v,
                actual[k],
                "{} not equal (expected: {}, actual: {}).".format(k, v, actual[k]),
            )
