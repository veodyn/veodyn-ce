from unittest.mock import patch

from redash import models, redis_connection, rq_redis_connection
from redash.utils import gen_query_hash
from tests import BaseTestCase

ROUTES = "MT020\nMT030"
EMPTY = {"columns": [], "rows": []}


class PublicParamsCase(BaseTestCase):
    def build(self, options=None, parameters=None, text="SELECT '{{ route }}'", vis_options=None):
        self.factory.grant_permission("publish_visualization")
        if parameters is None:
            parameters = [{"name": "route", "type": "enum", "enumOptions": ROUTES, "value": "MT020"}]
        query = self.factory.create_query(query_text=text, options={"parameters": parameters, **(options or {})})
        if vis_options is None:
            vis_options = {"publicParameters": {"route": "^MT[0-9A-Z]{3,5}$"}}
        self.vis = self.factory.create_visualization(query_rel=query, options=vis_options)
        models.db.session.commit()
        shared = self.make_request("post", "/api/visualizations/{}/share".format(self.vis.id))
        self.token = shared.json["api_key"]
        self.query = query
        return query

    def get(self, qs="", token=None):
        return self.make_request(
            "get",
            "/api/visualizations/public/{}{}".format(token or self.token, qs),
            user=False,
            is_json=False,
        )

    def store(self, text, data=None, age=0, ds=None):
        import datetime

        from redash.utils import utcnow

        result = self.factory.create_query_result(
            data_source=ds or self.query.data_source,
            query_text=text,
            query_hash=gen_query_hash(text),
            data=data or {"columns": [{"name": "x"}], "rows": [{"x": text}]},
            retrieved_at=utcnow() - datetime.timedelta(seconds=age),
        )
        models.db.session.commit()
        return result


