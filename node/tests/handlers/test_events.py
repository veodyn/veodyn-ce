"""POST /api/events is open to any authenticated user, and has to stay that way.

The browser posts page views there on every navigation, so locking the route
would end the product's own analytics. What must not stay open is the ability to
write a row an auditor would read as the server's own: this fork made the events
table the record of privilege changes (handlers/groups.py "change_permissions",
handlers/dashboards.py and handlers/visualizations.py "activate_api_key" /
"deactivate_api_key") and of every anonymous read of a shared link
(handlers/base.record_public_read).
"""

import time
from unittest.mock import patch

from redash.authentication import log_user_logged_in
from redash.handlers.base import record_public_read
from redash.handlers.events import serialize_event
from redash.models import Event, db
from tests import BaseTestCase


def recorded(task):
    """The event payloads handed to the RQ job, in order."""
    return [call[0][0] for call in task.delay.call_args_list]


class TestEventsResourcePageViews(BaseTestCase):
    """The path client/app/services/recordEvent.js actually uses."""

    def test_records_the_batch_the_client_posts(self):
        batch = [
            {
                "action": "view",
                "object_type": "page",
                "object_id": "personal_homepage",
                "timestamp": 1700000000.0,
                "screen_resolution": "1440x900",
            },
            {
                "action": "view",
                "object_type": "dashboard",
                "object_id": 7,
                "timestamp": 1700000001.0,
            },
        ]

        with patch("redash.handlers.base.record_event_task") as task:
            rv = self.make_request("post", "/api/events", data=batch)

        self.assertEqual(rv.status_code, 200)

        events = recorded(task)
        self.assertEqual([e["action"] for e in events], ["view", "view"])
        self.assertEqual([e["object_type"] for e in events], ["page", "dashboard"])
        self.assertEqual([e["object_id"] for e in events], ["personal_homepage", 7])
        self.assertEqual([e["user_id"] for e in events], [self.factory.user.id] * 2)
        self.assertEqual(events[0]["screen_resolution"], "1440x900")

    def test_marks_every_event_it_accepts_as_client_submitted(self):
        with patch("redash.handlers.base.record_event_task") as task:
            rv = self.make_request(
                "post",
                "/api/events",
                data=[{"action": "view", "object_type": "page", "object_id": "personal_homepage"}],
            )

        self.assertEqual(rv.status_code, 200)
        self.assertIs(recorded(task)[0]["client_submitted"], True)


class TestEventsResourceForgery(BaseTestCase):
    def post_events(self, batch, user=None):
        with patch("redash.handlers.base.record_event_task") as task:
            rv = self.make_request("post", "/api/events", data=batch, user=user)
        return rv, recorded(task)

    def test_refuses_the_privilege_change_actions(self):
        for action in ("change_permissions", "activate_api_key", "deactivate_api_key"):
            with self.subTest(action=action):
                rv, events = self.post_events([{"action": action, "object_type": "group", "object_id": 1}])

                self.assertEqual(rv.status_code, 400)
                self.assertEqual(events, [])

    def test_refuses_the_whole_batch_so_a_forgery_cannot_ride_along(self):
        rv, events = self.post_events(
            [
                {"action": "view", "object_type": "page", "object_id": "personal_homepage"},
                {"action": "change_permissions", "object_type": "group", "object_id": 1},
            ]
        )

        self.assertEqual(rv.status_code, 400)
        self.assertEqual(events, [])

    def test_cannot_claim_an_event_was_recorded_by_the_server(self):
        rv, events = self.post_events(
            [
                {
                    "action": "view",
                    "object_type": "page",
                    "object_id": "personal_homepage",
                    "client_submitted": False,
                }
            ]
        )

        self.assertEqual(rv.status_code, 200)
        self.assertIs(events[0]["client_submitted"], True)

    def test_a_forged_public_read_stays_distinguishable(self):
        """A public read is action "view" on a dashboard, which is also a real
        client page view, so it cannot be refused by name. The marker is what
        separates the two."""
        rv, events = self.post_events(
            [
                {
                    "action": "view",
                    "object_type": "dashboard",
                    "object_id": 7,
                    "public": True,
                    "outcome": "served",
                    "token_fingerprint": "0" * 64,
                }
            ]
        )

        self.assertEqual(rv.status_code, 200)
        self.assertIs(events[0]["client_submitted"], True)

    def test_refuses_a_body_that_is_not_a_list_of_events(self):
        for body in ({"action": "view"}, ["view"], [None]):
            with self.subTest(body=body):
                rv, events = self.post_events(body)

                self.assertEqual(rv.status_code, 400)
                self.assertEqual(events, [])


