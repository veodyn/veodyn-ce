import threading
from unittest.mock import patch

from flask_restful import abort

from redash import models
from redash.handlers import idempotency
from redash.models import User, db
from redash.permissions import ACCESS_TYPE_MODIFY, require_object_modify_permission
from redash.utils import gen_query_hash
from tests import BaseTestCase


class IdempotentCreateCases:
    removable = False

    def payload(self, key):
        raise NotImplementedError

    def path(self):
        raise NotImplementedError

    def count(self):
        raise NotImplementedError

    def remove(self, created):
        raise NotImplementedError

    def create(self, key, user=None):
        data = self.payload(key)
        if key is not None:
            data["idempotency_key"] = key
        return self.make_request("post", self.path(), data=data, user=user)

    def test_repeat_key_returns_first_object(self):
        before = self.count()

        first = self.create("draft-1:1:0")
        second = self.create("draft-1:1:0")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json["id"], second.json["id"])
        self.assertEqual(self.count(), before + 1)

    def test_replay_returns_what_the_first_call_returned(self):
        first = self.create("draft-2:1:0")
        second = self.create("draft-2:1:0")

        self.assertEqual(first.json, second.json)

    def test_keys_are_per_user(self):
        before = self.count()

        first = self.create("shared-key")
        second = self.create("shared-key", user=self.factory.create_admin())

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertNotEqual(first.json["id"], second.json["id"])
        self.assertEqual(self.count(), before + 2)

    def test_different_keys_create_different_objects(self):
        first = self.create("draft-3:1:0")
        second = self.create("draft-3:1:1")

        self.assertNotEqual(first.json["id"], second.json["id"])

    def test_no_key_inserts_each_time(self):
        before = self.count()

        first = self.create(None)
        second = self.create(None)

        self.assertNotEqual(first.json["id"], second.json["id"])
        self.assertEqual(self.count(), before + 2)

    def test_key_longer_than_the_limit_is_refused(self):
        before = self.count()

        rv = self.create("k" * 201)

        self.assertEqual(rv.status_code, 400)
        self.assertEqual(self.count(), before)

    def test_recorded_object_gone_creates_again(self):
        if not self.removable:
            self.skipTest("this object type is archived, never deleted")

        first = self.create("draft-4:1:0")
        self.remove(first.json)

        second = self.create("draft-4:1:0")

        self.assertEqual(second.status_code, 200)
        self.assertNotEqual(first.json["id"], second.json["id"])


class TestQueryIdempotency(IdempotentCreateCases, BaseTestCase):
    def payload(self, key):
        return {"data_source_id": self.factory.data_source.id, "query": "select 1", "name": "idempotent"}

    def path(self):
        return "/api/queries"

    def count(self):
        return models.Query.query.count()


class TestDashboardIdempotency(IdempotentCreateCases, BaseTestCase):
    def payload(self, key):
        return {"name": "idempotent"}

    def path(self):
        return "/api/dashboards"

    def count(self):
        return models.Dashboard.query.count()


class TestVisualizationIdempotency(IdempotentCreateCases, BaseTestCase):
    removable = True

    def setUp(self):
        super().setUp()
        self.query = self.factory.create_query()

    def payload(self, key):
        return {"query_id": self.query.id, "type": "TABLE", "name": "idempotent", "options": {}}

    def path(self):
        return "/api/visualizations"

    def count(self):
        return models.Visualization.query.count()

    def remove(self, created):
        self.assertEqual(self.make_request("delete", "/api/visualizations/{}".format(created["id"])).status_code, 200)


class TestWidgetIdempotency(IdempotentCreateCases, BaseTestCase):
    removable = True

    def setUp(self):
        super().setUp()
        self.dashboard = self.factory.create_dashboard()
        self.visualization = self.factory.create_visualization()

    def payload(self, key):
        return {
            "dashboard_id": self.dashboard.id,
            "visualization_id": self.visualization.id,
            "options": {},
            "width": 1,
        }

    def path(self):
        return "/api/widgets"

    def count(self):
        return models.Widget.query.count()

    def remove(self, created):
        self.assertEqual(self.make_request("delete", "/api/widgets/{}".format(created["id"])).status_code, 200)

    def test_concurrent_same_key_creates_one(self):
        user_id = self.factory.user.id
        org_slug = self.factory.org.slug
        body = self.payload("race-key")
        body["idempotency_key"] = "race-key"
        db.session.commit()

        real_replay = idempotency.replay_or_none
        barrier = threading.Barrier(2, timeout=20)
        arrived = set()
        results = []
        errors = []

        def gated(*args, **kwargs):
            found = real_replay(*args, **kwargs)
            name = threading.current_thread().name
            if name not in arrived:
                arrived.add(name)
                barrier.wait()
            return found

        def run():
            with self.app.app_context():
                try:
                    client = self.app.test_client()
                    with client.session_transaction() as session:
                        session["_user_id"] = User.query.get(user_id).get_id()
                    response = client.post("/{}/api/widgets".format(org_slug), json=body)
                    results.append((response.status_code, response.json))
                except Exception as error:
                    errors.append(error)
                finally:
                    db.session.rollback()
                    db.session.remove()

        with patch("redash.handlers.widgets.replay_or_none", gated):
            threads = [threading.Thread(target=run, name="racer-{}".format(i)) for i in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=60)
                self.assertFalse(thread.is_alive())

        self.assertEqual(errors, [])
        self.assertEqual([status for status, _ in results], [200, 200])
        self.assertEqual(results[0][1]["id"], results[1][1]["id"])
        self.assertEqual(models.Widget.query.count(), 1)


