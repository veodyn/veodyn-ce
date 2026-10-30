from unittest import TestCase
from unittest.mock import patch

from redash.query_runner import metrocloudalliance_public as public
from redash.query_runner import registry
from redash.query_runner.metrocloudalliance import MetroCloudAlliance


class Warms:
    calls = 0

    @classmethod
    def type(cls):
        return "warms"

    @classmethod
    def warm_worker(cls):
        cls.calls += 1


class Breaks:
    @classmethod
    def type(cls):
        return "breaks"

    @classmethod
    def warm_worker(cls):
        raise RuntimeError("no network")


class TestWarmQueryRunners(TestCase):
    def test_every_registered_runner_is_warmed_and_a_failure_does_not_stop_the_rest(self):
        Warms.calls = 0
        with patch.dict(registry.query_runners, {"breaks": Breaks, "warms": Warms}, clear=True):
            self.assertEqual(registry.warm_query_runners(), 1)
        self.assertEqual(Warms.calls, 1)


class TestMetroCloudAllianceWarmsItsProfiles(TestCase):
    def test_the_profile_set_is_built_before_any_job_without_reading_overrides(self):
        built = object()
        with (
            patch.object(public, "_profile_set", {}),
            patch.object(public, "profile_dirs", return_value=["/profiles"]),
            patch.object(public, "load_profiles", return_value=built) as load,
            patch.object(public, "override_table") as overrides,
        ):
            MetroCloudAlliance.warm_worker()
            self.assertIs(public._profile_set[("/profiles",)], built)
            self.assertIs(public.base_profile_set(), built)
        self.assertEqual(load.call_count, 1)
        overrides.assert_not_called()