class TestServerRecordedEventsAreStamped(BaseTestCase):
    """Absence of the marker cannot mean "the server wrote this".

    Every row written before the marker existed lacks it, so a reader that
    treats a missing marker as proof of a server write is reading every
    historical page view, and every historical forgery, as the server's own.
    The server has to say so explicitly for the claim to mean anything.
    """

    def test_a_permission_change_is_stamped_as_server_recorded(self):
        admin = self.factory.create_admin()
        group = self.factory.create_group(permissions=["view_query"])
        db.session.commit()

        with patch("redash.handlers.base.record_event_task") as task:
            rv = self.make_request(
                "post",
                "/api/groups/{}".format(group.id),
                data={"name": group.name, "permissions": ["view_query", "list_users"]},
                user=admin,
            )

        self.assertEqual(rv.status_code, 200)

        changes = [e for e in recorded(task) if e["action"] == "change_permissions"]
        self.assertEqual(len(changes), 1)
        self.assertIs(changes[0]["client_submitted"], False)

    def test_an_ordinary_handler_event_is_stamped_as_server_recorded(self):
        with patch("redash.handlers.base.record_event_task") as task:
            rv = self.make_request("get", "/api/dashboards")

        self.assertEqual(rv.status_code, 200)
        self.assertTrue(recorded(task))
        self.assertTrue(all(e["client_submitted"] is False for e in recorded(task)))

    def test_a_public_read_is_stamped_as_server_recorded(self):
        with self.app.test_request_context("/"):
            with patch("redash.handlers.base.record_event_task") as task:
                record_public_read(self.factory.org, self.factory.user, "dashboard", 7, "served", "a-token")

        self.assertIs(recorded(task)[0]["client_submitted"], False)

    def test_a_login_is_stamped_as_server_recorded(self):
        # authentication.log_user_logged_in enqueues the task itself rather than
        # going through handlers.base.record_event, so it needs its own stamp
        # and its own guard.
        with self.app.test_request_context("/"):
            with patch("redash.authentication.record_event") as task:
                log_user_logged_in(self.app, self.factory.user)

        self.assertIs(recorded(task)[0]["client_submitted"], False)


class TestSerializeEvent(BaseTestCase):
    def record(self, **extra):
        payload = {
            "org_id": self.factory.org.id,
            "user_id": self.factory.user.id,
            "action": "view",
            "object_type": "page",
            "object_id": "personal_homepage",
            "timestamp": int(time.time()),
        }
        payload.update(extra)

        event = Event.record(payload)
        db.session.commit()
        return event

    def test_reports_an_event_the_client_submitted(self):
        self.assertIs(serialize_event(self.record(client_submitted=True))["client_submitted"], True)

    def test_reports_an_event_the_server_stamped_as_its_own(self):
        self.assertIs(serialize_event(self.record(client_submitted=False))["client_submitted"], False)

    def test_never_reports_an_unstamped_legacy_row_as_server_recorded(self):
        # The regression this file exists for. Every row written before the
        # stamp carries no marker at all, and reading that as "the server wrote
        # it" launders every historical page view, and any historical forgery,
        # into the audit trail as trusted.
        legacy = serialize_event(self.record())["client_submitted"]

        self.assertIsNot(legacy, False)
        self.assertIsNone(legacy)

    def test_reports_a_marker_it_cannot_read_as_unknown(self):
        # Before the client route stamped anything, whatever the browser posted
        # landed in additional_properties verbatim, so a legacy row can carry
        # any value at all under this key. Only the two booleans the server
        # writes are provenance; anything else is unknown.
        for junk in ("false", "server", 0, [], {}):
            with self.subTest(junk=junk):
                self.assertIsNone(serialize_event(self.record(client_submitted=junk))["client_submitted"])
