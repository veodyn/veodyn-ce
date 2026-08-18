"""Verdicts and reporting for scripts/check-clean-tree.py.

Loaded by that script by file path, which re-exports classify() and
check_pattern_hits() as its own attributes so a caller or a test reaches them
where its docstring says the verdict is reached. Baseline GENERATION is
further split into clean_tree_baseline_writer.py; none of it runs on a
checking run.

classify() and check_pattern_hits() are pure, touching no file and no
repository, which is what lets the tests drive them with a plain dict.

Everything printed here obeys the manifest's rule: a path, a line number and
a term's index in its source list, never the term. This output goes into a
public CI log. The module declares no identity term of its own, so it is not
in the manifest's SELF_REL_PATHS.
"""


def per_term_counts(sites):
    """{path: {term index: occurrences}} from the sites the scan collected.

    Indices, never values.
    """
    counted = {}
    for path, path_sites in sites.items():
        terms = counted.setdefault(path, {})
        for _lineno, group in path_sites:
            index = int(group[1:])
            terms[index] = terms.get(index, 0) + 1
    return counted


def classify(counts, sites, manifest, baseline):
    """Split per-path counts into the verdicts. Pure, so the tests drive it
    with dicts instead of a repository.

    A baseline row is (path, count, per_term), per_term being a sorted tuple
    of (term index, occurrences). The per-term half is what catches a swap:
    drop one occurrence of a term a file already carried, add a reference to a
    DIFFERENT term in the same file, and the total nets zero. `swapped` is
    only collected when the total did NOT grow, since a growing total already
    fails as `grew`.

    Not covered: one occurrence of a term replaced by another occurrence of
    the SAME term in the same file. That is not new exposure, and pinning line
    numbers would churn every row on any unrelated edit above them.
    """
    load_bearing = {path for path, _reason in manifest.LOAD_BEARING}
    recorded = {path: count for path, count, _per_term in baseline}
    recorded_terms = {path: dict(per_term) for path, _count, per_term in baseline}
    observed_terms = per_term_counts(sites)
    reported, new, grew, stale, improved, swapped = [], [], [], [], [], []
    for path, reason in manifest.LOAD_BEARING:
        count = counts.get(path, 0)
        reported.append((path, reason, count))
        if count == 0:
            stale.append((path, "load-bearing declaration matches nothing"))
    for path, count in sorted(counts.items()):
        if path in load_bearing:
            continue
        if path not in recorded:
            new.append((path, count))
            continue
        if count > recorded[path]:
            grew.append((path, recorded[path], count))
            continue
        if count < recorded[path]:
            improved.append((path, recorded[path], count))
        for index, seen in sorted(observed_terms.get(path, {}).items()):
            before = recorded_terms[path].get(index, 0)
            if seen > before:
                swapped.append((path, index, before, seen, recorded[path], count))
    for path, count in sorted(recorded.items()):
        if counts.get(path, 0) == 0:
            stale.append((path, f"baseline records {count} but the path now matches nothing"))
    return reported, new, grew, stale, improved, swapped


def check_pattern_hits(pattern_hits, manifest):
    """Shape-rule findings are fatal unless OPEN_PATTERN_SITES declares the
    exact path, rule and count. One more than declared fails; a declaration
    that matches nothing fails as stale.
    """
    declared = {(path, rule_id): count for path, rule_id, count, _r in manifest.OPEN_PATTERN_SITES}
    seen, fatal = {}, []
    for path, lineno, rule_id in pattern_hits:
        seen[(path, rule_id)] = seen.get((path, rule_id), 0) + 1
        if (path, rule_id) not in declared:
            fatal.append((path, lineno, rule_id))
    over = [
        (key[0], key[1], declared[key], count)
        for key, count in sorted(seen.items())
        if key in declared and count > declared[key]
    ]
    return fatal, over, sorted(key for key in declared if key not in seen)


# Mirrored from clean_tree_identity_buckets.py rather than imported, because
# nothing in this family is on sys.path. test_check_clean_tree_declarations.py
# asserts every declared status is one of these, so they cannot drift.
OPEN = "open"
CLOSED = "closed"

# What a run says above each group. A closed bucket is still printed and still
# counted; the heading is the whole difference between the two.
STATUS_HEADINGS = (
    (OPEN, "OPEN DECISIONS. Counted, not resolved."),
    (CLOSED, "SETTLED. Still counted, because an answer has a size and the size is checked."),
)


