from flask import request
from flask_restful import abort

from redash.handlers.base import BaseResource
from redash.models import Organization, db
from redash.permissions import lock_org_admin_state, require_admin
from redash.settings.organization import settings as org_settings

# Organization settings that decide who a user IS, rather than how the product
# looks to them. Changing one of these needs "super_admin" and not "admin".
#
# The boundary is the "auth_" prefix rather than an enumerated list, so an
# authentication setting added later is restricted the day it lands instead of
# the day somebody remembers this file. Fail closed is the point: a forgotten
# entry in a list is a writable trust anchor. An auth_ key this build does not
# recognise is refused for the same reason.
#
# The prefix is the right line here and not merely a convenient one. Every key
# in redash/settings/organization.py named auth_* configures a login method, and
# every key not named auth_* is a date or number format, a feature flag or the
# beacon consent. None of the auth_ keys is innocuous enough to leave out:
#
# - auth_saml_type, auth_saml_entity_id, auth_saml_sso_url and
#   auth_saml_x509_cert are read per organization by
#   authentication.saml_auth.get_saml_client, which builds inline IdP metadata
#   out of that certificate and runs with allow_unsolicited on and
#   want_response_signed off. Writing them installs an identity provider, and
#   every login afterwards is whoever the writer signed an assertion for.
#   auth_saml_sp_settings is merged into the same config as raw JSON.
# - auth_google_apps_domains decides which Google accounts are provisioned into
#   the organization at all. authentication.google_oauth.verify_profile reads it
#   off the organization row, so it is live per organization.
# - the auth_jwt_* keys describe the same trust anchor one protocol over: an
#   issuer plus the URL the signing keys are fetched from. They are stored per
#   organization and shown on the settings page, but the login path
#   (authentication.jwt_token_load_user_from_request) reads the process-wide
#   defaults instead of the organization row, so writing them changes nothing
#   today. That is an upstream inconsistency and not a guarantee, and the day it
#   is made consistent whoever can write them mints tokens for any email. They
#   are restricted now rather than after that change.
# - auth_password_login_enabled escalates nothing by itself. It stays in because
#   turning a login method on and off is still trust configuration, and because
#   a carve-out here is what the next auth setting would get added next to.
AUTH_SETTING_PREFIX = "auth_"


def get_settings_with_defaults(defaults, org):
    values = org.settings.get("settings", {})
    settings = {}

    for setting, default_value in defaults.items():
        current_value = values.get(setting)
        if current_value is None and default_value is None:
            continue

        if current_value is None:
            settings[setting] = default_value
        else:
            settings[setting] = current_value

    settings["auth_google_apps_domains"] = org.google_apps_domains

    return settings


def changed_auth_settings(org, new_values):
    """The restricted settings this request would actually change.

    Presence is not a change. The settings page GETs every value and POSTs the
    whole object back on every save
    (client/app/pages/settings/hooks/useOrganizationSettings.js), so an admin
    editing a date format submits every auth_* key along untouched. Refusing on a
    key being present would take the settings page away from an org admin rather
    than taking the trust anchor away, which is the wrong boundary and one people
    route around by asking for super_admin.

    Compared against get_settings_with_defaults rather than the raw stored dict,
    because that is the value the client was handed and is sending back. A key
    with nothing stored reads as its default in both, so re-saving it is not a
    change.
    """
    current = get_settings_with_defaults(org_settings, org)

    return sorted(
        key for key, value in new_values.items() if key.startswith(AUTH_SETTING_PREFIX) and value != current.get(key)
    )


class OrganizationSettings(BaseResource):
    @require_admin
    def get(self):
        settings = get_settings_with_defaults(org_settings, self.current_org)

        return {"settings": settings}

    @require_admin
    def post(self):
        new_values = request.json

        # The decision below reads the organization's current values and the
        # write happens later in the same request, so the two have to be one
        # serialized operation rather than a read that is true when it is made.
        # Unserialized, the settings page is the exploit by itself: it hands a
        # plain admin the whole settings object and POSTs it back on every save,
        # so a snapshot containing auth_saml_x509_cert = A passes authorization
        # against A, a super admin rotates that key to B because A leaked, and
        # the snapshot still commits A back through the JSONB document. Nobody
        # authorised that write, and what it restores is a compromised identity
        # provider.
        #
        # The organization row is taken before any attribute of it is touched,
        # and that ordering is the point rather than an accident of layout. The
        # locking query autoflushes, so anything dirtied first would be written
        # on the way in and this request would hold that row and then ask for
        # the organization row. handlers/users.py and handlers/groups.py take
        # this same lock, always first, and a request that took it second would
        # deadlock against them. The lock is held until the commit below.
        lock_org_admin_state(self.current_org)
        # The locking query returns the instance already in this session's
        # identity map without reloading its columns, and current_org was loaded
        # when the request authenticated, before the lock existed
        # (authentication.load_user, through the org_resolving proxy). So the row
        # this request just locked and the copy it is about to compare against
        # are not the same thing until this line. Without it a request that
        # takes the lock late still measures the submission against values a
        # rotation has already superseded, which is the same unauthorized write
        # one step further along.
        db.session.refresh(self.current_org)

        # Before anything is written, so a request carrying one restricted key
        # and one ordinary key is refused whole rather than half applied.
        restricted = changed_auth_settings(self.current_org, new_values)
        if restricted and not self.current_user.has_permission("super_admin"):
            abort(403, message="Only a super admin can change: {}.".format(", ".join(restricted)))

        if self.current_org.settings.get("settings") is None:
            self.current_org.settings["settings"] = {}

        previous_values = {}
        for k, v in new_values.items():
            if k == "auth_google_apps_domains":
                previous_values[k] = self.current_org.google_apps_domains
                self.current_org.settings[Organization.SETTING_GOOGLE_APPS_DOMAINS] = v
            else:
                previous_values[k] = self.current_org.get_setting(k, raise_on_missing=False)
                self.current_org.set_setting(k, v)

        db.session.add(self.current_org)
        db.session.commit()

        self.record_event(
            {
                "action": "edit",
                "object_id": self.current_org.id,
                "object_type": "settings",
                "new_values": new_values,
                "previous_values": previous_values,
            }
        )

        settings = get_settings_with_defaults(org_settings, self.current_org)

        return {"settings": settings}
