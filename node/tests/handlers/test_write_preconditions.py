from unittest.mock import patch
from urllib.parse import quote

from werkzeug.exceptions import HTTPException

from redash import models
from redash.handlers.preconditions import check_unchanged
from redash.permissions import require_object_modify_permission
from tests import BaseTestCase

STALE_MESSAGE = "This object changed since it was read."


class PreconditionCases:
    def make(self):
        raise NotImplementedError

    def url(self, obj):
        raise NotImplementedError

    def read_updated_at(self, obj):
        raise NotImplementedError

    def edit(self, n):
        raise NotImplementedError

    def stored_marker(self, obj):
        raise NotImplementedError

    def still_present(self, obj):
        raise NotImplementedError

    def marker(self, n):
        return "edited {}".format(n)

    def post(self, obj, n, **extra):
        data = self.edit(n)
        data.update(extra)
        return self.make_request("post", self.url(obj), data=data)

    def delete_with(self, obj, expected):
        return self.make_request("delete", "{}?expected_updated_at={}".format(self.url(obj), quote(expected)))

    def test_round_trip_is_accepted(self):
        obj = self.make()
        updated_at = self.read_updated_at(obj)

        rv = self.post(obj, 1, expected_updated_at=updated_at)

        self.assertEqual(rv.status_code, 200)
        models.db.session.expire_all()
        self.assertEqual(self.stored_marker(obj), self.marker(1))

    def test_stale_is_refused(self):
        obj = self.make()
        first_read = self.read_updated_at(obj)
        self.assertEqual(self.post(obj, 1).status_code, 200)

        rv = self.post(obj, 2, expected_updated_at=first_read)

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], STALE_MESSAGE)
        models.db.session.expire_all()
        self.assertEqual(self.stored_marker(obj), self.marker(1))

    def test_absent_field_unchanged(self):
        obj = self.make()
        self.assertEqual(self.post(obj, 1).status_code, 200)

        rv = self.post(obj, 2)

        self.assertEqual(rv.status_code, 200)
        models.db.session.expire_all()
        self.assertEqual(self.stored_marker(obj), self.marker(2))

    def test_response_updated_at_chains_into_the_next_edit(self):
        obj = self.make()

        first = self.post(obj, 1, expected_updated_at=self.read_updated_at(obj))
        second = self.post(obj, 2, expected_updated_at=first.json["updated_at"])

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        models.db.session.expire_all()
        self.assertEqual(self.stored_marker(obj), self.marker(2))

    def test_delete_stale_is_refused(self):
        obj = self.make()
        first_read = self.read_updated_at(obj)
        self.assertEqual(self.post(obj, 1).status_code, 200)

        rv = self.delete_with(obj, first_read)

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], STALE_MESSAGE)
        models.db.session.expire_all()
        self.assertTrue(self.still_present(obj))

    def test_delete_with_current_value_is_accepted(self):
        obj = self.make()

        rv = self.delete_with(obj, self.read_updated_at(obj))

        self.assertEqual(rv.status_code, 200)
        models.db.session.expire_all()
        self.assertFalse(self.still_present(obj))


class TestQueryPrecondition(PreconditionCases, BaseTestCase):
    def make(self):
        return self.factory.create_query()

    def url(self, obj):
        return "/api/queries/{}".format(obj.id)

    def read_updated_at(self, obj):
        return self.make_request("get", self.url(obj)).json["updated_at"]

    def edit(self, n):
        return {"name": self.marker(n)}

    def stored_marker(self, obj):
        return models.Query.query.get(obj.id).name

    def still_present(self, obj):
        return not models.Query.query.get(obj.id).is_archived


class TestVisualizationPrecondition(PreconditionCases, BaseTestCase):
    def make(self):
        return self.factory.create_visualization()

    def url(self, obj):
        return "/api/visualizations/{}".format(obj.id)

    def read_updated_at(self, obj):
        query = self.make_request("get", "/api/queries/{}".format(obj.query_id)).json
        return next(v for v in query["visualizations"] if v["id"] == obj.id)["updated_at"]

    def edit(self, n):
        return {"name": self.marker(n)}

    def stored_marker(self, obj):
        return models.Visualization.query.get(obj.id).name

    def still_present(self, obj):
        return models.Visualization.query.get(obj.id) is not None


class TestWidgetPrecondition(PreconditionCases, BaseTestCase):
    def make(self):
        return self.factory.create_widget()

    def url(self, obj):
        return "/api/widgets/{}".format(obj.id)

    def read_updated_at(self, obj):
        dashboard = self.make_request("get", "/api/dashboards/{}".format(obj.dashboard_id)).json
        return next(w for w in dashboard["widgets"] if w["id"] == obj.id)["updated_at"]

    def edit(self, n):
        return {"text": self.marker(n), "options": {}}

    def stored_marker(self, obj):
        return models.Widget.query.get(obj.id).text

    def still_present(self, obj):
        return models.Widget.query.get(obj.id) is not None


class TestDashboardPrecondition(PreconditionCases, BaseTestCase):
    def make(self):
        return self.factory.create_dashboard()

    def url(self, obj):
        return "/api/dashboards/{}".format(obj.id)

    def read_updated_at(self, obj):
        return self.make_request("get", self.url(obj)).json["updated_at"]

    def edit(self, n):
        return {"name": self.marker(n)}

    def stored_marker(self, obj):
        return models.Dashboard.query.get(obj.id).name

    def still_present(self, obj):
        return not models.Dashboard.query.get(obj.id).is_archived


class TestSnippetPrecondition(PreconditionCases, BaseTestCase):
    def make(self):
        return self.factory.create_query_snippet()

    def url(self, obj):
        return "/api/query_snippets/{}".format(obj.id)

    def read_updated_at(self, obj):
        return self.make_request("get", self.url(obj)).json["updated_at"]

    def edit(self, n):
        return {"description": self.marker(n)}

    def stored_marker(self, obj):
        return models.QuerySnippet.query.get(obj.id).description

    def still_present(self, obj):
        return models.QuerySnippet.query.get(obj.id) is not None


class TestRowGoneDuringCheck(BaseTestCase):
    def test_missing_row_is_a_stale_write(self):
        with self.assertRaises(HTTPException) as raised:
            check_unchanged(models.Widget, 999999, "2026-10-24T10:00:00.000Z")

        self.assertEqual(raised.exception.code, 409)

    def test_widget_deleted_after_the_handler_loaded_it(self):
        widget = self.factory.create_widget()
        widget_id = widget.id
        updated_at = self.make_request("get", "/api/dashboards/{}".format(widget.dashboard_id)).json["widgets"][0][
            "updated_at"
        ]

        def permit_then_delete(obj, user):
            require_object_modify_permission(obj, user)
            models.db.session.execute(models.db.text("delete from widgets where id = :id"), {"id": widget_id})

        with patch("redash.handlers.widgets.require_object_modify_permission", permit_then_delete):
            rv = self.make_request(
                "post",
                "/api/widgets/{}".format(widget_id),
                data={"text": "t", "options": {}, "expected_updated_at": updated_at},
            )

        self.assertEqual(rv.status_code, 409)
        self.assertEqual(rv.json["message"], STALE_MESSAGE)
