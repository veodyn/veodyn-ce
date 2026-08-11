"""A stale settings save meeting a concurrent rotation of the same auth key.

POST /api/settings/organization refuses a plain org admin any CHANGE to an
auth_* setting, and measures "change" by comparing the submitted values against
the organization's current ones. That comparison decides, and the write and the
commit happen later in the same request, so the two have to be one serialized
operation or the decision is about a value that is no longer true.

Unserialized, the settings page is the exploit on its own. It GETs every value
and POSTs the whole object back on every save, so a plain admin holds a snapshot
containing auth_saml_x509_cert = A. A super admin rotates that certificate to B
because A leaked. The plain admin's save passes authorization against A, and
commits A back through the JSONB settings document. Nobody authorised that
write, and what it restores is a compromised identity provider: every login
afterwards is whoever holds the private key for A.

Two halves are covered, one per test, and they fail for different reasons.

- The lock. Without it the two requests interleave and the stale save lands
  last. The delay sits AFTER the authorization decision and before the write,
  which is where the race lives: the stale request has to have decided while
  the rotation was still in flight, and to commit after it. A delay anywhere
  earlier leaves the two threads racing over microseconds and passes against a
  version with no lock at all.
- The refresh after the lock. current_org is loaded when the request
  authenticates, and the locking query returns that same identity-map instance
  without reloading its columns, so a request that takes the lock late still
  compares against what it read early. The delay for that one sits before the
  handler runs at all, so the rotation commits between the load and the lock.

Real threads, real transactions, one session and one connection each.
Flask-SQLAlchemy scopes its session per thread, so pushing an app context inside
the thread is what makes these two transactions rather than one pretending to
be two, and the bug lives in what the database does with two. The harness is
the one in tests/handlers/test_admin_lockout_concurrency.py and
tests/models/test_api_key_concurrency.py.
"""

import threading
from unittest.mock import patch

from redash.handlers import settings as settings_handler
from redash.handlers.base import BaseResource
from redash.models import Organization, User, db
from redash.utils import json_dumps
from tests.handlers.test_group_privileges import GroupPrivilegeTestCase

PLAIN_ADMIN = "plain-admin"
SUPER_ADMIN = "super-admin"

# Long enough for the whole other request to boot a client, authenticate, write
# and commit while this thread is parked. Under the fix the parked thread holds
# the organization row for this long and the other one simply waits.
PARK_SECONDS = 5

# Nothing here parses a certificate. What matters is that the two differ and
# that neither is a default, because installing your own is the whole attack.
CERT_A = "MIIC" + "AA" * 40
CERT_B = "MIIC" + "BB" * 40
SETTING = "auth_saml_x509_cert"


class ConcurrentSettingsSaveTestCase(GroupPrivilegeTestCase):
    def setUp(self):
        super().setUp()
        # A plain org admin, holding "admin" and not "super_admin".
        # factory.create_admin() puts its user in the builtin admin group, which
        # carries "super_admin", and would be refused by nothing.
        self.admin, _ = self.create_admin_only_user()
        self.super_admin = self.factory.create_admin()
        self.factory.org.set_setting(SETTING, CERT_A)
        db.session.add(self.factory.org)
        db.session.commit()

        self.org_slug = self.factory.org.slug
        self.admin_id = self.admin.id
        self.super_admin_id = self.super_admin.id
        self.parked = threading.Event()
        self.finished = []
        self.outcomes = {}
        self.snapshot = self.settings_snapshot()

    def settings_snapshot(self):
        """The whole settings object, exactly as the settings page holds it.

        Read off the endpoint rather than assembled by hand, because the stale
        submission being a full-page snapshot is the point: every auth_* key
        rides along on a save the admin thinks is about something else.
        """
        response = self.make_request("get", "/api/settings/organization", user=self.admin)

        self.assertEqual(200, response.status_code)
        self.assertEqual(CERT_A, response.json["settings"][SETTING])

        return dict(response.json["settings"])

    def client_for(self, user_id):
        """One client per thread. Authenticating writes the session cookie, so
        two threads sharing a client would each be whoever logged in last."""
        client = self.app.test_client()
        with client.session_transaction() as session:
            session["_user_id"] = User.query.get(user_id).get_id()

        return client

    def save_request(self, user_id, values, marker):
        def body():
            response = self.client_for(user_id).post(
                "/{}/api/settings/organization".format(self.org_slug),
                data=json_dumps(values),
                content_type="application/json",
            )
            self.outcomes[marker] = response.status_code
            self.finished.append(marker)

        return body

    def park_the_plain_admin(self):
        """Hold the stale request where the choreography needs it.

        Gated on the thread, because the point in the code being parked at is
        reached by both requests and only one of them is the stale one. A plain
        sleep rather than a handshake with the other thread, because under the
        fix the other thread is blocked inside the database and has no place
        left to signal from.
        """
        if threading.current_thread().name != PLAIN_ADMIN or self.parked.is_set():
            return

        self.parked.set()
        threading.Event().wait(PARK_SECONDS)

    def run_staged(self, stale_body, rotation_body):
        errors = []

        def isolated(body):
            def run():
                with self.app.app_context():
                    try:
                        body()
                    except Exception as error:  # noqa: BLE001
                        errors.append(error)
                    finally:
                        db.session.rollback()
                        db.session.remove()

            return run

        stale = threading.Thread(target=isolated(stale_body), name=PLAIN_ADMIN)
        rotation = threading.Thread(target=isolated(rotation_body), name=SUPER_ADMIN)

        stale.start()
        self.assertTrue(self.parked.wait(timeout=60), "the stale save never reached its park")
        rotation.start()

        for thread in (stale, rotation):
            thread.join(timeout=120)
            self.assertFalse(thread.is_alive(), "a concurrent transaction never finished")

        if errors:
            raise errors[0]

    def rotation_request(self):
        return self.save_request(self.super_admin_id, {SETTING: CERT_B}, "rotation")

    def stale_request(self):
        return self.save_request(self.admin_id, self.snapshot, "stale")

    def stored_cert(self):
        """Read on a session of its own, so nothing answers out of an identity map."""
        db.session.remove()

        return Organization.get_by_slug(self.org_slug).get_setting(SETTING)


