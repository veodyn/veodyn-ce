import datetime

from mock import patch

from redash.models import Alert, AlertSubscription, db
from redash.utils import utcnow
from tests import BaseTestCase


class TestAlertResourceGet(BaseTestCase):
    def test_returns_200_if_allowed(self):
        alert = self.factory.create_alert()

        rv = self.make_request("get", "/api/alerts/{}".format(alert.id))
        self.assertEqual(rv.status_code, 200)

    def test_returns_403_if_not_allowed(self):
        data_source = self.factory.create_data_source(group=self.factory.create_group())
        query = self.factory.create_query(data_source=data_source)
        alert = self.factory.create_alert(query_rel=query)
        db.session.commit()
        rv = self.make_request("get", "/api/alerts/{}".format(alert.id))
        self.assertEqual(rv.status_code, 403)

    def test_returns_404_if_admin_from_another_org(self):
        second_org = self.factory.create_org()
        second_org_admin = self.factory.create_admin(org=second_org)

        alert = self.factory.create_alert()

        rv = self.make_request(
            "get",
            "/api/alerts/{}".format(alert.id),
            org=second_org,
            user=second_org_admin,
        )
        self.assertEqual(rv.status_code, 404)


class TestAlertResourcePost(BaseTestCase):
    def test_updates_alert(self):
        alert = self.factory.create_alert()
        rv = self.make_request("post", "/api/alerts/{}".format(alert.id), data={"name": "Testing"})
        self.assertEqual(rv.status_code, 200)


class TestAlertEvaluateResource(BaseTestCase):
    @patch("redash.handlers.alerts.notify_subscriptions")
    def test_evaluates_alert_and_notifies(self, mock_notify_subscriptions):
        query = self.factory.create_query(
            data_source=self.factory.create_data_source(group=self.factory.create_group())
        )
        retrieved_at = utcnow() - datetime.timedelta(days=1)
        query_result = self.factory.create_query_result(
            retrieved_at=retrieved_at,
            query_text=query.query_text,
            query_hash=query.query_hash,
        )
        query.latest_query_data = query_result
        alert = self.factory.create_alert(query_rel=query)
        rv = self.make_request("post", "/api/alerts/{}/eval".format(alert.id))

        self.assertEqual(rv.status_code, 200)
        mock_notify_subscriptions.assert_called()


class TestAlertResourceDelete(BaseTestCase):
    def test_removes_alert_and_subscriptions(self):
        subscription = self.factory.create_alert_subscription()
        alert = subscription.alert
        db.session.commit()
        rv = self.make_request("delete", "/api/alerts/{}".format(alert.id))
        self.assertEqual(rv.status_code, 200)

        self.assertEqual(Alert.query.get(subscription.alert.id), None)
        self.assertEqual(AlertSubscription.query.get(subscription.id), None)

    def test_returns_403_if_not_allowed(self):
        alert = self.factory.create_alert()

        user = self.factory.create_user()
        rv = self.make_request("delete", "/api/alerts/{}".format(alert.id), user=user)
        self.assertEqual(rv.status_code, 403)

        rv = self.make_request(
            "delete",
            "/api/alerts/{}".format(alert.id),
            user=self.factory.create_admin(),
        )
        self.assertEqual(rv.status_code, 200)

    def test_returns_404_for_unauthorized_users(self):
        alert = self.factory.create_alert()

        second_org = self.factory.create_org()
        second_org_admin = self.factory.create_admin(org=second_org)
        rv = self.make_request("delete", "/api/alerts/{}".format(alert.id), user=second_org_admin)
        self.assertEqual(rv.status_code, 404)


class TestAlertListGet(BaseTestCase):
    def test_returns_all_alerts(self):
        alert = self.factory.create_alert()
        rv = self.make_request("get", "/api/alerts")

        self.assertEqual(rv.status_code, 200)

        alert_ids = [a["id"] for a in rv.json]
        self.assertIn(alert.id, alert_ids)

    def test_returns_alerts_only_from_users_groups(self):
        alert = self.factory.create_alert()
        query = self.factory.create_query(
            data_source=self.factory.create_data_source(group=self.factory.create_group())
        )
        alert2 = self.factory.create_alert(query_rel=query)
        rv = self.make_request("get", "/api/alerts")

        self.assertEqual(rv.status_code, 200)

        alert_ids = [a["id"] for a in rv.json]
        self.assertIn(alert.id, alert_ids)
        self.assertNotIn(alert2.id, alert_ids)


