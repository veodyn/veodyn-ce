import threading
import time

from redash.models import ApiKey, Dashboard, User, Visualization, db
from tests import BaseTestCase


class TestApiKeyUnderConcurrency(BaseTestCase):
    """Two real transactions, on two connections, in two threads.

    Flask-SQLAlchemy scopes its session per thread, so pushing an app context
    inside the thread is what makes these separate transactions rather than one
    session pretending to be two. A single-session imitation of the race would
    prove nothing about what the database does, and the bug lives there.
    """

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
            thread.join(timeout=30)
            self.assertFalse(thread.is_alive(), "a concurrent transaction never finished")

        if errors:
            raise errors[0]

    def test_two_concurrent_share_requests_leave_one_active_key(self):
        dashboard = self.factory.create_dashboard()
        db.session.commit()
        dashboard_id = dashboard.id
        user_id = self.factory.user.id

        both_started = threading.Barrier(2, timeout=30)
        minted = []

        def mint():
            object = Dashboard.query.get(dashboard_id)
            user = User.query.get(user_id)
            # Line the two transactions up at the point where the unserialized
            # version had each of them about to decide nothing existed yet.
            both_started.wait()
            api_key = ApiKey.get_or_create_for_object(object, user)
            db.session.commit()
            minted.append(api_key.api_key)

        self.run_concurrently(mint, mint)

        self.assertEqual(1, len(set(minted)), "two concurrent shares handed out two different tokens")
        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())

    def test_a_mint_cannot_land_behind_a_revoke_already_in_flight(self):
        dashboard = self.factory.create_dashboard()
        existing = self.factory.create_api_key(object=dashboard)
        db.session.commit()
        dashboard_id = dashboard.id
        user_id = self.factory.user.id

        revoke_has_read = threading.Event()
        finished = []

        def revoke():
            object = Dashboard.query.get(dashboard_id)
            ApiKey.deactivate_for_object(object)
            revoke_has_read.set()
            # Held open on purpose. This is the window the unserialized version
            # let a mint through: the revoke had already read the key list, so
            # an insert committing here survived it with nothing in the product
            # able to reach the token afterwards.
            time.sleep(1)
            finished.append("revoke")
            db.session.commit()

        def mint():
            object = Dashboard.query.get(dashboard_id)
            user = User.query.get(user_id)
            self.assertTrue(revoke_has_read.wait(timeout=30))
            ApiKey.get_or_create_for_object(object, user)
            db.session.commit()
            finished.append("mint")

        self.run_concurrently(revoke, mint)

        self.assertEqual(["revoke", "mint"], finished, "the mint did not wait for the revoke to finish")
        db.session.refresh(existing)
        self.assertFalse(existing.active)
        self.assertEqual(1, ApiKey.all_active_for_object(dashboard).count())

    def test_a_mint_cannot_land_behind_an_archive_already_in_flight(self):
        """The mint loads its target, then waits on the lock the archive holds.

        By the time it gets the lock the dashboard is archived, but the copy it
        loaded still says otherwise, so a check against that copy would pass and
        publish something the product treats as deleted. The archive's own
        revoke has already run and cannot reach a key that does not exist yet.
        """
        dashboard = self.factory.create_dashboard()
        db.session.commit()
        dashboard_id = dashboard.id
        user_id = self.factory.user.id

        archive_has_flushed = threading.Event()
        outcomes = []

        def archive():
            object = Dashboard.query.get(dashboard_id)
            object.is_archived = True
            db.session.add(object)
            db.session.flush()
            archive_has_flushed.set()
            # Held open on purpose: this is the window in which the minting
            # transaction's copy of the dashboard still says it is live.
            time.sleep(1)
            db.session.commit()

        def mint():
            object = Dashboard.query.get(dashboard_id)
            user = User.query.get(user_id)
            self.assertTrue(archive_has_flushed.wait(timeout=30))
            try:
                ApiKey.get_or_create_for_object(object, user)
                db.session.commit()
                outcomes.append("minted")
            except ApiKey.TargetArchived:
                db.session.rollback()
                outcomes.append("refused")

        self.run_concurrently(archive, mint)

        self.assertEqual(["refused"], outcomes, "a mint landed on a dashboard that was being archived")
        self.assertEqual(0, ApiKey.all_active_for_object(dashboard).count())

    def active_keys_for_visualization(self, visualization_id):
        """Counted by type and id rather than through the object.

        The row is gone by the time this runs, and the point of the test is
        that the key must be gone with it, so there is nothing left to hand to
        all_active_for_object.
        """
        return ApiKey.query.filter(
            ApiKey.object_type == Visualization.__tablename__,
            ApiKey.object_id == visualization_id,
            ApiKey.active.is_(True),
        ).count()

    def test_a_mint_cannot_land_behind_a_delete_already_in_flight(self):
        """A visualization is deleted outright, and its query is not touched.

        So the archive check passes: it asks about the parent query, and the
        parent query is live. The share request loaded the visualization before
        the delete took the lock, waits, and would otherwise insert an active
        key for a row that no longer exists. That token 404s on the first read
        and the orphan stays active, with the share dialog unable to load the
        visualization in order to revoke it.
        """
        visualization = self.factory.create_visualization()
        db.session.commit()
        visualization_id = visualization.id
        user_id = self.factory.user.id

        delete_has_locked = threading.Event()
        outcomes = []

        def delete():
            object = Visualization.query.get(visualization_id)
            # VisualizationResource.delete's own order: revoke, which is what
            # takes the per object lock, then delete the row.
            ApiKey.deactivate_for_object(object)
            db.session.delete(object)
            db.session.flush()
            delete_has_locked.set()
            # Held open on purpose: this is the window in which the minting
            # transaction's copy of the visualization still says it is there.
            time.sleep(1)
            db.session.commit()

        def mint():
            object = Visualization.query.get(visualization_id)
            user = User.query.get(user_id)
            self.assertTrue(delete_has_locked.wait(timeout=30))
            try:
                ApiKey.get_or_create_for_object(object, user)
                db.session.commit()
                outcomes.append("minted")
            except ApiKey.TargetArchived:
                db.session.rollback()
                outcomes.append("refused")

        self.run_concurrently(delete, mint)

        self.assertEqual(["refused"], outcomes, "a mint landed on a visualization that was being deleted")
        # Counted rather than fetched by primary key: this session still holds
        # the row in its identity map, and Query.get would hand it back without
        # asking the database anything.
        self.assertEqual(0, Visualization.query.filter(Visualization.id == visualization_id).count())
        self.assertEqual(0, self.active_keys_for_visualization(visualization_id))

    def test_sharing_a_visualization_nobody_is_deleting_still_works(self):
        """The refusal above has to be about the delete and not about the type.

        A fix that reads the wrong row, or reads it in the wrong session, turns
        every visualization share into a 404 and this is what notices.
        """
        visualization = self.factory.create_visualization()
        db.session.commit()

        api_key = ApiKey.get_or_create_for_object(visualization, self.factory.user)
        db.session.commit()

        self.assertTrue(api_key.active)
        self.assertEqual(1, ApiKey.all_active_for_object(visualization).count())
