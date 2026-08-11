"""A SAML login racing a membership change over the last administrator.

tests/models/test_saml_group_assignments.py pins what one login decides on its
own. This file pins that the decision is serialized against the other requests
that can take admin away, which is a separate property: two transactions each
reading "somebody else is still an administrator" and each removing a different
last route to it both commit, and the organization ends up with none.

Real threads, real transactions, one session each. Flask-SQLAlchemy scopes its
session per thread, so pushing an app context inside the thread is what makes
these two transactions rather than one pretending to be two. The pattern is the
one in tests/handlers/test_admin_lockout_concurrency.py.
"""

import threading
import time
from unittest.mock import patch

from redash import permissions
from redash.models import Group, User, db
from tests import BaseTestCase


class TestSamlLoginRacingAMembershipChange(BaseTestCase):
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

    def saml_login(self, user_id, group_names):
        """The half of authentication.saml_auth.idp_initiated that assigns groups."""

        def body():
            User.query.get(user_id).update_group_assignments(group_names)

        return body

    def remove_member_request(self, org_slug, actor_id, group_id, target_id, outcomes):
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

            response = client.delete(
                "/{}/api/groups/{}/members/{}".format(org_slug, group_id, target_id),
                content_type="application/json",
            )
            outcomes.append(response.status_code)

        return body

    def two_admins_in_one_regular_group(self):
        """Both administrators hold "admin" through the same regular group.

        A regular group rather than the builtin one, because that is the shape
        the identity provider maps and the shape the previous round's carve-out
        does not reach. Both administrators have to be in play: a third one
        would still be administering the organization at the end, and the count
        could never reach zero to begin with.
        """
        group = self.factory.create_group(name="Engineering", permissions=Group.DEFAULT_PERMISSIONS + ["admin"])
        db.session.commit()
        first = self.factory.create_user(group_ids=[self.factory.default_group.id, group.id])
        second = self.factory.create_user(group_ids=[self.factory.default_group.id, group.id])
        db.session.commit()

        return group.id, first.id, second.id

    def test_a_login_racing_a_removal_cannot_drop_the_last_admin(self):
        # The interleaving is forced rather than hoped for. The removal reads
        # its count first and then holds still; the login runs inside that
        # window. Left to chance the two threads race over microseconds and the
        # unfixed code wins often enough to look correct.
        group_id, first_id, second_id = self.two_admins_in_one_regular_group()
        org_slug = self.factory.org.slug
        outcomes = []
        counted = threading.Event()
        real_count = permissions.enabled_admin_count

        def slow_count(org):
            # The delay goes AFTER the count and before the commit, which is
            # where the race lives: the removal has to have read "somebody else
            # is still an admin" while the login is about to make that false.
            count = real_count(org)
            counted.set()
            time.sleep(1.5)
            return count

        def login_once_the_removal_has_counted():
            self.assertTrue(counted.wait(timeout=30), "the other transaction never got as far as counting")
            User.query.get(first_id).update_group_assignments([])

        with patch("redash.permissions.enabled_admin_count", slow_count):
            self.run_concurrently(
                self.remove_member_request(org_slug, first_id, group_id, second_id, outcomes),
                login_once_the_removal_has_counted,
            )

        db.session.remove()
        self.assertEqual(
            1, permissions.enabled_admin_count(self.factory.org), "the organization was left unadministered"
        )

        # Under the org lock the removal is the one that got there first, so it
        # succeeds and the login is the side that gives way: it finds itself
        # holding the only remaining route to admin and keeps the group.
        self.assertEqual([200], outcomes)
        self.assertIn(group_id, User.query.get(first_id).group_ids)

    def test_two_logins_giving_up_the_same_group_leave_one_admin(self):
        # The trade this fix makes, asserted rather than assumed: the losing
        # side of the race is the assertion's demotion, not the login. Neither
        # call raises, and exactly one of the two keeps the group. An
        # administrator locked out of the product is the same lockout read the
        # other way round.
        group_id, first_id, second_id = self.two_admins_in_one_regular_group()
        real_count = permissions.enabled_admin_count

        def slow_count(org):
            count = real_count(org)
            time.sleep(1)
            return count

        with patch("redash.permissions.enabled_admin_count", slow_count):
            self.run_concurrently(
                self.saml_login(first_id, []),
                self.saml_login(second_id, []),
            )

        db.session.remove()
        self.assertEqual(1, permissions.enabled_admin_count(self.factory.org))
        kept = [uid for uid in (first_id, second_id) if group_id in User.query.get(uid).group_ids]
        self.assertEqual(1, len(kept), "the group was kept by both or by neither")