class TestAlertListPost(BaseTestCase):
    def test_returns_200_if_has_access_to_query(self):
        query = self.factory.create_query()
        destination = self.factory.create_destination()
        db.session.commit()
        rv = self.make_request(
            "post",
            "/api/alerts",
            data=dict(
                name="Alert",
                query_id=query.id,
                destination_id=destination.id,
                options={},
                rearm=100,
            ),
        )
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(rv.json["rearm"], 100)

    def test_fails_if_doesnt_have_access_to_query(self):
        data_source = self.factory.create_data_source(group=self.factory.create_group())
        query = self.factory.create_query(data_source=data_source)
        destination = self.factory.create_destination()
        db.session.commit()
        rv = self.make_request(
            "post",
            "/api/alerts",
            data=dict(
                name="Alert",
                query_id=query.id,
                destination_id=destination.id,
                options={},
            ),
        )
        self.assertEqual(rv.status_code, 403)


class TestAlertSubscriptionListResourcePost(BaseTestCase):
    def test_subscribers_user_to_alert(self):
        alert = self.factory.create_alert()
        destination = self.factory.create_destination()

        rv = self.make_request(
            "post",
            "/api/alerts/{}/subscriptions".format(alert.id),
            data=dict(destination_id=destination.id),
        )
        self.assertEqual(rv.status_code, 200)
        self.assertIn(self.factory.user, alert.subscribers())

    def test_doesnt_subscribers_user_to_alert_without_access(self):
        data_source = self.factory.create_data_source(group=self.factory.create_group())
        query = self.factory.create_query(data_source=data_source)
        alert = self.factory.create_alert(query_rel=query)
        destination = self.factory.create_destination()

        rv = self.make_request(
            "post",
            "/api/alerts/{}/subscriptions".format(alert.id),
            data=dict(destination_id=destination.id),
        )
        self.assertEqual(rv.status_code, 403)
        self.assertNotIn(self.factory.user, alert.subscribers())


class TestAlertSubscriptionListResourceGet(BaseTestCase):
    def test_returns_subscribers(self):
        alert = self.factory.create_alert()

        rv = self.make_request("get", "/api/alerts/{}/subscriptions".format(alert.id))
        self.assertEqual(rv.status_code, 200)

    def test_doesnt_return_subscribers_when_not_allowed(self):
        data_source = self.factory.create_data_source(group=self.factory.create_group())
        query = self.factory.create_query(data_source=data_source)
        alert = self.factory.create_alert(query_rel=query)

        rv = self.make_request("get", "/api/alerts/{}/subscriptions".format(alert.id))
        self.assertEqual(rv.status_code, 403)


class TestAlertSubscriptionresourceDelete(BaseTestCase):
    def test_only_subscriber_or_admin_can_unsubscribe(self):
        subscription = self.factory.create_alert_subscription()
        alert = subscription.alert
        user = subscription.user
        path = "/api/alerts/{}/subscriptions/{}".format(alert.id, subscription.id)

        other_user = self.factory.create_user()

        response = self.make_request("delete", path, user=other_user)
        self.assertEqual(response.status_code, 403)

        response = self.make_request("delete", path, user=user)
        self.assertEqual(response.status_code, 200)

        subscription_two = AlertSubscription(alert=alert, user=other_user)
        admin_user = self.factory.create_admin()
        db.session.add_all([subscription_two, admin_user])
        db.session.commit()
        path = "/api/alerts/{}/subscriptions/{}".format(alert.id, subscription_two.id)
        response = self.make_request("delete", path, user=admin_user)
        self.assertEqual(response.status_code, 200)


class TestAlertOptionsPassThrough(BaseTestCase):
    def test_unknown_option_keys_survive_create_and_read(self):
        # Incidental behaviour today, and a link depends on it: veodyn-api
        # stamps `kpi_id` into an alert's options so a managed alert can say
        # which KPI it belongs to. AlertListResource.post stores req["options"]
        # verbatim and serialize_alert returns the whole dict. If upstream ever
        # adds option validation this test names the cause.
        query = self.factory.create_query()
        db.session.commit()
        options = {"column": "foo", "op": "<", "value": 5, "selector": "last", "kpi_id": "on-time-performance"}
        rv = self.make_request("post", "/api/alerts", data=dict(name="Alert", query_id=query.id, options=options))
        self.assertEqual(rv.status_code, 200)
        self.assertEqual(rv.json["options"]["kpi_id"], "on-time-performance")
        self.assertEqual(rv.json["options"]["selector"], "last")

        rv = self.make_request("get", "/api/alerts/{}".format(rv.json["id"]))
        self.assertEqual(rv.json["options"]["kpi_id"], "on-time-performance")


