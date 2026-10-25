from flask_restful import abort
from sqlalchemy.exc import IntegrityError

from redash import models

MAX_KEY_LENGTH = 200


def pop_key(payload):
    key = payload.pop("idempotency_key", None)
    if key is None:
        return None
    if not isinstance(key, str) or not key or len(key) > MAX_KEY_LENGTH:
        abort(400, message="idempotency_key must be a string of at most {} characters.".format(MAX_KEY_LENGTH))
    return key


def _find(org, user, key):
    return models.ClientOperation.query.filter(
        models.ClientOperation.org_id == org.id,
        models.ClientOperation.user_id == user.id,
        models.ClientOperation.key == key,
    ).first()


def refuse_different_request():
    abort(409, message="This idempotency_key was already used for a different request.")


def replay_or_none(org, user, key, model_cls, check=None):
    if key is None:
        return None

    operation = _find(org, user, key)
    if operation is None:
        return None

    if operation.object_type != model_cls.__tablename__:
        abort(409, message="This idempotency_key was already used for another kind of object.")

    try:
        existing = model_cls.get_by_id_and_org(operation.object_id, org)
    except models.NoResultFound:
        models.db.session.delete(operation)
        models.db.session.commit()
        return None

    if check is not None:
        check(existing)
    return existing


def record(org, user, key, object_type, obj):
    if key is None:
        return

    models.db.session.add(obj)
    models.db.session.flush()
    models.db.session.add(
        models.ClientOperation(org_id=org.id, user_id=user.id, key=key, object_type=object_type, object_id=obj.id)
    )


def commit_or_winner(org, user, key, model_cls, check=None):
    try:
        models.db.session.commit()
    except IntegrityError:
        models.db.session.rollback()
        winner = replay_or_none(org, user, key, model_cls, check)
        if winner is None:
            raise
        return winner
    return None
