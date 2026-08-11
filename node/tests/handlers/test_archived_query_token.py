"""A query's own legacy api_key, after the query has been archived.

Query.api_key is a column on the row rather than an ApiKey record, and nothing
revokes it. Query.archive leaves it alone deliberately, and
revoke_share_tokens_when_target_is_archived deactivates the ApiKey rows that
belong to the visualizations. So the token outlived the archive and still
executed the query, read its cached results and read its definition.

The refusal lives in two layers, and they are not interchangeable. Both are
covered here because a fix in either one alone leaves measurable holes:

- permissions.has_access_to_object, for the routes that authorize against the
  QUERY. Its first branch returns on obj.api_key == api_key, so it never reaches
  the dashboard_api_keys branch whose SQL already excludes archived queries.
  This closes POST /api/queries/<id>/results and GET /api/queries/<id>.

- authentication.get_user_from_api_key and hmac_load_user_from_request, for the
  routes that authorize against the DATA SOURCE. GET
  /api/queries/<id>/results.json calls require_access on
  query_result.data_source, so has_access_to_object is never consulted at all,
  and the ApiUser is built with list(query.groups.keys()) rather than an empty
  set, so the query's own data source groups satisfy that check on their own.
  Refusing the identity is the only thing that closes it. Measured: with only
  the has_access_to_object condition in place, that route still answered 200.

An unauthenticated /api/ request answers 404 by Redash convention
(login_manager.unauthorized_handler turns the redirect into a 404 for paths
containing /api/), so 404 here is the refusal rather than a missing row.
"""

import time

from flask import request

from redash import models
from redash.authentication import hmac_load_user_from_request, sign
from redash.models import db
from redash.permissions import has_access_to_object, view_only
from tests import BaseTestCase


class ArchivedQueryTokenTestCase(BaseTestCase):
    def setUp(self):
        super().setUp()
        # view_only=False so the data source groups are not what refuses the
        # request. The token has to be the only thing that changes.
        self.data_source = self.factory.create_data_source(group=self.factory.org.default_group, view_only=False)
        self.query = self.factory.create_query(data_source=self.data_source)
        self.query.latest_query_data = self.factory.create_query_result(
            data_source=self.data_source,
            query_text=self.query.query_text,
            query_hash=self.query.query_hash,
        )
        db.session.commit()

    def archive_the_query(self):
        self.query.archive()
        db.session.commit()

    def execute(self):
        return self.make_request(
            "post",
            "/api/queries/{}/results?api_key={}".format(self.query.id, self.query.api_key),
            user=False,
            data={"parameters": {}},
        )

    def read_cached_results(self):
        return self.make_request(
            "get",
            "/api/queries/{}/results.json?api_key={}".format(self.query.id, self.query.api_key),
            user=False,
        )

    def read_the_query(self):
        return self.make_request(
            "get",
            "/api/queries/{}?api_key={}".format(self.query.id, self.query.api_key),
            user=False,
        )


class TestArchivedQueryTokenIsRefused(ArchivedQueryTokenTestCase):
    """404 rather than 403 on purpose: the token must not authenticate at all.

    A 403 would also be safe, and is what the has_access_to_object condition
    alone produces on two of these three routes. It is the weaker outcome,
    because it means an ApiUser carrying the query's data source groups was
    still built and every route that authorizes against the data source rather
    than the query is still satisfied by it. Measured: with only that condition,
    read_cached_results answered 200.
    """

    def test_refuses_execution(self):
        # The worst of the three: QueryResultResource.post runs no data source
        # group check behind has_access, so a token that gets past it executes
        # against the data source.
        self.archive_the_query()

        self.assertEqual(404, self.execute().status_code)

    def test_refuses_cached_results(self):
        self.archive_the_query()

        self.assertEqual(404, self.read_cached_results().status_code)

    def test_refuses_the_query_definition(self):
        self.archive_the_query()

        self.assertEqual(404, self.read_the_query().status_code)

    def test_has_access_to_object_refuses_the_archived_query_directly(self):
        # The branch itself, without a route in the way, because the route tests
        # above would also pass if the identity layer alone were refusing.
        key = self.query.api_key
        self.assertTrue(has_access_to_object(self.query, key, view_only))

        self.archive_the_query()

        self.assertFalse(has_access_to_object(self.query, key, view_only))


class TestArchivedQueryTokenStillWorksWhileLive(ArchivedQueryTokenTestCase):
    """The fix has to refuse the archive, not the feature."""

    def test_executes(self):
        # max_age defaults to -1, which serves the cached result rather than
        # enqueuing a job, so the body is the result and not a job id. Either
        # way the token got past has_access, which is what is being asserted.
        response = self.execute()

        self.assertEqual(200, response.status_code)
        self.assertIn("query_result", response.json)

    def test_reads_cached_results(self):
        self.assertEqual(200, self.read_cached_results().status_code)

    def test_reads_the_query_definition(self):
        response = self.read_the_query()

        self.assertEqual(200, response.status_code)
        self.assertEqual(self.query.id, response.json["id"])


class TestArchivedQueryHmacSignatureIsRefused(BaseTestCase):
    """The signed-URL path builds its own ApiUser and never calls get_user_from_api_key.

    Called directly rather than through a route, the way
    tests/test_authentication.py drives it: this loader is only wired in when
    REDASH_AUTH_TYPE is "hmac", and the default is "api_key".
    """

    def setUp(self):
        super().setUp()
        self.query = self.factory.create_query(api_key="10")
        models.db.session.flush()
        self.path = "/{}/api/queries/{}".format(self.query.org.slug, self.query.id)
        self.expires = time.time() + 1800

    def load_user(self):
        with self.app.test_client() as c:
            c.get(
                self.path,
                query_string={
                    "signature": sign(self.query.api_key, self.path, self.expires),
                    "expires": self.expires,
                },
            )
            return hmac_load_user_from_request(request)

    def test_a_correct_signature_still_works_while_the_query_is_live(self):
        self.assertIsNotNone(self.load_user())

    def test_a_correct_signature_is_refused_once_the_query_is_archived(self):
        self.query.archive()
        models.db.session.commit()

        self.assertIsNone(self.load_user())