class TestAlertConditionChangeResetsState(BaseTestCase):
    def test_new_options_clear_the_carried_over_state(self):
        # should_notify compares the new evaluation against the state left by
        # the OLD condition, and AlertResource.post could rewrite options but
        # not state. Re-arming at a new threshold could therefore suppress the
        # first notification (old and new both `triggered`) or emit a recovery
        # belonging to a condition that no longer exists.
        alert = self.factory.create_alert(options={"column": "foo", "op": "<", "value": 5})
        alert.state = Alert.TRIGGERED_STATE
        alert.last_triggered_at = utcnow()
        db.session.commit()

        rv = self.make_request(
            "post",
            "/api/alerts/{}".format(alert.id),
            data={"options": {"column": "foo", "op": "<", "value": 9}},
        )

        self.assertEqual(rv.status_code, 200)
        # UNKNOWN, not OK. check_alerts_for_query skips the UNKNOWN -> OK
        # notification, so resetting this way cannot manufacture a spurious
        # recovery message.
        self.assertEqual(alert.state, Alert.UNKNOWN_STATE)
        self.assertIsNone(alert.last_triggered_at)

    def test_a_new_query_id_clears_it_too(self):
        alert = self.factory.create_alert(options={"column": "foo", "op": "<", "value": 5})
        alert.state = Alert.OK_STATE
        other = self.factory.create_query()
        db.session.commit()

        rv = self.make_request("post", "/api/alerts/{}".format(alert.id), data={"query_id": other.id})

        self.assertEqual(rv.status_code, 200)
        self.assertEqual(alert.state, Alert.UNKNOWN_STATE)

    def test_an_unrelated_edit_leaves_the_state_alone(self):
        alert = self.factory.create_alert(options={"column": "foo", "op": "<", "value": 5})
        alert.state = Alert.TRIGGERED_STATE
        triggered_at = utcnow()
        alert.last_triggered_at = triggered_at
        db.session.commit()

        rv = self.make_request("post", "/api/alerts/{}".format(alert.id), data={"name": "Renamed"})

        self.assertEqual(rv.status_code, 200)
        self.assertEqual(alert.state, Alert.TRIGGERED_STATE)
        self.assertEqual(alert.last_triggered_at, triggered_at)

    def test_editing_only_the_notification_wording_does_not_re_arm_the_alert(self):
        # custom_subject and custom_body live in `options` and are saved through
        # this same endpoint (client/app/pages/alert/AlertEdit.jsx passes them to
        # onNotificationTemplateChange, which merges them into options). A reset
        # keyed on "options differs at all" therefore fired on a pure wording
        # edit: the alert dropped to UNKNOWN, and the very next evaluation
        # satisfied `new_state != alert.state` and delivered the SAME alert a
        # second time. Only the condition keys count.
        alert = self.factory.create_alert(
            options={"column": "foo", "op": "<", "value": 5, "custom_subject": "before"}
        )
        alert.state = Alert.TRIGGERED_STATE
        triggered_at = utcnow()
        alert.last_triggered_at = triggered_at
        db.session.commit()

        rv = self.make_request(
            "post",
            "/api/alerts/{}".format(alert.id),
            data={"options": {"column": "foo", "op": "<", "value": 5, "custom_subject": "after"}},
        )

        self.assertEqual(rv.status_code, 200)
        self.assertEqual(alert.options["custom_subject"], "after")
        self.assertEqual(alert.state, Alert.TRIGGERED_STATE)
        self.assertEqual(alert.last_triggered_at, triggered_at)

    def test_reposting_the_same_query_id_as_a_string_does_not_re_arm_the_alert(self):
        # "7" and 7 name the same foreign key. Comparing them raw made a write
        # that changed nothing reset a breached alert, which then notified again.
        alert = self.factory.create_alert(options={"column": "foo", "op": "<", "value": 5})
        alert.state = Alert.TRIGGERED_STATE
        db.session.commit()

        rv = self.make_request(
            "post", "/api/alerts/{}".format(alert.id), data={"query_id": str(alert.query_id)}
        )

        self.assertEqual(rv.status_code, 200)
        self.assertEqual(alert.state, Alert.TRIGGERED_STATE)
