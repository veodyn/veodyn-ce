"""Fixtures shared by scripts/test_check_clean_tree.py.

Split out of that file purely to keep it under this repo's file-size limit,
the same way scripts/scan_secrets_test_support.py was.

The one thing worth reading here: PLANTABLE is *harvested*, not typed. The
tests need a real identity term to plant in a throwaway tree, and writing one
into a test file would put the customer's name in the public tree exactly as
surely as writing it into the manifest would. So it is read out of the same
declared source the gate reads, at run time, and this file names nothing.
"""

import importlib.util
import subprocess
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parent


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = load(SCRIPTS_DIR / "check-clean-tree.py", "check_clean_tree_under_test")
manifest = load(SCRIPTS_DIR / "clean_tree_identity_manifest.py", "clean_tree_manifest_under_test")
declared_buckets = load(SCRIPTS_DIR / "clean_tree_identity_buckets.py", "clean_tree_buckets_under_test")
baseline = load(SCRIPTS_DIR / "clean_tree_identity_baseline.py", "clean_tree_baseline_under_test")
report = load(SCRIPTS_DIR / "clean_tree_report.py", "clean_tree_report_under_test")
writer = load(SCRIPTS_DIR / "clean_tree_baseline_writer.py", "clean_tree_writer_under_test")

TERMS = gate.harvest_terms(REPO_ROOT, manifest.IDENTITY_TERM_SOURCES)

# The buckets as the gate itself compiles them: predicates over a path rather
# than the declared selectors, because a selector may be a question asked of
# the harvest and only the compiled form can answer it.
BUCKETS = gate.compile_buckets(declared_buckets.OPEN_DECISION_BUCKETS, TERMS)

# A term that is a plain literal rather than a regex, so it can be planted
# into a file as text and still match.
PLANTABLE = next(pattern for _index, _source, pattern in TERMS if gate._DOMAIN_SAFE.match(pattern))


def git(root, *args):
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def make_repo(root, files):
    """A throwaway repository. Files are staged, not committed: `git ls-files`
    reads the index, so no git identity has to be configured for the tests to
    run on a bare CI image.
    """
    git(root, "init", "-q")
    for rel_path, content in files.items():
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
    git(root, "add", "--", *files)
    return root


def scan_repo(root, files):
    """Build a throwaway repository and run the real scanner over it."""
    make_repo(root, files)
    combined, rules = gate.build_matchers(TERMS, manifest)
    return gate.scan(root, gate.git_tracked_paths(root), combined, rules, manifest)
