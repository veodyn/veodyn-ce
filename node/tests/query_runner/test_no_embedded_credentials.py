"""
No connector may ship a credential or a customer tenant id as a default, and
no credential-shaped literal may sit anywhere else in the tracked tree either.

Two guards live here:

1. An AST-based check, scoped to `redash/query_runner/*.py`, targeting the
   two concrete shapes a credential took in this codebase: a dict literal
   entry whose key is `"default"` and whose value is a secret-shaped string,
   wherever that entry sits inside a configuration_schema (regardless of
   whether the key and value are on the same source line); and a top-level
   module constant whose name ends in `_KEY`, `_TOKEN`, `_SECRET`,
   `_PASSWORD` or `_APPID`, assigned any string literal. The second check
   matches on the constant's name rather than the literal's shape or length,
   because Python folds adjacent string literals inside parentheses into a
   single AST constant at parse time, so a multi-line, parenthesized value
   (the shape the deleted Twitter bearer token actually shipped in) is
   caught exactly like a one-line value would be.

2. A repository-wide text scan for credential-shaped literals, over every
   tracked text file rather than only redash/query_runner/*.py. See
   credential_scan.py for what it covers and why: a live vendor key was
   found reproduced in this branch's own plan doc, a file the AST check
   above cannot see at all.
"""

import ast
import re
from pathlib import Path

import pytest

from tests.query_runner.credential_scan import (
    CREDENTIAL_SHAPED,
    credential_shaped_offenders_in_text,
    discover_tracked_text_files,
    password_shaped_offenders_in_text,
    scan_repo_for_credential_shaped_literals,
)

RUNNER_DIR = Path(__file__).resolve().parents[2] / "redash" / "query_runner"

# A value shaped like a key: a long unbroken run of hex, base64, or a UUID.
# Deliberately narrow, so a default like "metric" or 30 does not trip it.
SECRET_SHAPED = re.compile(
    r"""(?:
        [0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}
        | [0-9a-fA-F]{24,}
        | [A-Za-z0-9%+/=]{40,}
    )""",
    re.VERBOSE,
)

# A module-level constant name that says credential: AirNow's api_key and
# GO511's api_key were *_KEY, OpenWeatherMap's app_id shipped under an
# APPID-style name in other connectors of this family, and the deleted
# Twitter runner's bearer token was a *_TOKEN.
CREDENTIAL_NAME = re.compile(r"_(?:KEY|TOKEN|SECRET|PASSWORD|APPID)$")


def runner_sources():
    return sorted(p for p in RUNNER_DIR.glob("*.py") if p.name != "__init__.py")


def parse(path):
    return ast.parse(path.read_text(), filename=str(path))


def secret_shaped_defaults(tree):
    """Any `"default": <secret-shaped string>` entry in any dict literal."""
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for key, value in zip(node.keys, node.values):
            if (
                isinstance(key, ast.Constant)
                and key.value == "default"
                and isinstance(value, ast.Constant)
                and isinstance(value.value, str)
                and SECRET_SHAPED.search(value.value)
            ):
                offenders.append(f"line {getattr(key, 'lineno', '?')}: secret-shaped default")
    return offenders


def credential_named_constants(tree):
    """Any top-level `SOMETHING_KEY = "..."` (or _TOKEN/_SECRET/_PASSWORD/_APPID) assignment."""
    offenders = []
    for node in tree.body:
        if isinstance(node, ast.Assign):
            targets = node.targets
            value = node.value
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets = [node.target]
            value = node.value
        else:
            continue
        if not (isinstance(value, ast.Constant) and isinstance(value.value, str)):
            continue
        for target in targets:
            if isinstance(target, ast.Name) and CREDENTIAL_NAME.search(target.id):
                offenders.append(f"line {node.lineno}: {target.id} is a credential-named constant")
    return offenders


@pytest.mark.parametrize("path", runner_sources(), ids=lambda p: p.name)
def test_no_secret_shaped_default(path):
    offenders = secret_shaped_defaults(parse(path))
    assert offenders == [], f"{path.name}: " + "; ".join(offenders)


@pytest.mark.parametrize("path", runner_sources(), ids=lambda p: p.name)
def test_no_credential_named_constant(path):
    offenders = credential_named_constants(parse(path))
    assert offenders == [], f"{path.name}: " + "; ".join(offenders)


