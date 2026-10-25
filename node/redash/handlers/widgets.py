from flask import request

from redash import models
from redash.handlers.base import BaseResource
from redash.handlers.idempotency import (
    commit_or_winner,
    pop_key,
    record,
    refuse_different_request,
    replay_or_none,
)
from redash.handlers.preconditions import check_unchanged, pop_expected
from redash.permissions import (
    require_access,
    require_object_modify_permission,
    require_permission,
    view_only,
)
from redash.serializers import serialize_widget


class WidgetListResource(BaseResource):
    @require_permission("edit_dashboard")
    def post(self):
        """
        Add a widget to a dashboard.

        :<json number dashboard_id: The ID for the dashboard being added to
        :<json visualization_id: The ID of the visualization to put in this widget
        :<json object options: Widget options
        :<json string text: Text box contents
        :<json number width: Width for widget display

        :>json object widget: The created widget
        """
        widget_properties = request.get_json(force=True)
        key = pop_key(widget_properties)
        dashboard = models.Dashboard.get_by_id_and_org(widget_properties.get("dashboard_id"), self.current_org)
        require_object_modify_permission(dashboard, self.current_user)

        widget_properties.pop("id", None)

        visualization_id = widget_properties.pop("visualization_id")
        if visualization_id:
            visualization = models.Visualization.get_by_id_and_org(visualization_id, self.current_org)
            require_access(visualization.query_rel, self.current_user, view_only)
        else:
            visualization = None

        def check(recorded):
            if recorded.dashboard_id != dashboard.id or recorded.visualization_id != (
                visualization.id if visualization else None
            ):
                refuse_different_request()
            require_object_modify_permission(recorded.dashboard, self.current_user)
            if recorded.visualization:
                require_access(recorded.visualization.query_rel, self.current_user, view_only)

        existing = replay_or_none(self.current_org, self.current_user, key, models.Widget, check)
        if existing is not None:
            return serialize_widget(existing)

        widget_properties["visualization"] = visualization

        widget = models.Widget(**widget_properties)
        models.db.session.add(widget)
        record(self.current_org, self.current_user, key, models.Widget.__tablename__, widget)

        winner = commit_or_winner(self.current_org, self.current_user, key, models.Widget, check)
        if winner is not None:
            return serialize_widget(winner)
        return serialize_widget(widget)


class WidgetResource(BaseResource):
    @require_permission("edit_dashboard")
    def post(self, widget_id):
        """
        Updates a widget in a dashboard.
        This method currently handles Text Box widgets only.

        :param number widget_id: The ID of the widget to modify

        :<json string text: The new contents of the text box
        """
        widget = models.Widget.get_by_id_and_org(widget_id, self.current_org)
        require_object_modify_permission(widget.dashboard, self.current_user)
        widget_properties = request.get_json(force=True)
        check_unchanged(models.Widget, widget.id, pop_expected(widget_properties))
        widget.text = widget_properties["text"]
        widget.options = widget_properties["options"]
        models.db.session.commit()
        return serialize_widget(widget)

    @require_permission("edit_dashboard")
    def delete(self, widget_id):
        """
        Remove a widget from a dashboard.

        :param number widget_id: ID of widget to remove
        """
        widget = models.Widget.get_by_id_and_org(widget_id, self.current_org)
        require_object_modify_permission(widget.dashboard, self.current_user)
        check_unchanged(models.Widget, widget.id, request.args.get("expected_updated_at"))
        self.record_event({"action": "delete", "object_id": widget_id, "object_type": "widget"})
        models.db.session.delete(widget)
        models.db.session.commit()
