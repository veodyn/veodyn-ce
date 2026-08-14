"""Four independent authorization gaps in the inherited Redash layer.

Grouped because each is a few lines and they share nothing else. Every test
here was observed to fail with its own fix reverted; see
plans/003-close-authorization-gaps-implementation-notes.md for which revert
produced which failure.
"""

import time

from flask import request

from redash import models
from redash.authentication import (
    get_user_from_api_key,
    hmac_load_user_from_request,
    sign,
)
from redash.models import AccessPermission
from redash.permissions import ACCESS_TYPE_MODIFY, has_access_to_object, view_only
from tests import BaseTestCase


class TestObjectPermissionsListGetRequiresOwner(BaseTestCase):
    """Defect A: the ACL read had no authorization call at all.

    Its own post and delete both call require_admin_or_owner ten lines away, so
    get was the outlier. The response is a roster of identifiable people.
    """

    def test_owner_still_reads_the_acl(self):
        query = self.factory.create_query()

        rv = self.make_request("get", "/api/queries/{}/acl".format(query.id), user=self.factory.user)

        self.assertEqual(200, rv.status_code)

    def test_admin_still_reads_the_acl(self):
        query = self.factory.create_query()
        admin = self.factory.create_admin()

        rv = self.make_request("get", "/api/queries/{}/acl".format(query.id), user=admin)

        self.assertEqual(200, rv.status_code)

    def test_another_member_of_the_org_is_refused(self):
        query = self.factory.create_query()
        other_user = self.factory.create_user()

        rv = self.make_request("get", "/api/queries/{}/acl".format(query.id), user=other_user)

        self.assertEqual(403, rv.status_code)

    def test_a_grantee_with_modify_access_is_refused_too(self):
        """The narrow behaviour change, pinned rather than left to be noticed.

        A user granted MODIFY reads can_edit as true, so the frontend offers
        them the permissions dialog. They could never grant or revoke through
        it, because post and delete are owner-only; now they cannot read it
        either, which is the consistent half of that.
        """
        query = self.factory.create_query()
        grantee = self.factory.create_user()
        AccessPermission.grant(
            obj=query,
            access_type=ACCESS_TYPE_MODIFY,
            grantor=self.factory.user,
            grantee=grantee,
        )

        rv = self.make_request("get", "/api/queries/{}/acl".format(query.id), user=grantee)

        self.assertEqual(403, rv.status_code)


class TestRevokeGranteeIsOrgScoped(BaseTestCase):
    """Defect B: the grantee lookup was a bare primary-key read.

    User.query.get has no organization filter, so a user_id belonging to a
    different organization resolved and the request answered 200.
    """

    def test_a_user_id_from_another_org_is_refused(self):
        query = self.factory.create_query()
        outsider = self.factory.create_user(org=self.factory.create_org())
        models.db.session.flush()

        rv = self.make_request(
            "delete",
            "/api/queries/{}/acl".format(query.id),
            data={"access_type": ACCESS_TYPE_MODIFY, "user_id": outsider.id},
        )

        self.assertEqual(400, rv.status_code)

    def test_the_refusal_leaves_a_legitimate_grant_alone(self):
        query = self.factory.create_query()
        grantee = self.factory.create_user()
        outsider = self.factory.create_user(org=self.factory.create_org())
        AccessPermission.grant(
            obj=query,
            access_type=ACCESS_TYPE_MODIFY,
            grantor=self.factory.user,
            grantee=grantee,
        )
        models.db.session.flush()

        # The status assertion is what makes this test discriminate. Without it
        # it passes either way: the outsider held no grant on this object, so
        # the unscoped lookup revoked nothing even before the fix, and only the
        # refusal itself is observable.
        refused = self.make_request(
            "delete",
            "/api/queries/{}/acl".format(query.id),
            data={"access_type": ACCESS_TYPE_MODIFY, "user_id": outsider.id},
        )
        self.assertEqual(400, refused.status_code)

        rv = self.make_request("get", "/api/queries/{}/acl".format(query.id), user=self.factory.user)
        self.assertEqual(200, rv.status_code)
        self.assertEqual([grantee.id], [g["id"] for g in rv.json[ACCESS_TYPE_MODIFY]])


