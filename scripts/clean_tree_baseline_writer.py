"""Generating the ratchet for scripts/check-clean-tree.py, and refusing to.

Split out of clean_tree_report.py when the bucket declarations grew a second
selector kind and a status, purely to keep both files under this repo's
file-size limit. The seam is the one that module's own docstring already
named: everything here runs only under `--write-baseline`, and nothing here
runs on a checking run.

It takes `per_term` already counted rather than the raw sites, so it needs
nothing from clean_tree_report.py and nothing from this family is on
sys.path. check-clean-tree.py loads it by file path like every other module
here.

No identity term is written here, by the same rule that governs
scripts/clean_tree_identity_manifest.py.
"""

import sys


def regeneration_is_refused(previous, term_count, row_count, allow_shrink):
    """Compare the baseline about to be replaced against what is replacing it.

    The hole this closes: --write-baseline wrote the new fingerprint and the
    new counts without ever loading the old ones, so nothing in the documented
    regeneration path could notice the harvest getting smaller. A source whose
    extraction shape breaks (an array reformatted past the parser, ten terms
    becoming one) still clears the floor in MIN_HARVESTED_TERMS and still
    contributes "at least one term" to every per-source assertion, and once the
    new fingerprint is written every later run trusts it. That is a guard that
    cannot fail, reached through the command the docstring tells people to run.

    So: a shrinking term list refuses the write. Any shrink, not a threshold.
    Legitimate shrinks exist, above all the cutover scrub that takes the list
    to nothing, and they are exactly the moments a human should have to type
    --accept-fewer-terms and say why in the commit message.

    Returns True when the caller must not write.
    """
    if previous is None:
        print("check-clean-tree: no previous baseline to compare against; writing the first one.")
        return False
    was_terms = getattr(previous, "TERM_COUNT", None)
    print(
        f"check-clean-tree: regenerating. terms {was_terms} -> {term_count}, "
        f"rows {len(previous.BASELINE)} -> {row_count}, "
        f"fingerprint {previous.TERM_FINGERPRINT} -> ..."
    )
    if was_terms is None:
        print(
            "check-clean-tree: the previous baseline records no TERM_COUNT, so the size of the "
            "harvest it was written from is unknown and cannot be compared. Writing; the NEXT "
            "regeneration is comparable."
        )
        return False
    if term_count >= was_terms:
        return False
    if allow_shrink:
        print(
            f"check-clean-tree: the harvested term list SHRANK, {was_terms} to {term_count}. "
            "Accepted because --accept-fewer-terms was passed. Say in the commit message which "
            "source lost terms and why."
        )
        return False
    print(
        f"check-clean-tree: REFUSING to write. The harvested term list shrank from {was_terms} "
        f"to {term_count}, so this baseline would be written from a smaller vocabulary than the "
        "one it replaces, and every later run would trust the new fingerprint. Open the sources "
        "in IDENTITY_TERM_SOURCES and confirm the loss is deliberate rather than a parse that "
        "broke. If it is deliberate, re-run with --accept-fewer-terms.",
        file=sys.stderr,
    )
    return True


def write_baseline(path, counts, per_term, load_bearing, fingerprint, term_count):
    """Write the generated ratchet module. Paths, counts and term indices."""
    rows = sorted(
        (rel, count, tuple(sorted(per_term.get(rel, {}).items())))
        for rel, count in counts.items()
        if rel not in load_bearing
    )
    header = '"""Generated ratchet for scripts/check-clean-tree.py. Do not hand-edit.\n\n\
Regenerate with `python3 scripts/check-clean-tree.py --write-baseline`, and say in the\n\
commit message why a number moved. A row is (path, total, ((term index, occurrences),\n\
...)). Paths, counts and INDICES only: no identity term appears here, by the same rule\n\
that governs scripts/clean_tree_identity_manifest.py. An index resolves against the\n\
harvest sources that manifest declares, and TERM_FINGERPRINT below fails the run if\n\
those sources changed, so an index cannot come to mean a different term.\n\n\
The per-term column is not decoration. Without it the ratchet compared totals, and a\n\
swap nets zero: drop one occurrence of a term a file already carried, add a reference\n\
to a different term elsewhere in the same file, and the new one was absorbed silently.\n\n\
A row is not permission. It is the recorded size of an open decision, grouped and\n\
restated on every run by OPEN_DECISION_BUCKETS in clean_tree_identity_buckets.py.\n\
Growth fails, and reaching zero fails too, so a row cannot outlive the thing it\n\
describes. That holds for the buckets declared CLOSED as much as for the open ones:\n\
a settled question still has a size, and the size is still checked.\n\n\
TERM_COUNT is how many terms the harvest yielded when this file was written. The next\n\
--write-baseline compares against it and refuses a shrinking term list, so a source\n\
whose extraction quietly broke cannot be locked in by the regeneration path itself.\n"""\n'
    body = [
        header,
        f'\nTERM_FINGERPRINT = "{fingerprint}"\n',
        f"TERM_COUNT = {term_count}\n",
        "\nBASELINE = (\n",
    ]
    body += [f'    ("{rel}", {count}, {terms!r}),\n' for rel, count, terms in rows]
    body.append(")\n")
    path.write_text("".join(body), encoding="utf-8")
    print(f"check-clean-tree: wrote {len(rows)} baseline row(s) to {path}")
    return len(rows)