class TestRejections(PublicParamsCase):
    def bad_token_body(self):
        return self.get("", token="not-a-token").data

    def assert_rejected(self, qs):
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get(qs)
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.data, self.bad_token_body())
        enqueue.assert_not_called()
        self.assertEqual(redis_connection.keys("public-exec*"), [])

    def test_a_repeated_key_is_rejected(self):
        self.build()
        self.assert_rejected("?p_route=MT020&p_route=MT030")

    def test_a_key_missing_from_public_parameters_is_rejected(self):
        self.build(vis_options={"publicParameters": {"other": "^x$"}})
        self.assert_rejected("?p_route=MT020")

    def test_malformed_key_names_that_are_declared_and_listed_are_rejected(self):
        names = ["", "a" * 65, "a-b"]
        self.build(
            parameters=[{"name": n, "type": "enum", "enumOptions": "x", "value": "x"} for n in names],
            text="SELECT 1",
            vis_options={"publicParameters": {n: "^x$" for n in names}},
        )
        for name in names:
            with self.subTest(name=name):
                self.assert_rejected("?p_{}=x".format(name))

    def test_eleven_declared_and_listed_keys_are_rejected(self):
        names = ["k{}".format(i) for i in range(11)]
        parameters = [{"name": n, "type": "enum", "enumOptions": "x", "value": "x"} for n in names]
        self.build(
            parameters=parameters,
            text="SELECT 1",
            vis_options={"publicParameters": {n: "^x$" for n in names}},
        )
        self.assert_rejected("?" + "&".join("p_{}=x".format(n) for n in names))
        self.store("SELECT 1")
        ten = "?" + "&".join("p_{}=x".format(n) for n in names[:10])
        self.assertEqual(self.get(ten).status_code, 200)

    def test_an_oversized_value_that_is_a_member_and_matches_is_rejected(self):
        big = "M" * 201
        self.build(
            parameters=[{"name": "route", "type": "enum", "enumOptions": "M\n" + big, "value": "M"}],
            vis_options={"publicParameters": {"route": "^M+$"}},
        )
        self.store("SELECT 'M'")
        self.assertEqual(self.get("?p_route=M").status_code, 200)
        self.assert_rejected("?p_route=" + big)

    def test_an_enum_member_excluded_only_by_the_public_pattern_is_rejected(self):
        self.build(
            parameters=[{"name": "route", "type": "enum", "enumOptions": "MT020\nXX020\nMT0'", "value": "MT020"}]
        )
        self.assert_rejected("?p_route=XX020")
        self.assert_rejected("?p_route=MT0'")

    def test_an_oversized_declared_and_listed_key_is_rejected(self):
        name = "a" * 65
        self.build(
            parameters=[{"name": name, "type": "enum", "enumOptions": "x", "value": "x"}],
            text="SELECT 1",
            vis_options={"publicParameters": {name: "^x$"}},
        )
        self.assert_rejected("?p_{}=x".format(name))

    def test_a_dropdown_query_that_does_not_exist_is_rejected(self):
        self.build(parameters=[{"name": "route", "type": "query", "queryId": 99999, "value": "MT020"}])
        self.assert_rejected("?p_route=MT020")

    def test_a_dropdown_query_in_another_org_is_rejected(self):
        other = self.factory.create_org()
        other_ds = self.factory.create_data_source(org=other)
        foreign = self.factory.create_query(org=other, data_source=other_ds)
        models.db.session.commit()
        self.build(parameters=[{"name": "route", "type": "query", "queryId": foreign.id, "value": "MT020"}])
        self.assert_rejected("?p_route=MT020")

    def test_a_deleted_data_source_is_rejected_before_any_lookup(self):
        self.build()
        self.store("SELECT 'MT020'")
        self.query.data_source.delete()
        models.db.session.expire_all()
        self.assert_rejected("?p_route=MT020")

    def test_a_deleted_data_source_leaves_the_plain_path_unchanged(self):
        self.build()
        self.query.data_source.delete()
        models.db.session.expire_all()
        res = self.get()
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.json["query_result"])
        self.assertNotIn("status", res.json)

    def test_the_key_boundary_is_64_characters_after_the_prefix(self):
        name = "a" * 64
        self.build(
            parameters=[{"name": name, "type": "enum", "enumOptions": "MT020", "value": "MT020"}],
            text="SELECT '{{ %s }}'" % name,
            vis_options={"publicParameters": {name: "^MT020$"}},
        )
        self.store("SELECT 'MT020'")
        self.assertEqual(self.get("?p_{}=MT020".format(name)).status_code, 200)

    def test_a_value_outside_the_enum_is_rejected(self):
        self.build()
        self.assert_rejected("?p_route=MT999")

    def test_disable_public_urls_still_404s_a_param_request(self):
        self.build()
        self.factory.org.set_setting("disable_public_urls", True)
        models.db.session.commit()
        self.assert_rejected("?p_route=MT020")

    def test_a_visualization_without_public_parameters_404s_any_key(self):
        self.build(vis_options={})
        self.assert_rejected("?p_route=MT020")

    def test_a_text_parameter_404s_even_if_listed(self):
        self.build(parameters=[{"name": "route", "type": "text", "value": "MT020"}])
        self.assert_rejected("?p_route=MT020")

    def test_a_multi_value_parameter_404s(self):
        self.build(
            parameters=[
                {
                    "name": "route",
                    "type": "enum",
                    "enumOptions": ROUTES,
                    "value": "MT020",
                    "multiValuesOptions": {"separator": ","},
                }
            ]
        )
        self.assert_rejected("?p_route=MT020")

    def test_a_parameter_the_query_does_not_declare_404s(self):
        self.build(vis_options={"publicParameters": {"other": "^x$"}})
        self.assert_rejected("?p_other=x")

    def test_a_saved_default_failing_its_pattern_404s(self):
        self.build(
            parameters=[
                {"name": "route", "type": "enum", "enumOptions": ROUTES, "value": "MT020"},
                {"name": "dir", "type": "enum", "enumOptions": "E\nW", "value": "E"},
            ],
            text="SELECT '{{ route }}', '{{ dir }}'",
            vis_options={"publicParameters": {"route": "^MT[0-9A-Z]{3,5}$", "dir": "^X$"}},
        )
        self.assert_rejected("?p_route=MT020")

    def test_a_missing_parameter_without_default_404s(self):
        self.build(
            parameters=[
                {"name": "route", "type": "enum", "enumOptions": ROUTES, "value": "MT020"},
                {"name": "dir", "type": "enum", "enumOptions": "E\nW"},
            ],
            text="SELECT '{{ route }}', '{{ dir }}'",
        )
        self.assert_rejected("?p_route=MT020")

    def test_the_saved_default_is_merged(self):
        self.build(
            parameters=[
                {"name": "route", "type": "enum", "enumOptions": ROUTES, "value": "MT020"},
                {"name": "dir", "type": "enum", "enumOptions": "E\nW", "value": "E"},
            ],
            text="SELECT '{{ route }}', '{{ dir }}'",
        )
        text = "SELECT 'MT030', 'E'"
        self.store(text)
        res = self.get("?p_route=MT030")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["status"], "fresh")
        self.assertEqual(res.json["query_result"]["data"]["rows"], [{"x": text}])

    def test_a_query_dropdown_without_a_stored_result_answers_unavailable(self):
        dropdown = self.factory.create_query()
        models.db.session.commit()
        self.build(parameters=[{"name": "route", "type": "query", "queryId": dropdown.id, "value": "MT020"}])
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json["status"], "unavailable")
        self.assertEqual(res.headers["Retry-After"], "30")
        self.assertIsNone(res.json["query_result"])
        enqueue.assert_not_called()

    def test_a_query_dropdown_with_a_stored_result_validates_membership(self):
        stored = self.factory.create_query_result(
            data={"columns": [{"name": "route_code"}], "rows": [{"route_code": "MT020"}, {"route_code": "MT030"}]}
        )
        dropdown = self.factory.create_query(latest_query_data=stored)
        models.db.session.commit()
        self.build(parameters=[{"name": "route", "type": "query", "queryId": dropdown.id, "value": "MT020"}])
        self.assert_rejected("?p_route=MT040")
        self.store("SELECT 'MT030'")
        self.assertEqual(self.get("?p_route=MT030").status_code, 200)


