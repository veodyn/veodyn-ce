"""The field vocabulary the frontend was written against.

The mapping editor in `app/src/lib/gtfs-fields.ts` offers exactly these fields
and marks exactly these as required. Nothing on the wire carries them, so the
two copies are held together here rather than by a type.

If this fails, you changed the serializer. Update `app/src/lib/gtfs-fields.ts`
in the same change, then update this file. Updating only this file makes the
picker offer a field nothing writes, or hide one that now works.
"""

import json
from pathlib import Path

from veodyn_api.services.gtfs_rt_serializer import REQUIRED_FIELDS, SUPPORTED_FIELDS

VOCABULARY = json.loads((Path(__file__).parent / "gtfs_field_vocabulary.json").read_text())


def test_the_required_fields_are_the_ones_the_frontend_marks_required() -> None:
    expected = {entity: sorted(fields) for entity, fields in VOCABULARY["required"].items()}
    actual = {entity: sorted(fields) for entity, fields in REQUIRED_FIELDS.items()}
    assert actual == expected


def test_the_supported_fields_are_the_ones_the_frontend_offers() -> None:
    expected = {entity: sorted(fields) for entity, fields in VOCABULARY["supported"].items()}
    actual = {entity: sorted(fields) for entity, fields in SUPPORTED_FIELDS.items()}
    assert actual == expected