def test_runner_sources_is_non_empty():
    # A moved or renamed query_runner/ directory would make RUNNER_DIR wrong,
    # runner_sources() would return [], the two tests above would collect
    # zero parametrized cases, and the guard would report green having
    # checked nothing. Fail loudly instead.
    sources = runner_sources()
    assert len(sources) > 20, (
        f"expected dozens of runner modules under {RUNNER_DIR}, found {len(sources)}; "
        "the guard must not pass vacuously because its source directory moved"
    )


def test_repo_has_no_credential_shaped_literals():
    offenders = scan_repo_for_credential_shaped_literals()
    assert offenders == [], "credential-shaped literal(s) found:\n" + "\n".join(offenders)


def test_discovery_never_silently_returns_nothing():
    root, rel_paths = discover_tracked_text_files()
    assert rel_paths, f"file discovery under {root} returned nothing"


def test_credential_shaped_literal_in_markdown_is_flagged():
    text = "Some doc text.\n\napi_key: 5f3759df1f3759df1f3759df1f3759df1f3759d\n\nmore text\n"
    offenders = credential_shaped_offenders_in_text("docs/example.md", text)
    assert offenders, "a hex-shaped credential literal in a markdown file must be flagged"


def test_empty_tracked_file_list_fails_the_guard():
    with pytest.raises(AssertionError):
        scan_repo_for_credential_shaped_literals(discover=lambda: (Path("/nonexistent"), []))


def test_repo_wide_scan_respects_excludes(tmp_path):
    # helm/depends/vars/ used to be excluded here by path prefix, which is
    # exactly the hole that let a tracked credential go unflagged. It is
    # deliberately NOT excluded any more: this test now asserts the
    # opposite of what it used to, as a regression guard against that
    # exclusion quietly coming back. node_modules/ stays excluded by
    # directory name, unrelated to the removed prefix.
    fake_secret = "5f3759df1f3759df1f3759df1f3759df1f3759d"
    (tmp_path / "docs.md").write_text(f"leaked: {fake_secret}\n")
    vars_dir = tmp_path / "helm" / "depends" / "vars"
    vars_dir.mkdir(parents=True)
    (vars_dir / "values.yaml").write_text(f"leaked: {fake_secret}\n")
    node_modules_dir = tmp_path / "node_modules" / "somepkg"
    node_modules_dir.mkdir(parents=True)
    (node_modules_dir / "index.js").write_text(f"leaked: {fake_secret}\n")

    rel_paths = ["docs.md", "helm/depends/vars/values.yaml", "node_modules/somepkg/index.js"]
    offenders = scan_repo_for_credential_shaped_literals(discover=lambda: (tmp_path, rel_paths))

    flagged_paths = {offender.split(":", 1)[0] for offender in offenders}
    assert flagged_paths == {"docs.md", "helm/depends/vars/values.yaml"}


def test_extensionless_tracked_file_is_scanned_by_content(tmp_path):
    # The blind spot this whole guard exists to close: a suffix-less
    # filename list can never anticipate every name a credential file might
    # have, so an extensionless file must be scanned by sniffing its
    # content, not by extending that list.
    fake_secret = "5f3759df1f3759df1f3759df1f3759df1f3759d"
    (tmp_path / "secrets").write_text(f"leaked: {fake_secret}\n")
    rel_paths = ["secrets"]
    offenders = scan_repo_for_credential_shaped_literals(discover=lambda: (tmp_path, rel_paths))
    assert len(offenders) == 1
    assert offenders[0].startswith("secrets:")


def test_extensionless_binary_file_is_still_skipped(tmp_path):
    (tmp_path / "somebinary").write_bytes(b"\x00\x01\x02not-real-text\xff\xfe")
    rel_paths = ["somebinary"]
    offenders = scan_repo_for_credential_shaped_literals(discover=lambda: (tmp_path, rel_paths))
    assert offenders == []