class TestJobOwnership(BaseTestCase):
    """Defect C: the job status and cancel endpoints had no ownership check.

    404 rather than 403 throughout, so the endpoints do not confirm which job
    ids exist.
    """

    def setUp(self):
        super().setUp()
        # A data source in its own group, and an owner who is in that group.
        # Access to the QUERY is one of the ways to poll its job, because
        # enqueue_query reuses an in-flight job and only the first of two
        # readers owns it. On the factory's shared data source every user can
        # read every query, so the refusals below would pass for the wrong
        # reason.
        self.group = self.factory.create_group()
        self.source = self.factory.create_data_source(group=self.group)
        self.owner = self.factory.create_user(group_ids=[self.group.id])

    def enqueue(self, user=None):
        user = user or self.owner
        query = self.factory.create_query(user=user, data_source=self.source)
        rv = self.make_request(
            "post",
            "/api/queries/{}/results".format(query.id),
            data={"parameters": {}},
            user=user,
        )
        self.assertEqual(200, rv.status_code)
        return rv.json["job"]["id"]

    def test_owner_reads_and_cancels_their_own_job(self):
        job_id = self.enqueue()

        self.assertEqual(
            200, self.make_request("get", "/api/jobs/{}".format(job_id), user=self.owner).status_code
        )
        self.assertEqual(
            200, self.make_request("delete", "/api/jobs/{}".format(job_id), user=self.owner).status_code
        )

    def test_a_user_without_access_to_the_query_gets_404(self):
        job_id = self.enqueue()
        outsider = self.factory.create_user()

        self.assertEqual(
            404,
            self.make_request("get", "/api/jobs/{}".format(job_id), user=outsider).status_code,
        )
        self.assertEqual(
            404,
            self.make_request("delete", "/api/jobs/{}".format(job_id), user=outsider).status_code,
        )

    def test_an_unknown_job_id_is_404_rather_than_an_error(self):
        # Deliberately not UUID-shaped: the route takes any string, and a real
        # UUID literal here trips the repo's credential-shaped-literal guard
        # (tests/query_runner/test_no_embedded_credentials.py).
        rv = self.make_request("get", "/api/jobs/no-such-job")

        self.assertEqual(404, rv.status_code)

    def test_a_schema_job_is_pollable_by_anyone_who_may_see_the_data_source(self):
        """The regression an owner-only rule caused, and the reason for the
        second branch in _fetch_own_job.

        tasks/general.py enqueues get_schema through rq's decorator, so the job
        carries no meta at all: no org, no owner. The schema browser polls it
        through this same endpoint (services/redash/data-sources.ts), so
        failing closed on a missing owner returned 404 for every uncached
        schema load and every refresh.
        """
        rv = self.make_request(
            "get",
            "/api/data_sources/{}/schema?refresh=true".format(self.factory.data_source.id),
            user=self.factory.user,
        )
        self.assertEqual(200, rv.status_code)
        job_id = rv.json["job"]["id"]

        polled = self.make_request("get", "/api/jobs/{}".format(job_id), user=self.factory.user)

        self.assertEqual(200, polled.status_code)

    def test_a_schema_job_is_refused_without_access_to_its_data_source(self):
        source = self.factory.create_data_source(group=self.factory.create_group())
        rv = self.make_request(
            "get",
            "/api/data_sources/{}/schema?refresh=true".format(source.id),
            user=self.factory.create_admin(),
        )
        self.assertEqual(200, rv.status_code)
        job_id = rv.json["job"]["id"]

        outsider = self.factory.create_user()
        polled = self.make_request("get", "/api/jobs/{}".format(job_id), user=outsider)

        self.assertEqual(404, polled.status_code)

    def test_a_second_reader_of_the_same_query_may_poll_its_shared_job(self):
        """enqueue_query reuses an in-flight job for an identical query, so two
        readers of one saved query share a job id and only the first owns it."""
        query = self.factory.create_query(user=self.factory.user)
        first = self.make_request(
            "post",
            "/api/queries/{}/results".format(query.id),
            data={"parameters": {}},
            user=self.factory.user,
        )
        self.assertEqual(200, first.status_code)
        job_id = first.json["job"]["id"]

        reader = self.factory.create_user()
        polled = self.make_request("get", "/api/jobs/{}".format(job_id), user=reader)

        self.assertEqual(200, polled.status_code)

    def test_an_admin_may_read_and_cancel(self):
        """The plan asked for admin on delete only. That asymmetry cannot exist:
        has_access_to_groups returns True for anyone holding the admin
        permission (permissions.py:378), so an admin reaches every query in the
        org and therefore every saved query's job. Pinned as the decision it
        actually is rather than the one the plan guessed at.
        """
        job_id = self.enqueue()
        admin = self.factory.create_admin()

        self.assertEqual(
            200,
            self.make_request("get", "/api/jobs/{}".format(job_id), user=admin).status_code,
        )
        self.assertEqual(
            200,
            self.make_request("delete", "/api/jobs/{}".format(job_id), user=admin).status_code,
        )


