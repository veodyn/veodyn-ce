import datetime
from unittest.mock import patch

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import NoResultFound

from redash.models import ApiKey, Dashboard, Visualization, db
from redash.utils import utcnow
from tests import BaseTestCase

ACTIVE_KEY_INDEX = "api_keys_one_active_key_per_object"


class TestApiKeyGetByApiKey(BaseTestCase):
    def test_returns_key_without_expiry(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)

        self.assertIsNone(api_key.expires_at)
        self.assertEqual(api_key, ApiKey.get_by_api_key(api_key.api_key))

    def test_returns_key_expiring_in_the_future(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, expires_at=utcnow() + datetime.timedelta(days=1))

        self.assertEqual(api_key, ApiKey.get_by_api_key(api_key.api_key))

    def test_rejects_expired_key(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, expires_at=utcnow() - datetime.timedelta(seconds=1))

        with self.assertRaises(NoResultFound):
            ApiKey.get_by_api_key(api_key.api_key)

    def test_rejects_inactive_key(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, active=False)

        with self.assertRaises(NoResultFound):
            ApiKey.get_by_api_key(api_key.api_key)


class TestApiKeyResolveShareToken(BaseTestCase):
    def resolve(self, token, object_cls=Dashboard, org=None):
        return ApiKey.resolve_share_token(token, object_cls, org or self.factory.org)

    def test_reports_ok_for_a_live_key(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)

        self.assertEqual((api_key, dashboard, "ok"), self.resolve(api_key.api_key))

    def test_reports_not_found_for_an_unknown_token(self):
        self.assertEqual((None, None, "not_found"), self.resolve("no-such-token"))

    def test_reports_revoked_for_an_inactive_key(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, active=False)

        self.assertEqual((api_key, dashboard, "revoked"), self.resolve(api_key.api_key))

    def test_reports_expired_for_a_lapsed_key(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, expires_at=utcnow() - datetime.timedelta(seconds=1))

        self.assertEqual((api_key, dashboard, "expired"), self.resolve(api_key.api_key))

    def test_reports_not_found_for_a_key_of_another_object_type(self):
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)

        self.assertEqual((api_key, None, "not_found"), self.resolve(api_key.api_key, object_cls=Visualization))

    def test_reports_not_found_for_a_key_belonging_to_another_org(self):
        # The org comes from the slug in the route, so resolving on the token
        # alone lets a link minted in one tenant be redeemed under another,
        # under that other tenant's public-URL setting.
        other_org = self.factory.create_org()
        other_user = self.factory.create_user(org=other_org)
        dashboard = self.factory.create_dashboard(org=other_org, user=other_user)
        api_key = self.factory.create_api_key(object=dashboard, org=other_org)
        db.session.commit()

        self.assertEqual((api_key, None, "not_found"), self.resolve(api_key.api_key))

    def test_reports_not_found_when_the_key_and_its_object_disagree_on_the_org(self):
        # Nothing ties api_keys.org_id to the org of the object the key points
        # at, so the two can drift apart. The key's own org is what a read gets
        # attributed to, so a key claiming a tenant its object does not belong
        # to resolves to nothing rather than to whichever of the two is asked.
        other_org = self.factory.create_org()
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard, org=other_org)
        db.session.commit()

        self.assertEqual((api_key, None, "not_found"), self.resolve(api_key.api_key))

    def test_keeps_the_key_so_a_cross_org_refusal_can_be_attributed(self):
        other_org = self.factory.create_org()
        other_user = self.factory.create_user(org=other_org)
        dashboard = self.factory.create_dashboard(org=other_org, user=other_user)
        api_key = self.factory.create_api_key(object=dashboard, org=other_org)
        db.session.commit()

        resolved, _, _ = self.resolve(api_key.api_key)

        self.assertEqual(other_org.id, resolved.org_id)

    def test_reports_not_found_when_the_object_is_gone(self):
        # The generic foreign key has no cascade, so a delete leaves the key
        # behind. Answering ok here would hand the caller nothing to serialize,
        # which is a 500 where every other refusal is a 404.
        dashboard = self.factory.create_dashboard()
        api_key = self.factory.create_api_key(object=dashboard)
        db.session.commit()

        db.session.delete(dashboard)
        db.session.commit()

        self.assertEqual((api_key, None, "not_found"), self.resolve(api_key.api_key))


class TestApiKeyGetByObject(BaseTestCase):
    def test_returns_none_if_not_exists(self):
        dashboard = self.factory.create_dashboard()
        self.assertIsNone(ApiKey.get_by_object(dashboard))

    def test_returns_only_active_key(self):
        dashboard = self.factory.create_dashboard()
        self.factory.create_api_key(object=dashboard, active=False)
        self.assertIsNone(ApiKey.get_by_object(dashboard))

        api_key = self.factory.create_api_key(object=dashboard)
        self.assertEqual(api_key, ApiKey.get_by_object(dashboard))


