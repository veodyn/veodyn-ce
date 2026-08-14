"""Who receives a query's API key, and what that key reaches.

A query API key is a permanent bearer credential. Two separate things were
wrong: the serializer handed it to everyone who could see the query, and the
principal it resolves to carries the query's DATA SOURCE groups, which
satisfied any check asking about groups rather than about a specific object.
"""

from unittest.mock import patch

from redash.models import db
from tests import BaseTestCase

DROPDOWN_VALUES = [{"name": "a", "value": "1"}]


class TestQueryApiKeyDisclosure(BaseTestCase):
    """The serializer must not hand the key to a plain viewer."""

    def get_query(self, query, user):
        return self.make_request("get", "/api/queries/{}".format(query.id), user=user)

    def test_a_viewer_does_not_receive_the_key(self):
        query = self.factory.create_query()
        viewer = self.factory.create_user()

        rv = self.get_query(query, viewer)

        self.assertEqual(200, rv.status_code)
        # Absent, not empty. An empty string would still read as "there is a key
        # here" to a client that only checks the field exists.
        self.assertNotIn("api_key", rv.json)

    def test_the_owner_still_receives_the_key(self):
        query = self.factory.create_query()

        rv = self.get_query(query, self.factory.user)

        self.assertEqual(200, rv.status_code)
        self.assertEqual(query.api_key, rv.json["api_key"])

    def test_an_admin_still_receives_the_key(self):
        query = self.factory.create_query()
        admin = self.factory.create_admin()

        rv = self.get_query(query, admin)

        self.assertEqual(200, rv.status_code)
        self.assertEqual(query.api_key, rv.json["api_key"])

    def test_the_list_endpoint_never_carries_keys(self):
        """The owner's own list too: a list has no dialog to feed."""
        self.factory.create_query()

        rv = self.make_request("get", "/api/queries", user=self.factory.user)

        self.assertEqual(200, rv.status_code)
        self.assertTrue(rv.json["results"])
        for serialized in rv.json["results"]:
            self.assertNotIn("api_key", serialized)

    def test_regenerating_returns_the_new_key(self):
        """The one response whose whole purpose is to hand a key back."""
        query = self.factory.create_query()
        before = query.api_key

        rv = self.make_request("post", "/api/queries/{}/regenerate_api_key".format(query.id))

        self.assertEqual(200, rv.status_code)
        self.assertIn("api_key", rv.json)
        self.assertNotEqual(before, rv.json["api_key"])


class TestQueryApiKeyReach(BaseTestCase):
    """A query's key must not read a sibling query's dropdown values.

    dropdown_values is patched throughout: it needs a cached result to return
    anything, and this is a test about the authorization decision in front of
    it, not about what it computes. Without the patch both the allowed and the
    refused case would fail the same way and the test would prove nothing.
    """

    def setUp(self):
        super().setUp()
        # One data source, so the two queries genuinely share groups. That is
        # the whole mechanism: if they did not share, the old check would have
        # refused anyway and the test would pass for the wrong reason.
        self.data_source = self.factory.create_data_source(group=self.factory.default_group)
        self.sibling = self.factory.create_query(data_source=self.data_source)
        db.session.add(self.sibling)
        self.query = self.factory.create_query(data_source=self.data_source)
        db.session.add(self.query)
        db.session.commit()

    def dropdowns(self, dropdown_query_id, api_key):
        return self.make_request(
            "get",
            "/api/queries/{}/dropdowns/{}?api_key={}".format(self.query.id, dropdown_query_id, api_key),
            user=False,
        )

    @patch("redash.handlers.query_results.dropdown_values", return_value=DROPDOWN_VALUES)
    def test_a_query_key_cannot_read_a_sibling_querys_dropdowns(self, _):
        self.assertEqual(self.sibling.data_source_id, self.query.data_source_id)

        rv = self.dropdowns(self.sibling.id, self.query.api_key)

        self.assertEqual(403, rv.status_code)

    @patch("redash.handlers.query_results.dropdown_values", return_value=DROPDOWN_VALUES)
    def test_a_query_key_still_reads_a_dropdown_its_own_parameters_declare(self, _):
        self.query.options = {"parameters": [{"name": "foo", "type": "query", "queryId": self.sibling.id}]}
        db.session.add(self.query)
        db.session.commit()

        rv = self.dropdowns(self.sibling.id, self.query.api_key)

        self.assertEqual(200, rv.status_code)
        self.assertEqual(DROPDOWN_VALUES, rv.json)

    @patch("redash.handlers.query_results.dropdown_values", return_value=DROPDOWN_VALUES)
    def test_a_signed_in_user_with_access_is_unaffected(self, _):
        """The refusal is aimed at API-key principals, not at people."""
        rv = self.make_request(
            "get",
            "/api/queries/{}/dropdowns/{}".format(self.query.id, self.sibling.id),
            user=self.factory.user,
        )

        self.assertEqual(200, rv.status_code)
