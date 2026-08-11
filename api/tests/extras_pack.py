"""A stand-in for an installed pack, so the extras seam has something real to import.

Not named test_*, so pytest does not collect it. It registers on IMPORT, which
is the whole contract of the seam: naming a module in the env var is what turns
its contributions on, and nothing else does.
"""

from sqlalchemy.orm import Session

from veodyn_api.auth import Identity
from veodyn_api.errors import ErrorId
from veodyn_api.registry import ObjectType, register_object_type


def _allow(db: Session, identity: Identity, object_id: str) -> None:
    """No gate. A real pack would name its own rule here."""


register_object_type(
    ObjectType(
        kind="widget",
        not_found=ErrorId.DATASET_NOT_FOUND,
        taggable=True,
        favoritable=False,
        model=None,
        authorize_tag_write=_allow,
    )
)