class TestStatuses(PublicParamsCase):
    def test_a_fresh_hit_answers_200_fresh_and_never_touches_the_lease(self):
        self.build()
        self.store("SELECT 'MT020'", age=5)
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["status"], "fresh")
        self.assertEqual(res.json["parameters"], {"route": "MT020"})
        enqueue.assert_not_called()
        self.assertEqual(redis_connection.keys("public-exec*"), [])

    def test_a_miss_enqueues_and_answers_pending_with_null(self):
        self.build()
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json["status"], "pending")
        self.assertEqual(res.headers["Retry-After"], "2")
        self.assertIsNone(res.json["query_result"])
        enqueue.assert_called_once()
        args, kwargs = enqueue.call_args
        self.assertEqual(args[0], "SELECT 'MT020'")
        self.assertEqual(args[1].id, self.query.data_source.id)
        self.assertEqual(args[2], self.token)
        self.assertTrue(kwargs["is_api_key"])
        self.assertEqual(kwargs["metadata"], {"query_id": self.query.id, "Username": "public-visualization"})
        self.assertEqual(kwargs["job_timeout"], 40)
        self.assertEqual(kwargs["queued_ttl"], 20)

    def test_a_miss_with_an_old_result_answers_pending_with_the_stale_result(self):
        self.build()
        self.store("SELECT 'MT020'", age=3000)
        with patch("redash.public_execution.enqueue_query"):
            res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json["query_result"]["data"]["rows"], [{"x": "SELECT 'MT020'"}])

    def test_the_parameterised_path_never_falls_back_to_latest_query_data(self):
        self.build()
        latest = self.store("SELECT 'something else'")
        self.query.latest_query_data = latest
        models.db.session.commit()
        with patch("redash.public_execution.enqueue_query"):
            res = self.get("?p_route=MT020")
        self.assertIsNone(res.json["query_result"])

    def test_a_second_request_inside_the_lease_is_pending_without_a_second_enqueue(self):
        self.build()
        with patch("redash.public_execution.enqueue_query") as enqueue:
            self.get("?p_route=MT020")
            res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 202)
        self.assertEqual(enqueue.call_count, 1)

    def test_an_enqueue_that_raises_leaves_the_lease_held(self):
        self.build()
        with patch("redash.public_execution.enqueue_query", side_effect=RuntimeError("redis down")) as enqueue:
            first = self.get("?p_route=MT020")
            second = self.get("?p_route=MT020")
        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(enqueue.call_count, 1)

    def test_a_paused_source_answers_stale_without_enqueue(self):
        self.build()
        self.store("SELECT 'MT020'", age=3000)
        self.query.data_source.pause("maintenance")
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["status"], "stale")
        enqueue.assert_not_called()
        self.assertEqual(redis_connection.keys("public-exec*"), [])

    def test_a_paused_source_without_a_result_answers_503(self):
        self.build()
        self.query.data_source.pause("maintenance")
        with patch("redash.public_execution.enqueue_query") as enqueue:
            res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json["status"], "unavailable")
        self.assertEqual(res.headers["Retry-After"], "30")
        enqueue.assert_not_called()

    def test_a_paused_source_still_serves_a_fresh_result(self):
        self.build()
        self.store("SELECT 'MT020'")
        self.query.data_source.pause("maintenance")
        res = self.get("?p_route=MT020")
        self.assertEqual(res.json["status"], "fresh")

    def test_capacity_with_a_stale_result_answers_200_stale(self):
        self.build(vis_options={"publicParameters": {"route": "^MT[0-9A-Z]{3,5}$"}, "publicMaxRunsPerWindow": 1})
        self.store("SELECT 'MT030'", age=3000)
        with patch("redash.public_execution.enqueue_query") as enqueue:
            self.get("?p_route=MT020")
            res = self.get("?p_route=MT030")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["status"], "stale")
        self.assertEqual(enqueue.call_count, 1)

    def test_capacity_without_a_result_answers_pending(self):
        self.build(vis_options={"publicParameters": {"route": "^MT[0-9A-Z]{3,5}$"}, "publicMaxRunsPerWindow": 1})
        with patch("redash.public_execution.enqueue_query") as enqueue:
            self.get("?p_route=MT020")
            res = self.get("?p_route=MT030")
        self.assertEqual(res.status_code, 202)
        self.assertEqual(enqueue.call_count, 1)

    def test_max_age_is_clamped_and_read_from_the_options(self):
        self.build(
            vis_options={"publicParameters": {"route": "^MT[0-9A-Z]{3,5}$"}, "publicMaxAgeSeconds": 1},
        )
        self.store("SELECT 'MT020'", age=10)
        with patch("redash.public_execution.enqueue_query"):
            res = self.get("?p_route=MT020")
        self.assertEqual(res.json["status"], "fresh")

    def test_the_public_call_reaches_a_real_queue_with_the_public_limits(self):
        from redash.tasks.worker import Queue

        self.build()
        res = self.get("?p_route=MT020")
        self.assertEqual(res.status_code, 202)
        jobs = Queue(self.query.data_source.queue_name, connection=rq_redis_connection).jobs
        job = jobs[-1]
        self.assertEqual(job.timeout, 40)
        self.assertEqual(job.ttl, 20)
        self.assertEqual(job.args[0], "SELECT 'MT020'")
        self.assertEqual(job.kwargs["is_api_key"], True)
        self.assertEqual(job.kwargs["user_id"], self.token)


