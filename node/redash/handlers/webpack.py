import json
import os

from flask import url_for

from redash import settings


def configure_webpack(app):
    app.extensions["webpack"] = {"assets": None}

    def get_asset(path):
        assets = app.extensions["webpack"]["assets"]
        # in debug we read in this file each request
        if assets is None or app.debug:
            manifest_path = os.path.join(settings.STATIC_ASSETS_PATH, "asset-manifest.json")
            try:
                with open(manifest_path) as fp:
                    assets = json.load(fp)
            except IOError:
                # No client build present, which is now the normal case:
                # the product UI lives outside this app. Falls back to the
                # unmapped path rather than raising, same as when the
                # manifest exists but does not mention this asset.
                assets = {}
            app.extensions["webpack"]["assets"] = assets
        return url_for("static", filename=assets.get(path, path))

    @app.context_processor
    def webpack_assets():
        return {"asset_url": get_asset}
