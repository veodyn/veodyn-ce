"""A member joining a group while that group is being granted super_admin.

tests/handlers/test_api_key_promotion.py pins that each of the two routes
across the line rotates the key it invalidates. Both of those are one request
at a time, and each one is correct on its own. This file is about the two of
them happening at once, which neither can see.

POST /api/groups/<id>/members reads the group it is joining somebody to and
decides there is nothing to revoke. POST /api/groups/<id> reads the membership
of the group it is promoting and decides the same. Run them concurrently and
both readings are true and both decisions are wrong: the member add cannot see
a permission that has not committed yet, and the grant cannot see a membership
that has not committed yet. Both commit, the user is a super admin, and the
api_key an org admin read out of the product while the account was ordinary
still authenticates with the new permissions.

The member add was deliberately left without the organization lock on the
grounds that joining a group cannot remove an administrator. That is true of
the lockout invariant and false of the rotation invariant, and this is the gap
between the two.

Two tests, because serializing these endpoints takes two things and only one of
them is the lock. The first pins the lock: with the member add unserialized the
two transactions overlap and neither rotates. The second pins that waiting for
the lock is not the same as seeing what you waited for. current_user is loaded
at authentication and held on the request context for the whole request, so
unlike an ordinary queried row it is never collected and never reloaded, and
group_ids on that copy predates the wait. Both membership endpoints rewrite
that array whole, so the stale copy goes back to the database with only this
request's edit applied and a membership another request just removed comes back
with it.

Real threads, real transactions, one session each. Flask-SQLAlchemy scopes its
session per app context, so pushing one inside the thread is what makes these
two transactions rather than one pretending to be two. The pattern is the one
in tests/handlers/test_admin_lockout_concurrency.py.
"""

import threading
from unittest.mock import patch

from redash import permissions
from redash.models import Group, User, db
from tests import BaseTestCase

SUPER_ADMIN_ENDPOINT = "/api/admin/queries/rq_status"

# The thread whose transaction is held open. Named rather than counted, because
# the grant on the other side calls the same patched functions and has to run
# through them untouched.
MEMBER_ADD_THREAD = "member-add"

# How long the held transaction waits for the grant before giving up and
# committing. It is a ceiling, not a delay: with the member add serialized the
# grant blocks on the organization row and never arrives, so this is what the
# fixed code spends here. Without the lock the grant completes at once and the
# wait returns immediately.
GRANT_WAIT_SECONDS = 3


class GroupPromotionRaceTestCase(BaseTestCase):
    def run_concurrently(self, *named_bodies):
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

        threads = [threading.Thread(target=isolated(body), name=name) for name, body in named_bodies]

        for thread in threads:
            thread.start()

        for thread in threads:
            thread.join(timeout=60)
            self.assertFalse(thread.is_alive(), "a concurrent transaction never finished")

        if errors:
            raise errors[0]

    def client_for(self, actor_id):
        """A client of its own, because authenticating writes the session cookie.

        Two threads sharing one test client would each be logged in as whoever
        wrote last.
        """
        actor = User.query.get(actor_id)
        client = self.app.test_client()
        with client.session_transaction() as session:
            session["_user_id"] = actor.get_id()

        return client

    def add_member_request(self, actor_id, group_id, target_id, outcomes):
        def body():
            response = self.client_for(actor_id).post(
                "/{}/api/groups/{}/members".format(self.org_slug, group_id),
                json={"user_id": target_id},
            )
            outcomes.append(("add_member", response.status_code))

        return body

    def grant_super_admin(self, actor_id, group_id, outcomes):
        def body():
            response = self.client_for(actor_id).post(
                "/{}/api/groups/{}".format(self.org_slug, group_id),
                json={"name": "Team", "permissions": ["view_query", "super_admin"]},
            )
            outcomes.append(("grant", response.status_code))

        return body

    def promotable_team_setup(self):
        """A plain admin, a super admin, an ordinary team and an ordinary target.

        "Plain admin" means "admin" without "super_admin", which is the actor
        who can read somebody else's api_key and cannot already reach
        everything that key is about to be worth.
        """
        admin_group = self.factory.create_group(permissions=Group.DEFAULT_PERMISSIONS + ["admin"])
        team = self.factory.create_group(name="Team", permissions=["view_query"])
        db.session.commit()
        plain_admin = self.factory.create_user(group_ids=[admin_group.id])
        super_admin = self.factory.create_admin()
        db.session.commit()
        target = self.factory.create_user()
        db.session.commit()

        self.org_slug = self.factory.org.slug
        captured = self.harvest_key(plain_admin, target)
        self.assertNotEqual(200, self.reaches_super_admin_endpoint(captured))

        return plain_admin.id, super_admin.id, team.id, target.id, captured

    def harvest_key(self, reader, target):
        """The api_key of `target` as `reader` can read it out of the product."""
        response = self.make_request("get", "/api/users/{}".format(target.id), user=reader)
        self.assertEqual(200, response.status_code)
        key = response.json.get("api_key")
        self.assertTrue(key, "the admin could not read the key this test is about")
        return key

    def key_of(self, user_id):
        db.session.expire_all()
        return User.query.get(user_id).api_key

    def reaches_super_admin_endpoint(self, api_key):
        """Whether `api_key` alone gets past a permission only a super admin has."""
        response = self.app.test_client().get("{}?api_key={}".format(SUPER_ADMIN_ENDPOINT, api_key))
        return response.status_code

    def assert_the_crossing_landed_and_the_key_did_not(self, outcomes, team_id, target_id, captured):
        db.session.remove()
        self.assertEqual([("add_member", 200), ("grant", 200)], sorted(outcomes), "a request was refused")

        # Both halves of the crossing really happened. Without this the
        # assertions below would pass against a promotion that never landed,
        # which is a test that cannot fail.
        promoted = User.query.get(target_id)
        self.assertIn(team_id, promoted.group_ids, "the membership was lost")
        self.assertIn("super_admin", promoted.permissions, "the grant was lost")

        self.assertNotEqual(
            200, self.reaches_super_admin_endpoint(captured), "the captured key was still a super admin"
        )
        self.assertNotEqual(captured, self.key_of(target_id), "the key was never rotated")
        self.assertEqual(200, self.reaches_super_admin_endpoint(self.key_of(target_id)))