DIFFERENT_REQUEST_MESSAGE = "This idempotency_key was already used for a different request."


class TestReplayAuthorization(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.dashboard = self.factory.create_dashboard()
        self.visualization = self.factory.create_visualization()

    def widget_body(self, key, **overrides):
        body = {
            "dashboard_id": self.dashboard.id,
            "visualization_id": self.visualization.id,
            "options": {},
            "width": 1,
            "idempotency_key": key,
        }
        body.update(overrides)
        return body

    def post_widget(self, key, **overrides):
        return self.make_request("post", "/api/widgets", data=self.widget_body(key, **overrides))

    def revoke_query_access(self, query):
        query.data_source = self.factory.create_data_source(group=self.factory.create_group())
        models.db.session.add(query)
        models.db.session.commit()

    def test_widget_replay_with_other_visualization_is_refused(self):
        other = self.factory.create_visualization()
        self.post_widget("w1")

        rv = self.post_widget("w1", visualization_id=other.id)

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], DIFFERENT_REQUEST_MESSAGE)

    def test_widget_replay_without_visualization_is_refused(self):
        self.post_widget("w2")

        rv = self.post_widget("w2", visualization_id=None)

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], DIFFERENT_REQUEST_MESSAGE)
        self.assertNotIn(self.visualization.query_rel.query_text.encode(), rv.data)

    def test_widget_replay_on_other_dashboard_is_refused(self):
        other = self.factory.create_dashboard()
        self.post_widget("w3")

        rv = self.post_widget("w3", dashboard_id=other.id)

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], DIFFERENT_REQUEST_MESSAGE)

    def test_widget_replay_after_access_revoked_is_refused(self):
        self.assertEqual(self.post_widget("w4").status_code, 200)
        self.revoke_query_access(self.visualization.query_rel)

        rv = self.post_widget("w4")

        self.assertEqual(rv.status_code, 403)
        self.assertNotIn(self.visualization.query_rel.query_text.encode(), rv.data)

    def test_widget_winner_path_reauthorizes(self):
        self.assertEqual(self.post_widget("w5").status_code, 200)
        calls = []

        def second_call_refused(obj, user):
            calls.append(obj)
            if len(calls) > 1:
                abort(403)
            return require_object_modify_permission(obj, user)

        with patch("redash.handlers.widgets.replay_or_none", lambda *args, **kwargs: None):
            with patch("redash.handlers.widgets.require_object_modify_permission", second_call_refused):
                rv = self.post_widget("w5")

        self.assertEqual(rv.status_code, 403)
        self.assertEqual(models.Widget.query.count(), 1)

    def test_visualization_replay_on_other_query_is_refused(self):
        query = self.factory.create_query()
        other = self.factory.create_query()
        body = {"query_id": query.id, "type": "TABLE", "name": "v", "options": {}, "idempotency_key": "v1"}
        self.make_request("post", "/api/visualizations", data=body)

        rv = self.make_request("post", "/api/visualizations", data=dict(body, query_id=other.id))

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], DIFFERENT_REQUEST_MESSAGE)

    def test_query_replay_on_other_data_source_is_refused(self):
        other = self.factory.create_data_source(group=self.factory.default_group)
        body = {
            "data_source_id": self.factory.data_source.id,
            "query": "select 1",
            "name": "q",
            "idempotency_key": "q1",
        }
        self.make_request("post", "/api/queries", data=body)

        rv = self.make_request("post", "/api/queries", data=dict(body, data_source_id=other.id))

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], DIFFERENT_REQUEST_MESSAGE)


