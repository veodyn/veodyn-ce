#!/usr/bin/env python3
"""Fail if the reference tenant's identity is spreading through this tree.

Run it with no arguments, from anywhere:

    python3 scripts/check-clean-tree.py

Regenerate the ratchet after a deliberate change:

    python3 scripts/check-clean-tree.py --write-baseline

That refuses to write if the harvested term list came out SMALLER than the
baseline it would replace, because a regeneration that cannot notice its own
vocabulary shrinking is a guard that cannot fail. Add --accept-fewer-terms
when the loss is deliberate, and say in the commit message what left.

`scripts/scan-secrets.py` owns credentials and
`scripts/check-public-tree.py` owns forbidden paths. Neither can see the third
way this tree stops being publishable: the customer staying identifiable from
a vocabulary spread across comments, fixtures, example values, file NAMES and
documentation.

Read scripts/clean_tree_identity_manifest.py first. It carries the
declarations, the reasons, and the decision that shapes everything here: this
gate names no identity term in its own source. It harvests them at runtime
from the guards in this tree that already carry them, and reports a position
and a term index, never a value, because its CI log is public.

How the verdict is reached, in order:

1. Terms are harvested from the declared sources. Fewer than
   MIN_HARVESTED_TERMS means a source was scrubbed or a parse broke, and the
   gate exits 2 rather than reporting a tree clean of something it never
   looked for.
2. PATTERN_RULES are shape detectors that name nothing. Their findings are
   fatal, except at the sites OPEN_PATTERN_SITES declares with a count.
3. LOAD_BEARING paths are reported with their reason. A declaration that
   matches nothing fails: a stale claim is an unguarded path.
4. Everything else is measured against scripts/clean_tree_identity_baseline.py,
   a ratchet rather than an exception list. A new path fails; a path over its
   recorded count fails; a path holding its total while gaining occurrences of
   a term it did not carry fails, because a swap nets zero; a path that reached
   zero fails. So the record cannot rot into a licence.

Reporting lives in scripts/clean_tree_report.py and baseline generation in
scripts/clean_tree_baseline_writer.py, both split out for file size only. How
a finding is grouped when it is reported, and which of those groups are still
questions, is declared in scripts/clean_tree_identity_buckets.py.

Stdlib only, no pytest, no third-party imports, so it runs on a bare
`python:3.11` image with git installed and nothing else. Tests live in
scripts/test_check_clean_tree.py and run under stdlib unittest.
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
MANIFEST_MODULE_PATH = SCRIPTS_DIR / "clean_tree_identity_manifest.py"
BUCKETS_MODULE_PATH = SCRIPTS_DIR / "clean_tree_identity_buckets.py"
BASELINE_MODULE_PATH = SCRIPTS_DIR / "clean_tree_identity_baseline.py"
REPORT_MODULE_PATH = SCRIPTS_DIR / "clean_tree_report.py"
HARVEST_MODULE_PATH = SCRIPTS_DIR / "clean_tree_harvest.py"
WRITER_MODULE_PATH = SCRIPTS_DIR / "clean_tree_baseline_writer.py"

EXIT_FOUND = 1
EXIT_CANNOT_CHECK = 2


def _load_by_path(name, path):
    """Load a module by file path rather than by package import, so this
    script needs nothing on sys.path. Same approach, and the same reasoning,
    as both sibling guards.
    """
    import importlib.util

    if not path.is_file():
        print(
            f"check-clean-tree: cannot find {name} at {path}. Without it this script has "
            "nothing to check and must not exit clean.",
            file=sys.stderr,
        )
        sys.exit(EXIT_CANNOT_CHECK)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Loaded at module scope and re-exported so these stay attributes of THIS
# module, which is where the tests reach them.
#
#   clean_tree_harvest    what to look for: reading the declared sources,
#                         fingerprinting the result, compiling the matchers
#                         and the bucket selectors that ask about a term.
#   clean_tree_report     the verdicts and the printing they feed.
harvest = _load_by_path("clean_tree_harvest", HARVEST_MODULE_PATH)
_fail_to_check = harvest._fail_to_check
_DOMAIN_SAFE = harvest._DOMAIN_SAFE
MIN_HARVESTED_TERMS = harvest.MIN_HARVESTED_TERMS
harvest_terms = harvest.harvest_terms
term_fingerprint = harvest.term_fingerprint
build_matchers = harvest.build_matchers
compile_buckets = harvest.compile_buckets

report = _load_by_path("clean_tree_report", REPORT_MODULE_PATH)
classify = report.classify
check_pattern_hits = report.check_pattern_hits
bucket_for = report.bucket_for


def git_tracked_paths(root):
    """Repo-relative paths of every tracked file. `-z` and a NUL split
    because a filename may legally contain a newline.
    """
    try:
        completed = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], capture_output=True, check=True)
    except FileNotFoundError:
        _fail_to_check("no `git` binary on PATH; this script reads the tree through git.")
    except subprocess.CalledProcessError as error:
        _fail_to_check(f"`git ls-files` failed in {root}: {error.stderr.decode('utf-8', 'replace').strip()}")
    paths = [chunk.decode("utf-8", "replace") for chunk in completed.stdout.split(b"\0") if chunk]
    if not paths:
        _fail_to_check(f"git lists zero tracked files under {root}; a broken check, not a clean tree.")
    return paths


def read_text_if_text(path):
    """None for anything that is not decodable UTF-8 text.

    A real gap: a term can reach a file this returns None for, because this
    tree ships screenshots of the running product. Declared in the manifest's
    NOT_CHECKED, which names the guard that covers painted text. The PATH of
    an undecodable file is still matched below.
    """
    try:
        return path.read_bytes().decode("utf-8")
    except (UnicodeDecodeError, OSError):
        return None


# The line number recorded for a match in a path rather than in a line of
# contents. Zero because no file has a line 0, so the report can tell the two
# apart without a second field. clean_tree_report.py reads the same convention.
PATH_LINENO = 0


def scan(root, rel_paths, combined, rules, manifest):
    """Return (counts_by_path, sites_by_path, pattern_hits, text_count, name_only_count).

    Every path that is not skipped outright is matched twice: once as a path
    string, and once line by line if it decodes as UTF-8. The path is matched
    because `git ls-files` publishes every name in the tree, so a file whose
    contents are generic but whose NAME is the customer identifies them.

    The shape rules run over contents only: an email address, a
    token-authenticated clone URL and a registry image path are none of them
    shapes a filename can hold.
    """
    counts, sites, pattern_hits, text_count, name_only_count = {}, {}, [], 0, 0
    deferred = tuple(prefix for prefix, _reason in manifest.DEFERRED_PREFIXES)
    for rel_path in rel_paths:
        if rel_path in manifest.SELF_REL_PATHS or rel_path.startswith(deferred):
            continue
        for match in combined.finditer(rel_path):
            counts[rel_path] = counts.get(rel_path, 0) + 1
            sites.setdefault(rel_path, []).append((PATH_LINENO, match.lastgroup))
        text = read_text_if_text(root / rel_path)
        if text is None:
            # Declared, not silent: manifest.NOT_CHECKED says what this misses
            # and what covers it, and the count is printed on every run.
            name_only_count += 1
            continue
        text_count += 1
        for lineno, line in enumerate(text.splitlines(), start=1):
            for match in combined.finditer(line):
                counts[rel_path] = counts.get(rel_path, 0) + 1
                sites.setdefault(rel_path, []).append((lineno, match.lastgroup))
            for rule_id, compiled, _meaning, _remedy in rules:
                for _match in compiled.finditer(line):
                    pattern_hits.append((rel_path, lineno, rule_id))
    if text_count == 0:
        _fail_to_check(
            f"{len(rel_paths)} tracked file(s) under {root} but zero opened and read as text; "
            "refusing to pass having inspected nothing."
        )
    return counts, sites, pattern_hits, text_count, name_only_count


def main(argv):
    manifest = _load_by_path("clean_tree_identity_manifest", MANIFEST_MODULE_PATH)
    declared_buckets = _load_by_path("clean_tree_identity_buckets", BUCKETS_MODULE_PATH)
    terms = harvest_terms(REPO_ROOT, manifest.IDENTITY_TERM_SOURCES)
    if len(terms) < MIN_HARVESTED_TERMS:
        _fail_to_check(
            f"harvested only {len(terms)} term(s), below the floor of {MIN_HARVESTED_TERMS}. The "
            "sources parsed but yielded almost nothing, so this run would have checked for "
            "almost nothing."
        )
    combined, rules = build_matchers(terms, manifest)
    buckets = compile_buckets(declared_buckets.OPEN_DECISION_BUCKETS, terms)
    counts, sites, pattern_hits, text_count, name_only_count = scan(
        REPO_ROOT, git_tracked_paths(REPO_ROOT), combined, rules, manifest
    )

    if "--write-baseline" in argv:
        load_bearing = {path for path, _reason in manifest.LOAD_BEARING}
        rows = sum(1 for path in counts if path not in load_bearing)
        # Load the baseline being REPLACED before replacing it, or the harvest
        # getting smaller cannot be noticed. See regeneration_is_refused.
        previous = None
        if BASELINE_MODULE_PATH.is_file():
            previous = _load_by_path("clean_tree_identity_baseline", BASELINE_MODULE_PATH)
        writer = _load_by_path("clean_tree_baseline_writer", WRITER_MODULE_PATH)
        if writer.regeneration_is_refused(previous, len(terms), rows, "--accept-fewer-terms" in argv):
            return EXIT_CANNOT_CHECK
        writer.write_baseline(
            BASELINE_MODULE_PATH,
            counts,
            report.per_term_counts(sites),
            load_bearing,
            term_fingerprint(terms),
            len(terms),
        )
        return 0

    baseline_module = _load_by_path("clean_tree_identity_baseline", BASELINE_MODULE_PATH)
    if baseline_module.TERM_FINGERPRINT != term_fingerprint(terms):
        _fail_to_check(
            "the harvested term list has changed since the baseline was written, so every "
            "recorded count now describes a different set of terms. Re-run with "
            "--write-baseline and say in the commit message what changed in the sources."
        )
    reported, new, grew, stale, improved, swapped = classify(
        counts, sites, manifest, baseline_module.BASELINE
    )
    findings = (new, grew, stale, swapped) + check_pattern_hits(pattern_hits, manifest)

    failed = report.print_failures(findings, sites, buckets)
    report.print_declarations(manifest, reported, terms, improved)
    report.print_open_decisions(baseline_module.BASELINE, buckets)
    if failed:
        return EXIT_FOUND
    print(
        f"\ncheck-clean-tree: clean. {text_count + name_only_count} path(s) matched against the "
        f"term list by name; {text_count} of those also read line by line as text, and "
        f"{name_only_count} did not decode as UTF-8 and were checked by name alone (see the NOT "
        "checked note above for what that misses and what covers it). Nothing outside the "
        "declarations above."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
