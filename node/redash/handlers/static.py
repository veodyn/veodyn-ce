from flask import jsonify, redirect

from redash import settings
from redash.handlers import routes
from redash.handlers.base import org_scoped_rule


@routes.route(org_scoped_rule("/"), methods=["GET"])
def index(org_slug=None):
    """The bare API host has no UI of its own to show.

    The product UI is the separate Next.js app, reached at UI_BASE_URL. A
    human who lands here by typing the API host directly gets sent there
    instead of a stack trace or an empty page shell. When nothing is
    configured, an honest, machine-readable 404 is better than either a
    silent redirect to nowhere or a bare 404 that does not say why.
    """
    # Refuse to redirect to our own origin: UI_BASE_URL defaults to empty now,
    # but a deployment can still misconfigure it to equal HOST (the API's own
    # address), and redirecting there would loop "/" back to "/" forever. That
    # is a config problem, not a page; fall through to the 404 body below so
    # it degrades to a readable error instead of a redirect loop.
    if settings.UI_BASE_URL and settings.UI_BASE_URL != settings.HOST:
        return redirect(settings.UI_BASE_URL)

    return (
        jsonify(
            {
                "error": "no_ui_configured",
                "message": (
                    "This is the Redash API host; it does not serve a UI. "
                    "Set REDASH_UI_BASE_URL to the product UI's address."
                ),
            }
        ),
        404,
    )