def bucket_for(path, buckets):
    """First matching selector wins, so the catch-all must stay last. Takes the
    COMPILED buckets: clean_tree_harvest.compile_buckets turns each declared
    selector into the predicate this reads.
    """
    for matches, label, status, reason, _where in buckets:
        if matches(path):
            return label, status, reason
    return "ungrouped", OPEN, "no bucket matched, so OPEN_DECISION_BUCKETS has lost its catch-all"


def _print_sites(path, sites):
    # Line 0 is check-clean-tree.py's PATH_LINENO: the term is in the file's
    # NAME. The remedy differs (rename the file, rather than edit a line), so
    # the output has to say which it is.
    for lineno, group in sites.get(path, []):
        where = " (in the file name)" if lineno == 0 else f":{lineno}"
        print(f"    {path}{where}: identity term #{group[1:]}")


def print_failures(findings, sites, buckets):
    """Print every verdict that fails the run. Returns True if any did."""
    new, grew, stale, swapped, fatal, over, empty = findings
    for path, count in new:
        label, _status, _reason = bucket_for(path, buckets)
        print(f"FAIL new: {path} ({count} occurrence(s), bucket: {label})")
        _print_sites(path, sites)
    for path, was, now in grew:
        print(f"FAIL grew: {path} was {was}, now {now}")
        _print_sites(path, sites)
    for path, index, before, seen, was_total, now_total in swapped:
        print(
            f"FAIL swapped: {path} carries {seen} occurrence(s) of identity term #{index}, "
            f"up from {before}, while its total went {was_total} to {now_total}. A total that "
            "did not grow is not a tree that did not change."
        )
        _print_sites(path, sites)
    for path, why in stale:
        print(f"FAIL stale: {path}: {why}. Remove the declaration in the same commit.")
    for path, lineno, rule_id in fatal:
        print(f"FAIL {rule_id}: {path}:{lineno}")
    for path, rule_id, declared, count in over:
        print(f"FAIL {rule_id}: {path} declares {declared} site(s) but {count} were found")
    for path, rule_id in empty:
        print(f"FAIL: OPEN_PATTERN_SITES declares {rule_id} at {path}, which no longer matches it")
    failed = any(findings)
    if failed:
        print(
            "\nA term index resolves against the source named below: open that file and count "
            "to it. Fix the site if the reference is stray. If it genuinely has to stay, say so "
            "in scripts/clean_tree_identity_manifest.py, because a raised baseline number on its "
            "own records nothing."
        )
    return failed


def print_declarations(manifest, reported, terms, improved):
    """Printed on every run, including a clean one: the run that says "clean"
    is the one that has to keep saying what it is not looking at.
    """
    print("\ncheck-clean-tree: declarations in force on this run:")
    for path, reason, count in reported:
        print(f"  load-bearing: {path} ({count} occurrence(s)): {reason}")
    for prefix, reason in manifest.DEFERRED_PREFIXES:
        print(f"  NOT scanned, with an expiry: {prefix}: {reason}")
    for subject, reason in manifest.NOT_CHECKED:
        print(f"  NOT checked: {subject}: {reason}")
    for path, rule_id, count, reason in manifest.OPEN_PATTERN_SITES:
        print(f"  open pattern site: {path} ({rule_id}, {count} site(s)): {reason}")
    for path, was, now in improved:
        print(f"  improved: {path} was {was}, now {now}. Re-run --write-baseline to lock it in.")
    sources = sorted({source for _index, source, _pattern in terms})
    print(f"  {len(terms)} term(s) harvested from: {', '.join(sources)}")


def print_open_decisions(baseline, buckets):
    """The declared buckets, counted and restated every run.

    Each bucket prints the question, its current size and who owns it, so this
    does not read as an exception list. Two headings, because one number
    covering several questions overstates whichever is cheapest to fix. A
    closed bucket still prints and still carries its count: the heading says
    the question has an answer, not that the files stopped being watched.
    """
    grouped = {}
    for path, count, _per_term in baseline:
        label, _status, reason = bucket_for(path, buckets)
        entry = grouped.setdefault(label, {"reason": reason, "files": 0, "hits": 0})
        entry["files"] += 1
        entry["hits"] += count
    for status, heading in STATUS_HEADINGS:
        print(f"\ncheck-clean-tree: {heading}")
        for _matches, label, bucket_status, _reason, where in buckets:
            entry = grouped.get(label)
            if entry is None or bucket_status != status:
                continue
            print(f"\n  {label}: {entry['files']} file(s), {entry['hits']} occurrence(s), {where}")
            print(f"    {entry['reason']}")
