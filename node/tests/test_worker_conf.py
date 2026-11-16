from configparser import ConfigParser
from pathlib import Path

SECONDS_IN_30_DAYS = 30 * 24 * 60 * 60
WORKER_CONF = Path(__file__).resolve().parent.parent / "worker.conf"


def worker_program():
    parser = ConfigParser(interpolation=None)
    parser.read(WORKER_CONF)
    return parser["program:worker"]


def test_worker_start_retries_outlast_a_30_day_redis_outage():
    retries = int(worker_program()["startretries"])
    seconds_of_backoff_before_giving_up = retries * (retries + 1) // 2
    assert seconds_of_backoff_before_giving_up >= SECONDS_IN_30_DAYS
