from datetime import datetime

from flask_restful import abort

from redash import models

STALE_MESSAGE = "This object changed since it was read."


def pop_expected(payload):
    if not isinstance(payload, dict):
        return None
    return payload.pop("expected_updated_at", None)


def parse_expected(expected):
    try:
        return datetime.fromisoformat(expected)
    except (TypeError, ValueError):
        abort(400, message="expected_updated_at is not a timestamp.")


def check_unchanged(model_cls, obj_id, expected):
    if expected is None:
        return

    parsed = parse_expected(expected)
    models.ApiKey.lock_before_row_lock(model_cls, obj_id)
    row = (
        models.db.session.query(model_cls)
        .filter(model_cls.id == obj_id)
        .with_for_update(of=model_cls)
        .populate_existing()
        .one_or_none()
    )
    if row is None:
        abort(409, message=STALE_MESSAGE)
    stored = row.updated_at
    serialized_precision = stored.replace(microsecond=stored.microsecond // 1000 * 1000)
    if parsed != stored and parsed != serialized_precision:
        abort(409, message=STALE_MESSAGE)
