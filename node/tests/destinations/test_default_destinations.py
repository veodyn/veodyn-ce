"""The destination set this edition ships, asserted rather than assumed.

Two channels, and the curation reasoning is in docs/connector-curation.md:
`email` needs no third-party account and `webhook` is the generic escape hatch.
Anything else is a module installed into the image and named in
REDASH_ADDITIONAL_DESTINATIONS, which the loader treats exactly like one of
these (redash/settings/__init__.py, redash/__init__.py:66).

Why this file exists at all. The list it guards is three lines of literals with
no other test over it, and the last change to it (dropping `slack`) broke
tests/factories.py in a way that pointed at NotificationDestination.to_dict()
rather than at the setting: `get_destination()` returns None for an unregistered
type and the AttributeError lands on `.icon()`, six frames from the cause. A
line added back here should fail loudly and in the right place.
"""

import importlib.util

from redash import settings
from redash.destinations import destinations

COMMUNITY_DESTINATIONS = [
    "redash.destinations.email",
    "redash.destinations.webhook",
]


def test_the_default_set_is_the_community_set():
    assert settings.default_destinations == COMMUNITY_DESTINATIONS


def test_no_module_backs_a_destination_this_edition_does_not_ship():
    # The default list and the modules on disk are separate facts, and the
    # failure mode is a module left behind after its entry was removed: still
    # importable, still registering itself the moment anything imports it, and
    # invisible to the assertion above.
    assert importlib.util.find_spec("redash.destinations.slack") is None


def test_the_registry_this_process_built_matches_the_default_set():
    # settings.default_destinations is a list of strings; this is what
    # import_destinations() actually put in the registry from it, which is the
    # thing /api/destinations/types serves. A module that fails to register
    # (see BaseDestination.enabled) changes this and not the list above.
    assert sorted(destinations) == ["email", "webhook"]