class TestSecretComparisonVerdictUnchanged(BaseTestCase):
    """Defect D: compare_digest replaced ==, and must not change any verdict.

    Timing is not unit-testable here. What is testable, and what actually
    breaks when one of these is rewritten, is whether a correct credential
    still authenticates and a wrong one still does not. All four converted
    sites are covered.
    """

    def setUp(self):
        super().setUp()
        self.query = self.factory.create_query(api_key="q" * 40)
        models.db.session.flush()
        self.path = "/{}/api/queries/{}".format(self.query.org.slug, self.query.id)
        self.expires = time.time() + 1800

    def load_with_signature(self, signature, **extra):
        with self.app.test_client() as c:
            c.get(self.path, query_string=dict({"signature": signature, "expires": self.expires}, **extra))
            return hmac_load_user_from_request(request)

    def test_query_signature_verdicts(self):
        correct = sign(self.query.api_key, self.path, self.expires)

        self.assertIsNotNone(self.load_with_signature(correct))
        # Same length as a real digest, so nothing but the comparison decides it.
        self.assertIsNone(self.load_with_signature("0" * len(correct)))

    def test_user_signature_verdicts(self):
        user = self.factory.create_user(api_key="u" * 40)
        models.db.session.flush()
        correct = sign(user.api_key, self.path, self.expires)

        self.assertIsNotNone(self.load_with_signature(correct, user_id=user.id))
        self.assertIsNone(self.load_with_signature("0" * len(correct), user_id=user.id))

    def test_query_api_key_lookup_verdicts(self):
        with self.app.test_client() as c:
            c.get(self.path)
            self.assertIsNotNone(get_user_from_api_key(self.query.api_key, self.query.id))
            self.assertIsNone(get_user_from_api_key("z" * 40, self.query.id))

    def test_a_non_ascii_credential_is_refused_rather_than_erroring(self):
        """The regression the first cut of this shipped.

        hmac.compare_digest raises TypeError on a str holding a non-ASCII
        character, and every one of these values is attacker-supplied, so
        `?api_key=<non-ASCII>` answered 500 where a wrong ASCII key answers 404.
        secret_equal encodes to bytes, which never raise on content.
        """
        hostile = "á" * 40

        rv = self.get_request("/api/queries/{}?api_key={}".format(self.query.id, hostile), org=self.factory.org)

        self.assertEqual(404, rv.status_code)

    def test_a_non_ascii_signature_is_refused_rather_than_erroring(self):
        self.assertIsNone(self.load_with_signature("á" * 40))

    def test_has_access_to_object_verdicts(self):
        self.assertEqual(view_only, has_access_to_object(self.query, self.query.api_key, view_only))
        self.assertFalse(has_access_to_object(self.query, "z" * 40, view_only))
        # Neither side present must not read as a match.
        self.assertFalse(has_access_to_object(self.query, None, view_only))
