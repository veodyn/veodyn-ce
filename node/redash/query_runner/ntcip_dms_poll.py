"""
SNMP transport and the polling loop for the NTCIP 1203 DMS runner.

Split out of `ntcip_dms.py` to keep both files under the repo's 300-line
limit, the same reason the decode layer lives in its own sibling module,
and `ntcip_dms_rows` now owns the row/column shape for the same reason.
This module owns everything Task 1's transport proof and Task 4's timing
contract are about: the actual `asyncio.run()` call per device transaction,
device selection, the monotonic deadline, and turning device outcomes into
rows via `ntcip_dms_rows.blank_row`/`healthy_row`.

Call shape note (see task-1-report.md for the proof): one `asyncio.run()`
per device *transaction*, not per whole query and not per field. A
transaction here is one SNMP GET carrying every OID a resource needs as
separate varbinds in a single PDU ("one transaction per resource per
device, with the PDU/varbind list fixed per resource" per the plan), so a
device's per-transaction timeout bounds the whole resource fetch, not each
field individually. Confirmed directly against a real multi-varbind GET:
pysnmp echoes response varbinds in request order, so zipping the requested
field list against `var_binds` positionally is safe.
"""

import asyncio
import time

import pysnmp.hlapi.v3arch.asyncio as hlapi

from redash.query_runner.ntcip_dms_decode import OIDS, RESOURCE_FIELDS
from redash.query_runner.ntcip_dms_rows import blank_row, healthy_row

# Explicit, not pysnmp's transport default: that default retry would
# silently double every timeout budget the deadline math below depends on.
RETRIES = 0

# The whole-query budget is min(request_timeout, MAX_QUERY_TIMEOUT_SECONDS),
# never request_timeout alone: an operator-set request_timeout of, say, 300s
# must not let one query hold a worker for five minutes.
MAX_QUERY_TIMEOUT_SECONDS = 30

# v1 and v2c share this transport but differ in mpModel and in how a missing
# object is reported (see _poll_device below).
SNMP_MP_MODEL = {"1": 0, "2c": 1}


async def _get_cmd_async(host, port, oids, community, mp_model, timeout):
    async def _transaction():
        snmp_engine = hlapi.SnmpEngine()
        try:
            object_types = [hlapi.ObjectType(hlapi.ObjectIdentity(oid)) for oid in oids]
            return await hlapi.get_cmd(
                snmp_engine,
                hlapi.CommunityData(community, mpModel=mp_model),
                await hlapi.UdpTransportTarget.create((host, port), timeout=timeout, retries=RETRIES),
                hlapi.ContextData(),
                *object_types,
            )
        finally:
            # In a finally, not a trailing statement: task-1-report.md notes
            # the bare-call version was never actually exercised on a
            # failure path, so a failed or cancelled GET must still tear
            # its engine down.
            snmp_engine.close_dispatcher()

    # pysnmp's own `timeout` argument bounds only the GET's response wait.
    # UdpTransportTarget.create() awaits getaddrinfo outside that budget, so
    # a slow or hanging resolver would hold this coroutine, and the RQ
    # worker running it, past the whole-query deadline with nothing to stop
    # it. Wrapping the entire transaction (target creation through
    # cleanup), not just the GET, in a hard wait_for closes that gap: on
    # timeout the wrapped coroutine is cancelled, which still runs the
    # finally above, and asyncio.wait_for raises TimeoutError here, caught
    # by _poll_device below and turned into an "error" row.
    return await asyncio.wait_for(_transaction(), timeout=timeout)


def _sync_get(host, port, oids, community, mp_model, timeout):
    """The sync/async boundary a synchronous run_query has to cross: a
    fresh SnmpEngine and one asyncio.run() per device transaction, proven
    safe to call repeatedly in one worker process by Task 1."""
    return asyncio.run(_get_cmd_async(host, port, oids, community, mp_model, timeout))


