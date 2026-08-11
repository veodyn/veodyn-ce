"""A password-plus-membership update meeting a disable of the same account.

POST /api/users/<id> and POST /api/users/<id>/disable both write the user row
and both take the organization row that lock_org_admin_state holds the "somebody
can still administer this org" decision under. They have to take the two in the
same order, and the disable handler fixes that order: organization first, user
row later, when require_remaining_admin autoflushes the disable.

If the update handler hashes the password before it locks, the lock query's own
autoflush writes the user row on the way in, so that request holds the user row
and then asks for the organization row. That is the inversion, and two
administrators doing ordinary work at the same moment then hold what the other
one is waiting for. Postgres breaks the cycle by aborting a request, which is a
lost administrative write rather than a queue.

Real threads, one session and one transaction each, and the deadlock is the
database's rather than a mock's. What is choreographed here is only WHEN each
request runs, never what it does: an after_flush listener parks the update
thread on its first flush, and the disable is not started until that flush has
happened. Under the corrected order that first flush lands with the
organization row already held, so the disable simply waits. Under the inverted
order that first flush is the user row, taken before the organization is asked
for, and the two requests deadlock. The threading harness is the one in
tests/handlers/test_admin_lockout_concurrency.py.
"""

import threading

from sqlalchemy import event
from sqlalchemy.orm import Session

from redash.models import Group, User, db
from redash.utils import json_dumps
from tests import BaseTestCase

UPDATER = "updater"

# Long enough for the disable request to boot a client, authenticate, take the
# organization row and reach its own write while the update thread is parked.
PARK_SECONDS = 5


class TestUserUpdateTakesTheOrgLockFirst(BaseTestCase):
    def setUp(self):
        super().setUp()
        # A regular group carrying "admin" and not "super_admin", so both users
        # are plain org admins: an admin holding "super_admin" could not be
        # disabled by the other one at all (require_manageable_account) and the
        # two requests would never meet.
        group = self.factory.create_group(permissions=Group.DEFAULT_PERMISSIONS + ["admin"])
        ordinary = self.factory.create_group(permissions=["view_query"])
        db.session.commit()
        target = self.factory.create_user(group_ids=[group.id])
        actor = self.factory.create_user(group_ids=[group.id])
        db.session.commit()

        self.org_slug = self.factory.org.slug
        self.target_id, self.actor_id = target.id, actor.id
        self.group_id, self.ordinary_id = group.id, ordinary.id

        self.updater_flushed = threading.Event()
        event.listen(Session, "after_flush", self.park_on_first_flush)

    def tearDown(self):
        event.remove(Session, "after_flush", self.park_on_first_flush)
        super().tearDown()

    def park_on_first_flush(self, session, flush_context):
        """Hold the update thread on whatever its first flush just locked."""
        if threading.current_thread().name != UPDATER or self.updater_flushed.is_set():
            return

        self.updater_flushed.set()
        # A plain sleep rather than a handshake with the other thread, because
        # the other thread is about to be blocked inside the database and has no
        # place left to signal from.
        threading.Event().wait(PARK_SECONDS)

    def client_for(self, user_id):
        """One client per thread. Authenticating writes the session cookie, so
        two threads sharing a client would each be whoever logged in last."""
        client = self.app.test_client()
        with client.session_transaction() as session:
            session["_user_id"] = User.query.get(user_id).get_id()

        return client

    def update_request(self, outcomes):
        """The admin changes their own password and their own group list.

        Both halves are needed: the password is what dirties the user row before
        the lock, and group_ids is what makes the handler take the lock at all.
        """

        def body():
            response = self.client_for(self.target_id).post(
                "/{}/api/users/{}".format(self.org_slug, self.target_id),
                data=json_dumps(
                    {
                        "password": "changed1234",
                        "old_password": "test1234",
                        "group_ids": [self.group_id, self.ordinary_id],
                    }
                ),
                content_type="application/json",
            )
            outcomes["update"] = response.status_code

        return body

    def disable_request(self, outcomes):
        def body():
            response = self.client_for(self.actor_id).post(
                "/{}/api/users/{}/disable".format(self.org_slug, self.target_id),
                content_type="application/json",
            )
            outcomes["disable"] = response.status_code

        return body

    def run_staged(self, updater_body, disabler_body):
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

        updater = threading.Thread(target=isolated(updater_body), name=UPDATER)
        disabler = threading.Thread(target=isolated(disabler_body), name="disabler")

        updater.start()
        self.assertTrue(self.updater_flushed.wait(timeout=60), "the update request never flushed")
        disabler.start()

        for thread in (updater, disabler):
            thread.join(timeout=120)
            self.assertFalse(thread.is_alive(), "a concurrent transaction never finished")

        return errors

    def test_an_update_and_a_disable_of_the_same_account_do_not_deadlock(self):
        outcomes = {}

        errors = self.run_staged(self.update_request(outcomes), self.disable_request(outcomes))

        # Raised rather than asserted on, so a deadlock reports itself as
        # "DeadlockDetected" instead of as a missing dictionary key.
        if errors:
            raise errors[0]

        self.assertEqual({"update": 200, "disable": 200}, outcomes)

        db.session.remove()
        self.assertTrue(User.query.get(self.target_id).is_disabled)
        self.assertIn(self.ordinary_id, User.query.get(self.target_id).group_ids)