class TestApiKeyActiveKeyUniqueness(BaseTestCase):
    def test_the_database_refuses_a_second_active_key_for_one_object(self):
        dashboard = self.factory.create_dashboard()
        self.factory.create_api_key(object=dashboard)
        db.session.commit()

        ApiKey.create_for_object(dashboard, self.factory.user)

        with self.assertRaises(IntegrityError):
            db.session.commit()

        db.session.rollback()

    def test_a_revoked_key_does_not_block_the_next_one(self):
        dashboard = self.factory.create_dashboard()
        self.factory.create_api_key(object=dashboard, active=False)
        self.factory.create_api_key(object=dashboard, active=False)
        self.factory.create_api_key(object=dashboard)
        db.session.commit()

        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())

    def test_different_objects_keep_their_own_active_keys(self):
        dashboard = self.factory.create_dashboard()
        other = self.factory.create_dashboard()
        self.factory.create_api_key(object=dashboard)
        self.factory.create_api_key(object=other)
        db.session.commit()

        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())
        self.assertEqual(1, ApiKey.all_active_for_object(other).count())


class TestApiKeyGetOrCreateForObject(BaseTestCase):
    def test_mints_a_key_when_the_object_has_none(self):
        dashboard = self.factory.create_dashboard()

        api_key = ApiKey.get_or_create_for_object(dashboard, self.factory.user)
        db.session.commit()

        self.assertEqual(api_key, ApiKey.get_by_object(dashboard))
        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())

    def test_returns_the_existing_key_instead_of_a_second_one(self):
        dashboard = self.factory.create_dashboard()
        first = ApiKey.get_or_create_for_object(dashboard, self.factory.user)
        db.session.commit()

        second = ApiKey.get_or_create_for_object(dashboard, self.factory.user)
        db.session.commit()

        self.assertEqual(first.api_key, second.api_key)
        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())

    def test_mints_again_after_the_previous_key_was_revoked(self):
        dashboard = self.factory.create_dashboard()
        revoked = self.factory.create_api_key(object=dashboard, active=False)

        api_key = ApiKey.get_or_create_for_object(dashboard, self.factory.user)
        db.session.commit()

        self.assertNotEqual(revoked.api_key, api_key.api_key)
        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())

    def test_does_not_return_a_key_belonging_to_another_object(self):
        shared = self.factory.create_dashboard()
        other = self.factory.create_dashboard()
        existing = self.factory.create_api_key(object=shared)

        api_key = ApiKey.get_or_create_for_object(other, self.factory.user)
        db.session.commit()

        self.assertNotEqual(existing.api_key, api_key.api_key)

    def test_re_reads_the_key_that_landed_when_the_insert_loses(self):
        # Covers the unique index as a backstop rather than the lock: a caller
        # that inserts without taking the lock still must not raise, because
        # the row that landed is the token everyone has to agree on.
        dashboard = self.factory.create_dashboard()
        winner = self.factory.create_api_key(object=dashboard)
        db.session.commit()

        real_get_by_object = ApiKey.get_by_object.__func__
        reads = []

        def first_read_sees_nothing(object):
            reads.append(object)

            if len(reads) == 1:
                return None

            return real_get_by_object(ApiKey, object)

        with patch.object(ApiKey, "get_by_object", side_effect=first_read_sees_nothing):
            api_key = ApiKey.get_or_create_for_object(dashboard, self.factory.user)

        db.session.commit()

        self.assertEqual(2, len(reads))
        self.assertEqual(winner.api_key, api_key.api_key)
        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())


class TestApiKeyDeactivateForObject(BaseTestCase):
    def drop_the_active_key_index(self):
        """Put the schema back the way a pre-migration database looks.

        The partial unique index makes two active keys for one object
        impossible to insert, which is its whole point. The code still has to
        cope with the pair, because a database that has been running since
        before minting was idempotent can be carrying one.
        """
        db.session.execute(text("DROP INDEX {}".format(ACTIVE_KEY_INDEX)))
        db.session.commit()

    def test_revokes_every_active_key_a_legacy_database_can_hold(self):
        self.drop_the_active_key_index()
        dashboard = self.factory.create_dashboard()
        first = self.factory.create_api_key(object=dashboard)
        second = self.factory.create_api_key(object=dashboard)
        db.session.commit()

        revoked = ApiKey.deactivate_for_object(dashboard)
        db.session.commit()

        self.assertEqual({first.id, second.id}, {key.id for key in revoked})
        self.assertFalse(first.active)
        self.assertFalse(second.active)
        self.assertEqual(0, ApiKey.all_active_for_object(dashboard).count())

    def test_leaves_keys_of_other_objects_alone(self):
        dashboard = self.factory.create_dashboard()
        other = self.factory.create_dashboard()
        self.factory.create_api_key(object=dashboard)
        untouched = self.factory.create_api_key(object=other)

        ApiKey.deactivate_for_object(dashboard)
        db.session.commit()

        self.assertTrue(untouched.active)

    def test_reports_nothing_revoked_when_there_was_nothing_to_revoke(self):
        dashboard = self.factory.create_dashboard()

        self.assertEqual([], ApiKey.deactivate_for_object(dashboard))