class TestArchiveFlagMustBeBoolean(BaseTestCase):
    def test_non_boolean_is_archived_is_refused(self):
        grantee = self.factory.create_user()
        dashboard = self.factory.create_dashboard()
        models.AccessPermission.grant(dashboard, ACCESS_TYPE_MODIFY, grantee, self.factory.user)
        models.db.session.commit()

        for value in (1, "true"):
            rv = self.make_request(
                "post", "/api/dashboards/{}".format(dashboard.id), user=grantee, data={"is_archived": value}
            )
            self.assertEqual(rv.status_code, 400, value)

        models.db.session.expire_all()
        self.assertFalse(models.Dashboard.query.get(dashboard.id).is_archived)

    def test_boolean_is_archived_still_reaches_the_owner_check(self):
        grantee = self.factory.create_user()
        dashboard = self.factory.create_dashboard()
        models.AccessPermission.grant(dashboard, ACCESS_TYPE_MODIFY, grantee, self.factory.user)
        models.db.session.commit()

        rv = self.make_request(
            "post", "/api/dashboards/{}".format(dashboard.id), user=grantee, data={"is_archived": True}
        )

        self.assertEqual(rv.status_code, 403)


class TestQueryCreateIsOneTransaction(BaseTestCase):
    def body(self):
        return {
            "data_source_id": self.factory.data_source.id,
            "query": "select 1",
            "name": "cached",
            "idempotency_key": "cached-1",
        }

    def test_replay_carries_the_cached_result_and_a_stable_updated_at(self):
        cached = self.factory.create_query_result(query_text="select 1", query_hash=gen_query_hash("select 1"))

        first = self.make_request("post", "/api/queries", data=self.body())
        second = self.make_request("post", "/api/queries", data=self.body())

        self.assertEqual(first.json["latest_query_data_id"], cached.id)
        self.assertEqual(second.json["latest_query_data_id"], cached.id)
        self.assertEqual(first.json["updated_at"], second.json["updated_at"])

        edit = self.make_request(
            "post",
            "/api/queries/{}".format(first.json["id"]),
            data={"name": "renamed", "expected_updated_at": second.json["updated_at"]},
        )
        self.assertEqual(edit.status_code, 200)

    def test_query_and_key_are_visible_together(self):
        self.factory.create_query_result(query_text="select 1", query_hash=gen_query_hash("select 1"))

        with patch.object(models.Query, "update_latest_result_by_query_hash", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                self.make_request("post", "/api/queries", data=self.body())

        db.session.rollback()
        self.assertEqual(models.Query.query.count(), 0)
        self.assertEqual(models.ClientOperation.query.count(), 0)


class TestQueryForkIdempotency(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.source = self.factory.create_query()

    def fork(self, query, key, user=None):
        data = {} if key is None else {"idempotency_key": key}
        return self.make_request("post", "/api/queries/{}/fork".format(query.id), data=data, user=user)

    def fork_count(self):
        return models.Query.query.filter(models.Query.name.like("Copy of (#%")).count()

    def test_repeat_key_returns_the_first_fork(self):
        first = self.fork(self.source, "fork-1:1:0")
        second = self.fork(self.source, "fork-1:1:0")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json["id"], second.json["id"])
        self.assertEqual(self.fork_count(), 1)

    def test_replay_returns_what_the_first_call_returned(self):
        first = self.fork(self.source, "fork-2:1:0")
        second = self.fork(self.source, "fork-2:1:0")

        self.assertEqual(first.json, second.json)

    def test_no_key_forks_each_time(self):
        self.fork(self.source, None)
        self.fork(self.source, None)

        self.assertEqual(self.fork_count(), 2)

    def test_empty_body_still_forks(self):
        rv = self.make_request("post", "/api/queries/{}/fork".format(self.source.id))

        self.assertEqual(rv.status_code, 200)

    def test_same_key_with_another_source_is_refused(self):
        other = self.factory.create_query()
        self.fork(self.source, "fork-3:1:0")

        rv = self.fork(other, "fork-3:1:0")

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], DIFFERENT_REQUEST_MESSAGE)
        self.assertEqual(self.fork_count(), 1)

    def test_key_used_for_another_kind_of_object_is_refused(self):
        body = {"name": "d", "idempotency_key": "k"}
        self.make_request("post", "/api/dashboards", data=body)

        rv = self.fork(self.source, "k")

        self.assertEqual(rv.status_code, 409)

    def test_replay_after_access_revoked_is_refused(self):
        first = self.fork(self.source, "fork-4:1:0")
        revoked = self.factory.create_data_source(group=self.factory.create_group())
        for query in (self.source, models.Query.query.get(first.json["id"])):
            query.data_source = revoked
            models.db.session.add(query)
        models.db.session.commit()

        rv = self.fork(self.source, "fork-4:1:0")

        self.assertEqual(rv.status_code, 403)
        self.assertEqual(self.fork_count(), 1)
