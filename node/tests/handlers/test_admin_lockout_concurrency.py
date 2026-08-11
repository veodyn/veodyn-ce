"""Two admins disabling each other at the same moment.

POST /api/users/<id>/disable refuses to disable your own account, and that
refusal was once read as making the endpoint safe by construction. It does not:
two enabled admins each disabling the other both pass it, and each one counts a
state where somebody else is still administering the organization. Both commit
and nobody is.

Real threads, real transactions, one session each. Flask-SQLAlchemy scopes its
session per thread, so pushing an app context inside the thread is what makes
these two transactions rather than one pretending to be two, and the bug lives
in what the database does with two. The pattern is the one in
tests/models/test_api_key_concurrency.py.
"""

import threading
import time
from unittest.mock import patch

from redash import permissions
from redash.models import Group, User, db
from tests import BaseTestCase


class TestConcurrentDisableCannotEmptyTheAdmins(BaseTestCase):
    def run_concurrently(self, *bodies):
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

        threads = [threading.Thread(target=isolated(body)) for body in bodies]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join(timeout=60)
            self.assertFalse(thread.is_alive(), "a concurrent transaction never finished")

        if errors:
            raise errors[0]

    def disable_request(self, org_slug, actor_id, target_id, outcomes):
        """One request, on its own client, from its own thread.

        A client of its own matters: authenticating writes the session cookie,
        and two threads sharing one test client would each be logged in as
        whoever wrote last.
        """

        def body():
            actor = User.query.get(actor_id)
            client = self.app.test_client()
            with client.session_transaction() as session:
                session["_user_id"] = actor.get_id()

            response = client.post(
                "/{}/api/users/{}/disable".format(org_slug, target_id),
                content_type="application/json",
            )
            outcomes.append(response.status_code)

        return body

    def test_two_admins_disabling_each_other_leave_one_enabled(self):
        group = self.factory.create_group(permissions=Group.DEFAULT_PERMISSIONS + ["admin"])
        db.session.commit()
        first = self.factory.create_user(group_ids=[group.id])
        second = self.factory.create_user(group_ids=[group.id])
        db.session.commit()
        org_slug, first_id, second_id = self.factory.org.slug, first.id, second.id
        outcomes = []

        real_count = permissions.enabled_admin_count

        def slow_count(org):
            # The delay goes AFTER the count and before the commit, which is
            # where the race actually lives: each request has to have read its
            # "somebody else is still an admin" while the other request has
            # written but not committed. Delaying before the count instead
            # leaves the two threads racing over microseconds, and this test
            # passed against a version with no lock at all until it moved.
            #
            # Under the org lock only one request is ever in here, and the
            # second one blocks before it writes anything, so nothing deadlocks.
            count = real_count(org)
            time.sleep(1)
            return count

        with patch("redash.permissions.enabled_admin_count", slow_count):
            self.run_concurrently(
                self.disable_request(org_slug, first_id, second_id, outcomes),
                self.disable_request(org_slug, second_id, first_id, outcomes),
            )

        self.assertEqual([200, 400], sorted(outcomes), "both disables were accepted")

        db.session.remove()
        still_enabled = User.query.filter(User.id.in_([first_id, second_id]), User.disabled_at.is_(None)).count()
        self.assertEqual(1, still_enabled, "the organization was left with no enabled admin")
