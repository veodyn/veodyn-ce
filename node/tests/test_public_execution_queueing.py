from redash.public_execution import JOB_TIMEOUT, QUEUED_TTL, lease_seconds


def test_a_queued_public_run_waits_long_enough_for_a_cold_burst_of_every_route():
    assert QUEUED_TTL == 60


def test_the_lease_outlives_a_run_that_waited_its_full_queued_time_and_was_hard_killed():
    assert lease_seconds(60) == QUEUED_TTL + JOB_TIMEOUT + 15
    assert lease_seconds(600) == 600
