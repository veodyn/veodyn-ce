from flask import request
from funcy import project

from redash import models, utils
from redash.handlers.base import (
    BaseResource,
    get_object_or_404,
    require_fields,
)
from redash.permissions import (
    require_access,
    require_admin_or_owner,
    require_permission,
    view_only,
)
from redash.serializers import serialize_alert
from redash.tasks.alerts import (
    notify_subscriptions,
    should_notify,
)

# The option keys that make up the CONDITION. Deliberately not the whole
# options object: custom_subject and custom_body live in there too and are saved
# through this same endpoint, so treating any options difference as a condition
# change meant that editing only the notification wording reset a triggered
# alert to UNKNOWN. The next evaluation then satisfied `new_state != alert.state`
# and delivered the same alert a second time.
CONDITION_OPTION_KEYS = ("column", "op", "value", "selector")


def _condition_changed(alert, params):
    """Whether this write changes WHAT the alert watches, rather than how it reads."""
    # str() on both sides: a client that posts the unchanged query as "7" rather
    # than 7 means the same foreign key, and resetting on that would re-arm a
    # breached alert for a write that changed nothing.
    if "query_id" in params and str(params["query_id"]) != str(alert.query_id):
        return True
    if "options" not in params:
        return False
    new_options = params["options"] or {}
    old_options = alert.options or {}
    return any(new_options.get(key) != old_options.get(key) for key in CONDITION_OPTION_KEYS)


class AlertResource(BaseResource):
    def get(self, alert_id):
        alert = get_object_or_404(models.Alert.get_by_id_and_org, alert_id, self.current_org)
        require_access(alert, self.current_user, view_only)
        self.record_event({"action": "view", "object_id": alert.id, "object_type": "alert"})
        return serialize_alert(alert)

    def post(self, alert_id):
        req = request.get_json(True)
        params = project(req, ("options", "name", "query_id", "rearm"))
        alert = get_object_or_404(models.Alert.get_by_id_and_org, alert_id, self.current_org)
        require_admin_or_owner(alert.user.id)

        # A rewritten condition has to be judged fresh. should_notify compares
        # the new evaluation against the state left by the OLD condition, so
        # re-arming at a new threshold could suppress the first notification
        # (old state and new state both `triggered`) or emit a recovery
        # belonging to a condition that no longer exists.
        #
        # UNKNOWN rather than OK, deliberately: check_alerts_for_query already
        # skips the UNKNOWN -> OK transition, so this reset cannot manufacture a
        # spurious recovery notification.
        if _condition_changed(alert, params):
            alert.state = models.Alert.UNKNOWN_STATE
            alert.last_triggered_at = None

        self.update_model(alert, params)
        models.db.session.commit()

        self.record_event({"action": "edit", "object_id": alert.id, "object_type": "alert"})

        return serialize_alert(alert)

    def delete(self, alert_id):
        alert = get_object_or_404(models.Alert.get_by_id_and_org, alert_id, self.current_org)
        require_admin_or_owner(alert.user_id)
        models.db.session.delete(alert)
        models.db.session.commit()


class AlertEvaluateResource(BaseResource):
    def post(self, alert_id):
        alert = get_object_or_404(models.Alert.get_by_id_and_org, alert_id, self.current_org)
        require_admin_or_owner(alert.user.id)

        new_state = alert.evaluate()
        if should_notify(alert, new_state):
            alert.state = new_state
            alert.last_triggered_at = utils.utcnow()
            models.db.session.commit()

        notify_subscriptions(alert, new_state, {})
        self.record_event({"action": "evaluate", "object_id": alert.id, "object_type": "alert"})


class AlertMuteResource(BaseResource):
    def post(self, alert_id):
        alert = get_object_or_404(models.Alert.get_by_id_and_org, alert_id, self.current_org)
        require_admin_or_owner(alert.user.id)

        alert.options["muted"] = True
        models.db.session.commit()

        self.record_event({"action": "mute", "object_id": alert.id, "object_type": "alert"})

    def delete(self, alert_id):
        alert = get_object_or_404(models.Alert.get_by_id_and_org, alert_id, self.current_org)
        require_admin_or_owner(alert.user.id)

        alert.options["muted"] = False
        models.db.session.commit()

        self.record_event({"action": "unmute", "object_id": alert.id, "object_type": "alert"})


class AlertListResource(BaseResource):
    def post(self):
        req = request.get_json(True)
        require_fields(req, ("options", "name", "query_id"))

        query = models.Query.get_by_id_and_org(req["query_id"], self.current_org)
        require_access(query, self.current_user, view_only)

        alert = models.Alert(
            name=req["name"],
            query_rel=query,
            user=self.current_user,
            rearm=req.get("rearm"),
            options=req["options"],
        )

        models.db.session.add(alert)
        models.db.session.flush()
        models.db.session.commit()

        self.record_event({"action": "create", "object_id": alert.id, "object_type": "alert"})

        return serialize_alert(alert)

    @require_permission("list_alerts")
    def get(self):
        self.record_event({"action": "list", "object_type": "alert"})
        return [serialize_alert(alert) for alert in models.Alert.all(group_ids=self.current_user.group_ids)]


class AlertSubscriptionListResource(BaseResource):
    def post(self, alert_id):
        req = request.get_json(True)

        alert = models.Alert.get_by_id_and_org(alert_id, self.current_org)
        require_access(alert, self.current_user, view_only)
        kwargs = {"alert": alert, "user": self.current_user}

        if "destination_id" in req:
            destination = models.NotificationDestination.get_by_id_and_org(req["destination_id"], self.current_org)
            kwargs["destination"] = destination

        subscription = models.AlertSubscription(**kwargs)
        models.db.session.add(subscription)
        models.db.session.commit()

        self.record_event(
            {
                "action": "subscribe",
                "object_id": alert_id,
                "object_type": "alert",
                "destination": req.get("destination_id"),
            }
        )

        d = subscription.to_dict()
        return d

    def get(self, alert_id):
        alert = models.Alert.get_by_id_and_org(alert_id, self.current_org)
        require_access(alert, self.current_user, view_only)

        subscriptions = models.AlertSubscription.all(alert_id)
        return [s.to_dict() for s in subscriptions]


class AlertSubscriptionResource(BaseResource):
    def delete(self, alert_id, subscriber_id):
        subscription = models.AlertSubscription.query.get_or_404(subscriber_id)
        require_admin_or_owner(subscription.user.id)
        models.db.session.delete(subscription)
        models.db.session.commit()

        self.record_event({"action": "unsubscribe", "object_id": alert_id, "object_type": "alert"})
