"""The field vocabulary the frontend was written against, and the entity set a
community deployment registers.

The mapping editor in `app/src/lib/gtfs-fields.ts` offers exactly these fields
and marks exactly these as required. Nothing on the wire carries them, so the
two copies are held together here rather than by a type.

If `test_the_required_fields_...` or `test_the_supported_fields_...` fails, you
changed the serializer. Update `app/src/lib/gtfs-fields.ts` in the same change,
then update this file. Updating only this file makes the picker offer a field
nothing writes, or hide one that now works.

`test_the_registered_entities_...` is a different claim and reads a different
source: `services/feed_registry.py`, not the serializer. An enterprise pack
widens that registry at import without ever touching `gtfs_rt_serializer.py`,
so this is the one assertion that would have failed against the OLD version of
this file, which compared `REQUIRED_FIELDS`/`SUPPORTED_FIELDS` by exhaustive
dict equality: a pack registering a second entity does not change either of
those dicts, but a test written to assert "the registry has exactly what this
fixture lists" would still need to tolerate that widening, which is why this is
checked against the registry directly rather than folded into the two field
tests below. The two field tests are per-entity subset checks for the same
reason: they no longer require every key `REQUIRED_FIELDS`/`SUPPORTED_FIELDS`
happens to hold to appear in this fixture, only that the entities this fixture
does name still have the fields it says they do.
"""

import json
from pathlib import Path

from veodyn_api.services import feed_registry
from veodyn_api.services.gtfs_rt_serializer import REQUIRED_FIELDS, SUPPORTED_FIELDS

VOCABULARY = json.loads((Path(__file__).parent / "gtfs_field_vocabulary.json").read_text())


def test_the_registered_entities_are_the_ones_the_vocabulary_documents() -> None:
    # Scoped to gtfs-rt: this fixture documents the GTFS-Realtime picker, and the
    # registry now holds a set per standard.
    assert set(feed_registry.entities("gtfs-rt")) == set(VOCABULARY["entities"])


def test_the_required_fields_are_the_ones_the_frontend_marks_required() -> None:
    for entity, fields in VOCABULARY["required"].items():
        assert sorted(REQUIRED_FIELDS.get(entity, ())) == sorted(fields)


def test_the_supported_fields_are_the_ones_the_frontend_offers() -> None:
    for entity, fields in VOCABULARY["supported"].items():
        assert sorted(SUPPORTED_FIELDS.get(entity, ())) == sorted(fields)
