"""
Smoke test for the pysnmp 7.x async transport.

This exists ahead of the ntcip_dms runner itself (Task 1 of the NTCIP
adapter plan). Redash's ``run_query`` is declared synchronous
(``redash/query_runner/__init__.py``), but pysnmp 7.x's hlapi is
asyncio-only, and no runner in this fork does async work today, so there is
no in-repo pattern to copy. This test pins the exact call shape a
synchronous caller has to use and proves it survives being called more than
once in the same process, which is what an RQ worker does across queries.

The agent side is a plain UDP socket that decodes and encodes using
pysnmp's own low-level v2c message API (``pysnmp.proto.api.v2c``), so only
the socket loop is hand-rolled: the SNMP encoding and decoding on both ends
of the wire is the real library, not a mock of it.
"""

import asyncio
import socket
import threading
import time
from unittest import TestCase

import pysnmp.hlapi.v3arch.asyncio as hlapi
from pyasn1.codec.ber import decoder, encoder
from pysnmp.proto.api import v2c

SYS_DESCR_OID = "1.3.6.1.2.1.1.1.0"
SYS_DESCR_VALUE = "canned NTCIP smoke agent"
UNSERVED_OID = "1.3.6.1.2.1.1.99.0"
COMMUNITY = "public"


def _serve_one(sock):
    """Decode one SNMP v2c GET request and reply with a canned response."""
    data, addr = sock.recvfrom(4096)
    req_msg, _ = decoder.decode(data, asn1Spec=v2c.Message())
    req_pdu = v2c.apiMessage.get_pdu(req_msg)
    oid = str(v2c.apiPDU.get_varbind_list(req_pdu)[0][0])

    rsp_pdu = v2c.apiPDU.get_response(req_pdu)
    if oid == SYS_DESCR_OID:
        v2c.apiPDU.set_varbinds(rsp_pdu, [(oid, v2c.OctetString(SYS_DESCR_VALUE))])
    else:
        # The exact shape Task 3's decode layer has to branch on: pysnmp
        # does not raise for a v2c GET of an OID the agent does not serve,
        # it returns this typed sentinel value in the varbind instead.
        v2c.apiPDU.set_varbinds(rsp_pdu, [(oid, v2c.NoSuchObject(""))])

    rsp_msg = v2c.Message()
    v2c.apiMessage.set_defaults(rsp_msg)
    v2c.apiMessage.set_community(rsp_msg, COMMUNITY)
    v2c.apiMessage.set_pdu(rsp_msg, rsp_pdu)
    sock.sendto(encoder.encode(rsp_msg), addr)


class _CannedAgent:
    """A UDP socket that answers one request at a time, on request.

    Each test calls serve_one_in_background() right before it triggers a
    client GET, so there is no long-lived background loop racing the test.
    """

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(2)
        self.port = self.sock.getsockname()[1]

    def serve_one_in_background(self):
        thread = threading.Thread(target=_serve_one, args=(self.sock,), daemon=True)
        thread.start()
        return thread

    def close(self):
        self.sock.close()


async def _get_cmd(port, oid, timeout=2):
    """The real pysnmp 7.x get_cmd path, exercised the way run_query has to.

    Retries are explicitly 0: pysnmp's transport default would silently
    double the query's time budget, which Task 4's deadline math depends on
    not happening.
    """
    snmp_engine = hlapi.SnmpEngine()
    try:
        return await hlapi.get_cmd(
            snmp_engine,
            hlapi.CommunityData(COMMUNITY, mpModel=1),  # v2c
            await hlapi.UdpTransportTarget.create(("127.0.0.1", port), timeout=timeout, retries=0),
            hlapi.ContextData(),
            hlapi.ObjectType(hlapi.ObjectIdentity(oid)),
        )
    finally:
        snmp_engine.close_dispatcher()


def sync_get(port, oid, timeout=2):
    """The sync/async boundary a synchronous run_query drives: asyncio.run()
    around a fresh SnmpEngine, once per call."""
    return asyncio.run(_get_cmd(port, oid, timeout=timeout))


class TestNtcipTransportSmoke(TestCase):
    def setUp(self):
        self.agent = _CannedAgent()
        self.addCleanup(self.agent.close)

    def test_get_cmd_decodes_a_real_scalar(self):
        self.agent.serve_one_in_background()
        error_indication, error_status, error_index, var_binds = sync_get(self.agent.port, SYS_DESCR_OID)

        self.assertIsNone(error_indication)
        self.assertEqual(int(error_status), 0)
        self.assertEqual(int(error_index), 0)
        self.assertEqual(len(var_binds), 1)
        _, value = var_binds[0]
        self.assertEqual(str(value), SYS_DESCR_VALUE)

    def test_missing_oid_returns_no_such_object_not_an_exception(self):
        self.agent.serve_one_in_background()
        error_indication, error_status, error_index, var_binds = sync_get(self.agent.port, UNSERVED_OID)

        self.assertIsNone(error_indication)
        self.assertEqual(int(error_status), 0)
        self.assertEqual(len(var_binds), 1)
        _, value = var_binds[0]
        self.assertIsInstance(value, hlapi.NoSuchObject)
        self.assertNotIsInstance(value, hlapi.NoSuchInstance)

    def test_asyncio_run_per_call_works_twice_in_one_process(self):
        """An RQ worker calls run_query many times in one process. A second
        asyncio.run() call must not trip over a leftover or closed event
        loop from the first."""
        self.agent.serve_one_in_background()
        first = sync_get(self.agent.port, SYS_DESCR_OID)
        self.assertIsNone(first[0])

        self.agent.serve_one_in_background()
        second = sync_get(self.agent.port, SYS_DESCR_OID)
        self.assertIsNone(second[0])
        self.assertEqual(str(second[3][0][1]), SYS_DESCR_VALUE)

    def test_asyncio_run_per_call_works_five_times_in_one_process(self):
        """Extend the two-call proof: five sequential run_query-shaped calls
        in the same process, none starved by a prior call's engine or
        transport."""
        for _ in range(5):
            self.agent.serve_one_in_background()
            error_indication, _, _, var_binds = sync_get(self.agent.port, SYS_DESCR_OID)
            self.assertIsNone(error_indication)
            self.assertEqual(str(var_binds[0][1]), SYS_DESCR_VALUE)

    def test_timeout_is_not_doubled_by_retries(self):
        """Nothing reads the socket, so the client must genuinely time out.
        Task 4's deadline math assumes pysnmp's transport-level retry
        default (which would double this) is turned off by retries=0."""
        silent_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        silent_sock.bind(("127.0.0.1", 0))
        silent_port = silent_sock.getsockname()[1]
        self.addCleanup(silent_sock.close)

        start = time.monotonic()
        error_indication, _, _, _ = sync_get(silent_port, SYS_DESCR_OID, timeout=1)
        elapsed = time.monotonic() - start

        self.assertIsNotNone(error_indication)
        # One timeout window, not two: retries=0 held.
        self.assertLess(elapsed, 1.8)