class TestAStaleSaveCannotRevertAConcurrentAuthChange(ConcurrentSettingsSaveTestCase):
    def test_a_stale_full_page_save_does_not_overwrite_a_rotated_certificate(self):
        real_decision = settings_handler.changed_auth_settings

        def decide_then_park(org, new_values):
            # After the decision and before the write. Under the fix the
            # organization row is already held here, so the rotation blocks
            # rather than slipping in front, and nothing deadlocks because the
            # blocked request has dirtied nothing.
            restricted = real_decision(org, new_values)
            self.park_the_plain_admin()

            return restricted

        with patch.object(settings_handler, "changed_auth_settings", decide_then_park):
            self.run_staged(self.stale_request(), self.rotation_request())

        # The stored value is asserted first, so a regression reports itself as
        # "the compromised certificate is back" rather than as an ordering
        # detail of the choreography. The ordering is asserted after it as the
        # evidence that the two requests really did meet.
        self.assertEqual(CERT_B, self.stored_cert(), "a stale save reverted a certificate a super admin had rotated")
        self.assertEqual(200, self.outcomes["rotation"], "the super admin's rotation was refused")
        self.assertEqual(["stale", "rotation"], self.finished, "the rotation did not wait for the save in front of it")


class TestTheDecisionReadsTheRowItLocked(ConcurrentSettingsSaveTestCase):
    """The lock is worth nothing if the comparison reads a cached copy.

    Taking the row and then deciding against the values loaded before it is the
    same unauthorized write one step further along, and it needs no interleaving
    at all: the rotation is finished and committed before this request even
    reaches the handler.
    """

    def test_a_save_that_locks_late_is_measured_against_the_rotated_value(self):
        real_dispatch = BaseResource.dispatch_request

        def park_then_dispatch(resource, *args, **kwargs):
            # Before the handler and after the request authenticated, which is
            # where current_org gets loaded (authentication.load_user reads it
            # through the org_resolving proxy). So the stale value is sitting in
            # this session's identity map while the rotation commits.
            self.park_the_plain_admin()

            return real_dispatch(resource, *args, **kwargs)

        with patch.object(settings_handler.OrganizationSettings, "dispatch_request", park_then_dispatch):
            self.run_staged(self.stale_request(), self.rotation_request())

        self.assertEqual(CERT_B, self.stored_cert(), "a stale save reverted a certificate a super admin had rotated")
        self.assertEqual(403, self.outcomes["stale"], "a plain admin was allowed to write back a superseded value")
        self.assertEqual(200, self.outcomes["rotation"], "the super admin's rotation was refused")
        self.assertEqual(["rotation", "stale"], self.finished, "the save did not land behind the rotation")
