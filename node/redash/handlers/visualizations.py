from flask import request
from flask_restful import abort

from redash import models
from redash.handlers.base import (
    BaseResource,
    get_object_or_404,
    parse_expires_at,
    record_public_read,
)
from redash.permissions import (
    require_admin_or_owner,
    require_any_of_permission,
    require_object_modify_permission,
    require_permission,
)
from redash.security import csp_allows_embeding
from redash.serializers import public_visualization, serialize_visualization


class VisualizationListResource(BaseResource):
    @require_permission("edit_query")
    def post(self):
        kwargs = request.get_json(force=True)

        query = get_object_or_404(models.Query.get_by_id_and_org, kwargs.pop("query_id"), self.current_org)
        require_object_modify_permission(query, self.current_user)

        kwargs["query_rel"] = query

        vis = models.Visualization(**kwargs)
        models.db.session.add(vis)
        models.db.session.commit()
        return serialize_visualization(vis, with_query=False)


class VisualizationResource(BaseResource):
    @require_permission("edit_query")
    def post(self, visualization_id):
        vis = get_object_or_404(models.Visualization.get_by_id_and_org, visualization_id, self.current_org)
        require_object_modify_permission(vis.query_rel, self.current_user)

        kwargs = request.get_json(force=True)

        kwargs.pop("id", None)
        kwargs.pop("query_id", None)

        self.update_model(vis, kwargs)
        d = serialize_visualization(vis, with_query=False)
        models.db.session.commit()
        return d

    @require_permission("edit_query")
    def delete(self, visualization_id):
        vis = get_object_or_404(models.Visualization.get_by_id_and_org, visualization_id, self.current_org)
        require_object_modify_permission(vis.query_rel, self.current_user)
        self.record_event(
            {
                "action": "delete",
                "object_id": visualization_id,
                "object_type": "Visualization",
            }
        )
        # Same transaction as the delete. ApiKey reaches the visualization
        # through a generic foreign key with no cascade, so a key left behind
        # is a live credential for a row that no longer exists, and the share
        # endpoint can no longer load the visualization in order to revoke it.
        models.ApiKey.deactivate_for_object(vis)
        models.db.session.delete(vis)
        models.db.session.commit()


class VisualizationShareResource(BaseResource):
    @require_any_of_permission(("admin", "publish_visualization"))
    def post(self, visualization_id):
        """
        Allow anonymous access to a visualization.

        :param visualization_id: The numeric ID of the visualization to share.
        :<json string expires_at: Optional ISO 8601 time after which the link stops working.
        :>json api_key: The token to use when reading it anonymously.

        No public_url is returned: the viewer page is served by the frontend,
        which composes the URL from this token.
        """
        vis = get_object_or_404(models.Visualization.get_by_id_and_org, visualization_id, self.current_org)
        require_admin_or_owner(vis.query_rel.user_id)

        if self.current_org.get_setting("disable_public_urls"):
            abort(400, message="Public URLs are disabled.")

        expires_at = parse_expires_at(request.get_json(force=True, silent=True))

        # Idempotent on purpose, and this is the default path rather than an
        # edge case here: nothing the frontend reads carries the token until
        # the owning query is refetched, so the dialog offers "create" on every
        # open. A bare create would mint one orphan per click, each of them a
        # live external link revocation could not reach. Assigning expires_at
        # to the returned key is therefore how the terms of that one link
        # change, and an absent expires_at clears a previously set expiry.
        try:
            api_key = models.ApiKey.get_or_create_for_object(vis, self.current_user)
        except models.ApiKey.TargetArchived:
            # Two ways to be gone, and both raise this. Either the query is
            # archived, which is what takes a visualization out of the product
            # since it carries no flag of its own, or the visualization row was
            # deleted while this request queued on the per object lock behind
            # the delete. See DashboardShareResource.post for why the answer is
            # 404 rather than 400.
            abort(404)

        api_key.expires_at = expires_at
        models.db.session.flush()
        models.db.session.commit()

        self.record_event(
            {
                "action": "activate_api_key",
                "object_id": vis.id,
                "object_type": "visualization",
            }
        )

        return {"api_key": api_key.api_key, "expires_at": api_key.expires_at}

    @require_any_of_permission(("admin", "publish_visualization"))
    def delete(self, visualization_id):
        """
        Disable anonymous access to a visualization.

        :param visualization_id: The numeric ID of the visualization to unshare.
        """
        vis = get_object_or_404(models.Visualization.get_by_id_and_org, visualization_id, self.current_org)
        require_admin_or_owner(vis.query_rel.user_id)
        # Every live key, not just the first. See the dashboard resource: a
        # visualization shared twice before minting became idempotent carries
        # an orphan nothing in the UI can show or withdraw.
        revoked = models.ApiKey.deactivate_for_object(vis)

        if revoked:
            models.db.session.commit()

        self.record_event(
            {
                "action": "deactivate_api_key",
                "object_id": vis.id,
                "object_type": "visualization",
            }
        )


class PublicVisualizationResource(BaseResource):
    # See PublicDashboardResource: not login_required, so that a token which
    # does not resolve still reaches the handler and gets recorded.
    decorators = [csp_allows_embeding]

    def get(self, token):
        """
        Retrieve a public visualization and its query's latest result.

        :param token: A share token for a visualization.
        """
        api_key, vis, outcome = models.ApiKey.resolve_share_token(token, models.Visualization, self.current_org)

        if outcome == "ok" and self.current_org.get_setting("disable_public_urls"):
            outcome = "disabled"

        # See PublicDashboardResource: recorded against the org that owns the
        # key rather than the org named in the route.
        record_public_read(
            api_key.org if api_key else self.current_org,
            self.current_user,
            "visualization",
            vis.id if vis else None,
            outcome,
            token,
        )

        if outcome != "ok":
            abort(404)

        return public_visualization(vis)