def _poll_device(device, resource, community, mp_model, timeout):
    """
    Run one SNMP transaction for one device and resource. Returns
    (values, error): on success, values is a dict of field name -> raw
    varbind value (still undecoded, ready for the decode layer) and error
    is None; on failure, values is None and error is a message.

    v1 vs v2c missing-object semantics, handled here rather than assumed
    away: v2c reports a missing object per-varbind (a NoSuchObject/
    NoSuchInstance sentinel value with error_status left at 0), which the
    decode layer already treats as a missing field. v1's noSuchName
    poisons the whole varbind group instead: the response comes back with
    a non-zero error_status naming the offending index, and nothing in the
    PDU can be trusted as a per-field value at that point. Checking
    error_status generically, before ever looking at individual varbind
    values, covers both versions correctly without assuming v2c's
    finer-grained behavior also holds for v1.
    """
    fields = RESOURCE_FIELDS[resource]
    oids = [OIDS[field] for field in fields]

    try:
        error_indication, error_status, error_index, var_binds = _sync_get(
            device["host"], device["port"], oids, community, mp_model, timeout
        )
    except Exception as e:
        # Covers a transport-level failure and a whole-transaction timeout
        # alike (asyncio.wait_for's TimeoutError included): both are a
        # single device failing to answer, not a query-level condition, so
        # both become this device's "error" row.
        return None, f"SNMP transport failure: {e}"

    if error_indication is not None:
        return None, str(error_indication)

    if int(error_status) != 0:
        return None, f"SNMP error status {int(error_status)} at varbind index {int(error_index)}"

    values = {field: value for field, (_name, value) in zip(fields, var_binds)}
    return values, None


def select_devices(devices, requested_names, max_devices):
    """
    Resolve which configured devices a query polls.

    requested_names is params.devices: None selects every configured
    device, a list selects those names only. A name matching no configured
    device is a validation error, returned as (None, error), not a silent
    empty set. max_devices caps the fleet after selection either way.
    """
    if requested_names is None:
        selected = list(devices)
    else:
        if not isinstance(requested_names, list):
            return None, "params.devices: must be a list of device names"
        by_name = {device["name"]: device for device in devices}
        selected = []
        for name in requested_names:
            device = by_name.get(name)
            if device is None:
                return None, f"params.devices: {name!r} does not match a configured device"
            selected.append(device)

    return selected[:max_devices], None


def poll_devices(devices, resource, community, snmp_version, per_device_timeout, request_timeout):
    """
    Poll every device in order, honoring the whole-query deadline.

    A monotonic deadline of min(request_timeout, MAX_QUERY_TIMEOUT_SECONDS)
    is checked before each device's transaction, not just once up front,
    so a device that would push past it is never attempted: it becomes a
    "skipped" row instead. The transaction's own timeout is
    min(per_device_timeout, remaining_budget), so the last device polled
    cannot itself overrun the whole-query deadline by up to a full
    per_device_timeout.
    """
    mp_model = SNMP_MP_MODEL[snmp_version]
    deadline = time.monotonic() + min(request_timeout, MAX_QUERY_TIMEOUT_SECONDS)

    rows = []
    for device in devices:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            rows.append(blank_row(resource, device, "skipped", None))
            continue

        transaction_timeout = min(per_device_timeout, remaining)
        values, error = _poll_device(device, resource, community, mp_model, transaction_timeout)
        if error is not None:
            rows.append(blank_row(resource, device, "error", error))
        else:
            rows.append(healthy_row(resource, device, values))

    return rows


def aggregated_error(resource, rows):
    """
    The message returned as the query error when no row in `rows` is
    healthy. Distinguishes error/skipped counts rather than just saying
    "failed", since an operator seeing "3 skipped, 0 error" needs a
    different fix (raise request_timeout or per_device_timeout) than one
    seeing "3 error, 0 skipped" (check the devices themselves).
    """
    error_count = sum(1 for row in rows if row["poll_status"] == "error")
    skipped_count = sum(1 for row in rows if row["poll_status"] == "skipped")
    return (
        f"No device produced a healthy '{resource}' response "
        f"({error_count} error, {skipped_count} skipped, {len(rows)} polled)."
    )