class TestTheMemberAddIsSerializedAgainstTheGrant(GroupPromotionRaceTestCase):
    def test_a_captured_key_does_not_survive_a_concurrent_join_and_grant(self):
        plain_admin_id, super_admin_id, team_id, target_id, captured = self.promotable_team_setup()
        outcomes = []

        # The interleaving is forced rather than hoped for. Neither side races
        # the other over microseconds: the grant does not start until the member
        # add has made its rotation decision, and the member add does not commit
        # until the grant has finished or the ceiling above expires.
        decided = threading.Event()
        granted = threading.Event()
        real_rotate = permissions.rotate_promoted_api_keys

        def rotate_then_hold(users, held_before):
            real_rotate(users, held_before)
            if threading.current_thread().name != MEMBER_ADD_THREAD:
                return

            # Flushed and not committed, which is the state the grant on the
            # other side cannot see however carefully it looks.
            db.session.flush()
            decided.set()
            granted.wait(timeout=GRANT_WAIT_SECONDS)

        def grant_once_the_member_add_has_decided():
            self.assertTrue(decided.wait(timeout=30), "the member add never got as far as deciding")
            try:
                self.grant_super_admin(super_admin_id, team_id, outcomes)()
            finally:
                granted.set()

        with patch("redash.handlers.groups.rotate_promoted_api_keys", rotate_then_hold):
            self.run_concurrently(
                (MEMBER_ADD_THREAD, self.add_member_request(plain_admin_id, team_id, target_id, outcomes)),
                ("grant", grant_once_the_member_add_has_decided),
            )

        self.assert_the_crossing_landed_and_the_key_did_not(outcomes, team_id, target_id, captured)


class TestAnAdminCannotOutrunTheirOwnDemotion(GroupPromotionRaceTestCase):
    """The other half of serializing: waiting for the lock is not the same as seeing.

    The demotion wins the race outright here and commits before the member add
    holds anything, so no overlap is left to argue about. What is left is that
    the member add is the admin adding THEMSELVES to a group, so the row it
    rewrites is current_user, which was loaded at authentication and has been
    held on the request context ever since. An ordinary row would have been
    dropped and reloaded; this one cannot be. Its group_ids still lists the
    group the other request just took away, and append-then-store puts that
    group back. The admin keeps super_admin by adding themselves to an
    unrelated team at the right moment.
    """

    def demoted_admin_setup(self):
        team = self.factory.create_group(name="Team", permissions=["view_query"])
        db.session.commit()
        actor = self.factory.create_user(group_ids=[self.factory.default_group.id, self.factory.admin_group.id])
        remover = self.factory.create_admin()
        db.session.commit()

        self.org_slug = self.factory.org.slug
        self.assertIn("super_admin", actor.permissions, "the actor was never a super admin to begin with")

        return actor.id, remover.id, team.id, self.factory.admin_group.id

    def remove_member_request(self, actor_id, group_id, target_id, outcomes):
        def body():
            response = self.client_for(actor_id).delete(
                "/{}/api/groups/{}/members/{}".format(self.org_slug, group_id, target_id),
                content_type="application/json",
            )
            outcomes.append(("remove_member", response.status_code))

        return body

    def test_a_self_add_cannot_resurrect_a_group_just_removed(self):
        actor_id, remover_id, team_id, admin_group_id = self.demoted_admin_setup()
        outcomes = []

        at_the_lock = threading.Event()
        removed = threading.Event()
        real_lock = permissions.lock_org_admin_state

        def lock_once_the_demotion_has_landed(org):
            if threading.current_thread().name == MEMBER_ADD_THREAD:
                # Reached after authentication has put current_user in this
                # session and before the lock is taken, which is the only
                # window in which the stale copy can be created.
                at_the_lock.set()
                self.assertTrue(removed.wait(timeout=30), "the demotion never finished")
            return real_lock(org)

        def demote_once_the_member_add_is_at_the_lock():
            self.assertTrue(at_the_lock.wait(timeout=30), "the member add never reached its lock")
            try:
                self.remove_member_request(remover_id, admin_group_id, actor_id, outcomes)()
            finally:
                removed.set()

        with patch("redash.handlers.groups.lock_org_admin_state", lock_once_the_demotion_has_landed):
            self.run_concurrently(
                (MEMBER_ADD_THREAD, self.add_member_request(actor_id, team_id, actor_id, outcomes)),
                ("demote", demote_once_the_member_add_is_at_the_lock),
            )

        db.session.remove()
        self.assertEqual([("add_member", 200), ("remove_member", 200)], sorted(outcomes), "a request was refused")

        demoted = User.query.get(actor_id)
        # The self-add itself is ordinary and still has to work. Without this
        # the test would pass against an endpoint that refused it outright.
        self.assertIn(team_id, demoted.group_ids, "the membership this request was actually for was lost")
        self.assertNotIn(admin_group_id, demoted.group_ids, "the removed group came back")
        self.assertNotIn("super_admin", demoted.permissions, "the admin outran their own demotion")
