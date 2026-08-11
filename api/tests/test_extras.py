"""The router seam's front door: an env var listing dotted modules to import.

The shape mirrors REDASH_ADDITIONAL_QUERY_RUNNERS, and the failure mode it
exists to avoid is the one this repository has shipped three times: a feature
that is configured and silently absent. So the test that matters most here is
the one asserting a named module that cannot be imported RAISES.
"""

import sys
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from veodyn_api.extras import load_extra_modules
from veodyn_api.main import create_app
from veodyn_api.registry import empty_registries, object_kinds, restored_registries

PACK = "tests.extras_pack"


@pytest.fixture(autouse=True)
def _unimported_pack() -> Iterator[None]:
    """Registration happens at import, and an import happens once per process.
    Dropping the module makes each test import it for real rather than reading
    a cached module and registering nothing."""
    with restored_registries():
        saved = sys.modules.pop(PACK, None)
        try:
            yield
        finally:
            sys.modules.pop(PACK, None)
            if saved is not None:
                sys.modules[PACK] = saved


def test_a_named_module_is_imported_and_its_registrations_land() -> None:
    with empty_registries():
        assert load_extra_modules(PACK) == [PACK]

        assert object_kinds() == ("widget",)


def test_a_module_that_is_installed_but_not_named_does_not_register() -> None:
    """The pack is importable throughout this test. Not naming it is the whole
    difference, which is what makes CE with no packs the default rather than a
    special case."""
    with empty_registries():
        assert load_extra_modules("") == []

        assert object_kinds() == ()


def test_a_named_module_that_cannot_be_imported_is_an_error() -> None:
    with pytest.raises(ModuleNotFoundError):
        load_extra_modules("veodyn_api.does_not_exist")


def test_a_failure_inside_a_named_module_is_not_swallowed_either() -> None:
    """A pack that imports but blows up halfway is the same class of problem: it
    registered some of its surfaces and none of the rest."""
    with pytest.raises(ZeroDivisionError):
        load_extra_modules("tests.extras_broken_pack")


def test_several_modules_are_taken_in_order_and_whitespace_is_ignored() -> None:
    with empty_registries():
        assert load_extra_modules(f" {PACK} ,, tests.extras_pack ") == [PACK, PACK]


def test_the_app_loads_the_modules_the_setting_names(monkeypatch: pytest.MonkeyPatch) -> None:
    """The seam wired to its setting, not just the function. Without this,
    load_extra_modules could be perfect and never called."""
    monkeypatch.setenv("VEODYN_EXTRA_MODULES", PACK)
    from veodyn_api.settings import get_settings

    get_settings.cache_clear()

    with empty_registries():
        create_app()

        assert object_kinds() == ("widget",)


def test_the_app_comes_up_with_no_extra_modules_named() -> None:
    with empty_registries():
        assert TestClient(create_app()).get("/health").status_code == 200