class TestUnchangedPath(PublicParamsCase):
    def test_a_request_without_p_keys_has_no_status_or_parameters(self):
        self.build()
        latest = self.store("SELECT 'whatever'")
        self.query.latest_query_data = latest
        models.db.session.commit()
        res = self.get("?other=1")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("status", res.json)
        self.assertNotIn("parameters", res.json)
        self.assertEqual(res.json["query_result"]["data"]["rows"], [{"x": "SELECT 'whatever'"}])

    def test_the_legacy_body_matches_bytes_captured_from_the_old_serializer(self):
        import datetime
        import os

        moment = datetime.datetime(2026, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc)
        self.factory.grant_permission("publish_visualization")
        query = self.factory.create_query(
            name="Live route",
            query_text="SELECT 1",
            options={"parameters": [{"name": "route", "type": "enum", "enumOptions": "A\nB", "value": "A"}]},
        )
        result = self.factory.create_query_result(
            data_source=query.data_source,
            data={"columns": [{"name": "x", "friendly_name": "x", "type": "integer"}], "rows": [{"x": 1}]},
            retrieved_at=moment,
        )
        query.latest_query_data = result
        vis = self.factory.create_visualization(
            query_rel=query, name="Map", options={"publicParameters": {"route": "^A$"}}
        )
        vis.created_at = moment
        models.db.session.commit()
        token = self.make_request("post", "/api/visualizations/{}/share".format(vis.id)).json["api_key"]
        models.db.session.execute(
            models.db.text("UPDATE visualizations SET updated_at = :m WHERE id = :i"), {"m": moment, "i": vis.id}
        )
        models.db.session.commit()
        models.db.session.expire_all()
        res = self.get(token=token)
        path = os.path.join(os.path.dirname(__file__), "fixtures", "public_visualization_legacy.json")
        with open(path, "rb") as fixture:
            self.assertEqual(res.data, fixture.read())

    def test_serializer_takes_an_explicit_result_including_none(self):
        from redash.serializers import public_visualization

        self.build()
        latest = self.store("SELECT 'whatever'")
        self.query.latest_query_data = latest
        models.db.session.commit()
        self.assertIsNotNone(public_visualization(self.vis)["query_result"])
        explicit = public_visualization(self.vis, result=None, status="pending", parameters={"route": "MT020"})
        self.assertIsNone(explicit["query_result"])
        self.assertEqual(explicit["status"], "pending")
        self.assertEqual(explicit["parameters"], {"route": "MT020"})
        projected = public_visualization(self.vis, result=latest, status="fresh", parameters={})
        self.assertEqual(projected["query_result"]["data"], latest.data)
        self.assertNotIn("status", public_visualization(self.vis, result=latest))

    def test_a_p_key_on_a_non_opted_in_visualization_is_404_not_legacy(self):
        self.build(vis_options={})
        self.assertEqual(self.get("?p_x=1").status_code, 404)
