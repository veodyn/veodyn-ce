"""The word `feed` names one direction only: something this instance serves.

A module named `feed_*` is ambiguous by construction, because both the
monitoring side and the publishing side used that prefix and meant opposite
things. Monitoring modules are `capture_*`; publishing modules are
`published_feed_*`.
"""

from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent / "veodyn_api"


def test_no_bare_feed_module() -> None:
    """`public_feeds.py` and `published_feed_*.py` pass: each says which feed it
    means, so neither matches the two patterns below."""
    offenders = sorted(
        str(path.relative_to(PACKAGE))
        for path in PACKAGE.rglob("*.py")
        if path.name == "feeds.py" or path.name.startswith("feed_")
    )
    assert offenders == [], f"modules named for an ambiguous 'feed': {offenders}"
