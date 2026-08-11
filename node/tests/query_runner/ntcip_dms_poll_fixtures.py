"""
Shared test fixtures for the NTCIP DMS polling tests, split out of
test_ntcip_dms_poll.py and test_ntcip_dms_poll_selection.py to keep both
under the repo's 300-line limit. Not a test module itself (no `test_`
prefix), so pytest does not try to collect it.
"""

import json

from redash.query_runner.ntcip_dms import NtcipDms
from redash.query_runner.ntcip_dms_decode import OIDS, RESOURCE_FIELDS

DEVICE_A = {"name": "Sign A", "host": "10.0.0.1", "port": 161}
DEVICE_B = {"name": "Sign B", "host": "10.0.0.2", "port": 161}
DEVICE_C = {"name": "Sign C", "host": "10.0.0.3", "port": 161}

IDENTITY_VALUES = {
    "sys_name": "Sign",
    "sys_descr": "A DMS",
    "dms_sign_type": 3,
    "dms_sign_height": 1000,
    "dms_sign_width": 3000,
    "vms_sign_height_pixels": 20,
    "vms_sign_width_pixels": 96,
}


def healthy_response(resource="dms_identity", values=None):
    """A canned (error_indication, error_status, error_index, var_binds)
    tuple for a healthy transaction, with var_binds built in the same
    field order _poll_device requests them in."""
    values = values or IDENTITY_VALUES
    fields = RESOURCE_FIELDS[resource]
    var_binds = [(OIDS[field], values[field]) for field in fields]
    return None, 0, 0, var_binds


def timeout_response():
    return "Request timed out", 0, 0, ()


def pdu_error_response(error_index=1):
    # The v1 noSuchName shape: error_status non-zero, the whole varbind
    # group untrustworthy, not a per-varbind sentinel.
    return None, 2, error_index, ()


def make_runner(devices, **config_overrides):
    config = {"community": "public", "default_devices": json.dumps(devices)}
    config.update(config_overrides)
    return NtcipDms(config)


def stub_sync_get(responses_by_host):
    """Patch target for ntcip_dms_poll._sync_get. responses_by_host maps a
    device host to either a canned response tuple or a zero-arg callable
    returning one, so a test can advance a fake clock as a side effect."""

    def _stub(host, port, oids, community, mp_model, timeout):
        response = responses_by_host[host]
        return response() if callable(response) else response

    return _stub


class FakeClock:
    """A monotonic-shaped callable a test can advance deterministically,
    standing in for ntcip_dms_poll.time.monotonic so deadline tests do not
    depend on wall-clock timing."""

    def __init__(self, start=1000.0):
        self.now = start

    def advance(self, seconds):
        self.now += seconds

    def __call__(self):
        return self.now
