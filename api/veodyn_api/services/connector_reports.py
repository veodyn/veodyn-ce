from typing import Any

from veodyn_api.services.connector_contract import (
    CredentialSchema,
    CredentialVerdict,
    DeliveryCode,
    DeliveryHandle,
    DeliveryOutcome,
    VerdictCode,
)
from veodyn_api.services.connector_registry import RegisteredConnector

VERDICT_SENTENCE: dict[VerdictCode, str] = {
    VerdictCode.REJECTED: "does not recognise the credentials this configuration offers",
    VerdictCode.EXPIRED: "reports that these credentials have expired",
    VerdictCode.INSUFFICIENT_SCOPE: "reports that these credentials lack the permission it needs",
    VerdictCode.MALFORMED: "could not read these credentials at all",
    VerdictCode.UNREACHABLE: "could not be reached to check these credentials",
    VerdictCode.UNSPECIFIED: "refused these credentials without giving a reason this service recognises",
}

DELIVERY_SENTENCE: dict[DeliveryCode, str] = {
    DeliveryCode.DELIVERED: "accepted the message",
    DeliveryCode.REJECTED_BY_CHANNEL: "rejected the message",
    DeliveryCode.CREDENTIALS_REJECTED: "rejected the credentials this configuration holds",
    DeliveryCode.CONTENT_REJECTED: "refused the rendering it was handed",
    DeliveryCode.RATE_LIMITED: "is rate limiting this agency",
    DeliveryCode.PARTIALLY_DELIVERED: (
        "accepted the message for some of its audience and reported that the rest did not receive it"
    ),
    DeliveryCode.RECALL_TARGET_GONE: (
        "no longer holds the post this correction would have edited, so nothing was corrected in place"
    ),
    DeliveryCode.CHANNEL_UNAVAILABLE: "could not be reached",
    DeliveryCode.CONNECTOR_RAISED: (
        "raised while delivering, and what it said is not recorded because it may quote the credential it holds"
    ),
    DeliveryCode.UNSPECIFIED: "did not deliver the message and gave no reason this service recognises",
}


def _verdict_code(reported: Any) -> VerdictCode:
    try:
        return VerdictCode(str(reported))
    except Exception:
        return VerdictCode.UNSPECIFIED


def _delivery_code(reported: Any) -> DeliveryCode:
    try:
        return DeliveryCode(str(reported))
    except Exception:
        return DeliveryCode.UNSPECIFIED


def _declared_only(schema: CredentialSchema, reported: Any) -> tuple[str, ...]:
    try:
        blamed = {str(name) for name in reported}
    except Exception:
        return ()
    return tuple(name for name in schema.names if name in blamed)


def _handle_only(reported: Any) -> DeliveryHandle | None:
    handle = getattr(reported, "reference", None)
    return handle if type(handle) is DeliveryHandle else None


def verdict_of(schema: CredentialSchema, reported: object) -> CredentialVerdict | None:
    if not isinstance(reported, CredentialVerdict):
        return None
    try:
        accepted = bool(reported.accepted)
    except Exception:
        return None
    return CredentialVerdict(
        accepted=accepted,
        code=_verdict_code(getattr(reported, "code", None)),
        fields=_declared_only(schema, getattr(reported, "fields", ())),
    )


def outcome_of(reported: object) -> DeliveryOutcome:
    if not isinstance(reported, DeliveryOutcome):
        return DeliveryOutcome(delivered=False, code=DeliveryCode.CONNECTOR_RAISED)
    try:
        delivered = bool(reported.delivered)
    except Exception:
        return DeliveryOutcome(delivered=False, code=DeliveryCode.CONNECTOR_RAISED)
    code = DeliveryCode.DELIVERED if delivered else _delivery_code(getattr(reported, "code", None))
    return DeliveryOutcome(delivered=delivered, code=code, reference=_handle_only(reported))


def refusal_sentence(connector: RegisteredConnector, verdict: CredentialVerdict) -> str:
    sentence = f"{connector.display_name} {VERDICT_SENTENCE[verdict.code]}."
    titles = connector.credential_schema.titles_of(frozenset(verdict.fields))
    if titles:
        sentence += f" It named {', '.join(titles)}."
    return f"{sentence} Nothing was stored."


def unreachable_sentence(connector: RegisteredConnector) -> str:
    return (
        f"{connector.display_name} {VERDICT_SENTENCE[VerdictCode.UNREACHABLE]}, so nothing was stored. "
        "What it said is not repeated here because it may quote the credential it was given."
    )


def delivery_sentence(connector: RegisteredConnector, outcome: DeliveryOutcome) -> str:
    return f"{connector.display_name} {DELIVERY_SENTENCE[outcome.code]}."
