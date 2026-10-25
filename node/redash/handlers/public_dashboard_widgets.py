from flask import request
from flask_restful import abort

from redash import models, public_execution
from redash.handlers.base import BaseResource, record_public_read
from redash.security import csp_allows_embeding
from redash.serializers import public_visualization


def find_public_widget(dashboard, widget_id):
    return (
        models.Widget.query.filter(models.Widget.id == widget_id, models.Widget.dashboard_id == dashboard.id)
        .join(models.Visualization)
        .join(models.Query)
        .filter(models.Query.is_archived.is_(False))
        .first()
    )


class PublicDashboardWidgetBase(BaseResource):
    decorators = [csp_allows_embeding]
    kind = "dashboard_widget"

    def resolve_visualization(self, token, widget_id):
        api_key, dashboard, outcome = models.ApiKey.resolve_share_token(token, models.Dashboard, self.current_org)

        if outcome == "ok" and self.current_org.get_setting("disable_public_urls"):
            outcome = "disabled"

        widget = find_public_widget(dashboard, widget_id) if outcome == "ok" else None
        if outcome == "ok" and widget is None:
            outcome = "not_found"

        record_public_read(
            api_key.org if api_key else self.current_org,
            self.current_user,
            self.kind,
            widget.id if widget else None,
            outcome,
            token,
        )

        if outcome != "ok":
            abort(404)

        return widget.visualization


class PublicDashboardWidgetResource(PublicDashboardWidgetBase):
    def get(self, token, widget_id):
        vis = self.resolve_visualization(token, widget_id)

        raw = public_execution.supplied_parameters(request.args)
        if raw is None:
            return public_visualization(vis)

        try:
            return public_execution.respond(vis, token, raw)
        except public_execution.Rejected:
            abort(404)


class PublicDashboardWidgetParameterValuesResource(PublicDashboardWidgetBase):
    kind = "dashboard_widget_values"

    def get(self, token, widget_id, name):
        vis = self.resolve_visualization(token, widget_id)

        try:
            return public_execution.parameter_values(vis, name, request.args.get("q", ""))
        except public_execution.Rejected:
            abort(404)
        except public_execution.Unavailable:
            return (
                {"values": [], "truncated": False},
                503,
                {"Retry-After": public_execution.RETRY_UNAVAILABLE},
            )