def test_second_credential_on_a_line_is_flagged_even_when_the_first_is_allowlisted():
    # Both must be caught independently: a first-match search() would stop
    # at the allowlisted google_spreadsheets id and never see the real
    # secret sitting right after it on the same line.
    allowlisted_id = "1S0mld7LMbUad8LYlo13Os9f7eNjw57MqVC0YiCd1Jis"
    real_secret = "5f3759df1f3759df1f3759df1f3759df1f3759d"
    # Non-credential-shaped separators (quotes, a colon-space) on either side
    # so the two literals are distinct regex matches, the same as they would
    # be split in real source; CREDENTIAL_SHAPED's base64-ish branch itself
    # includes "=", so a bare "key=value" join would fuse them into one
    # token, which is not the scenario under test here.
    text = f'sheet="{allowlisted_id}" leaked: {real_secret}\n'
    offenders = credential_shaped_offenders_in_text("redash/query_runner/google_spreadsheets.py", text)
    assert len(offenders) == 1
    assert real_secret in offenders[0]
    assert allowlisted_id not in offenders[0]


def test_dockerfile_and_dotenv_example_are_scanned():
    # Neither has a suffix TEXT_EXTENSIONS recognizes on its own: Dockerfile
    # has no extension, and pathlib splits ".env.local.example" into stem
    # ".env.local" + suffix ".example". Both must still be scanned by
    # filename pattern.
    text = "ENV API_KEY=5f3759df1f3759df1f3759df1f3759df1f3759d\n"
    for rel_path in ("veodyn-de/Dockerfile", "veodyn-api/.env.example", "veodyn-de/.env.local.example"):
        offenders = credential_shaped_offenders_in_text(rel_path, text)
        assert offenders, f"{rel_path} must be scanned, not skipped as a non-text file"


def test_known_benign_literals_are_not_flagged():
    # query_runner/uptycs.py used to be the third file here. The connector
    # curation (docs/connector-curation.md) deleted it, and a target that no
    # longer exists fails this test on the count rather than on anything about
    # the scan. It is replaced by tests/query_runner/test_query_results.py
    # rather than by another connector, because uptycs.py carried no
    # allowlisted literal at all: it was a file with credential-shaped field
    # NAMES and nothing for the scan to allowlist. All three targets now carry
    # a real ALLOWLISTED_LITERALS entry, which is what this test claims to
    # exercise.
    root, rel_paths = discover_tracked_text_files()
    targets = [
        p
        for p in rel_paths
        if p.endswith(
            (
                "query_runner/google_spreadsheets.py",
                "tests/query_runner/test_query_results.py",
                "tests/query_runner/test_mongodb.py",
            )
        )
    ]
    assert len(targets) >= 3, f"expected to find the three known-benign files under {root}, found {targets}"
    offenders = []
    for rel_path in targets:
        text = (root / rel_path).read_text(encoding="utf-8")
        offenders.extend(credential_shaped_offenders_in_text(rel_path, text))
    assert offenders == [], offenders


def test_password_shaped_assignment_is_flagged_where_credential_shaped_misses_it():
    # A human-chosen password fixture, deliberately not hex, not a UUID, and
    # not 40+ base64-ish characters: CREDENTIAL_SHAPED is blind to it by
    # design, which is exactly the gap the second, assignment-shaped
    # detector exists to close (see credential_scan_password_shaped.py).
    fake_password = "NotHexOrBase64Shaped"
    text = f'postgresPassword: "{fake_password}"\n'
    assert not CREDENTIAL_SHAPED.findall(text), (
        "test fixture is invalid: the fixture value must NOT match CREDENTIAL_SHAPED, "
        "or this test would not be proving what it claims to"
    )
    offenders = password_shaped_offenders_in_text("helm/depends/vars/example-values.yml", text)
    assert offenders, "a password-shaped assignment must be flagged even when value-shape misses it"
    assert fake_password not in offenders[0], "the offender message must never carry the matched value"


def test_password_shaped_detector_does_not_fire_on_indirection_empty_or_placeholder():
    text = (
        'REDASH_HISTORICAL_CLICKHOUSE_PASSWORD: "secret:REDASH_HISTORICAL_CLICKHOUSE_PASSWORD"\n'
        'API_TOKEN: ""\n'
        'SECRET_KEY: "CHANGE_ME"\n'
    )
    offenders = password_shaped_offenders_in_text("helm/depends/vars/example-values.yml", text)
    assert offenders == [], offenders
