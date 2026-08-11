"""Harvesting the identity terms, and compiling them into matchers.

Split out of scripts/check-clean-tree.py to keep that file under this repo's
file-size limit, and loaded by file path the way every module in this family
is. Its names are re-exported there, so a caller or a test still reaches
harvest_terms(), term_fingerprint() and build_matchers() as attributes of the
gate itself.

This is "what to look for". check-clean-tree.py is "where it is". Neither
file names an identity term: read clean_tree_identity_manifest.py for why
that rule exists and how IDENTITY_TERM_SOURCES satisfies it.
"""

import hashlib
import re
import sys

# Duplicated from check-clean-tree.py rather than imported, and it is the only
# thing that is. That file needs this value to report a module it cannot load,
# which includes THIS module, so importing it from here would be circular.
EXIT_CANNOT_CHECK = 2

# A floor, not a count. The two declared sources yield 25 terms today; this
# number exists to catch a harvest that returned nothing or nearly nothing (a
# source deleted, an array reformatted past the parser), so it has to sit well
# BELOW the real figure or it would fail on the correct answer. Deliberately
# not "== 25": adding a term to a source list is a normal edit and must not
# need this constant changed. test_check_clean_tree.py asserts both
# directions, that the real harvest clears the floor and that the floor is
# under what the real sources yield.
MIN_HARVESTED_TERMS = 10

# Only these join the alternation inside the tenant-email rule: a hostname
# label cannot contain a space, so the multi-word place names in the term list
# could never match there.
_DOMAIN_SAFE = re.compile(r"^[A-Za-z0-9.-]+$")


def _fail_to_check(message):
    print(f"check-clean-tree: {message}", file=sys.stderr)
    sys.exit(EXIT_CANNOT_CHECK)


def harvest_terms(root, sources):
    """Read the declared sources and return [(index, source label, pattern)].

    The index is this gate's public name for a term: the report says
    "term #7" and a maintainer resolves it by opening the source and counting.
    It stays stable as long as the source lists are appended to rather than
    reordered, and the fingerprint below fails the run if they are not.
    """
    terms = []
    for rel_path, symbol, extraction, _reason in sources:
        path = root / rel_path
        if not path.is_file():
            _fail_to_check(
                f"identity term source {rel_path} is gone. Its terms were this gate's only "
                "knowledge of what to look for, so this is a disarmed gate, not a clean tree. "
                "If the source left on purpose, this gate's declarations change in the same commit."
            )
        text = path.read_text(encoding="utf-8", errors="replace")
        if extraction == "regex-array":
            found = re.findall(r"^\s*/(.+?)/[a-z]*\s*,\s*$", text, re.M)
        elif extraction == "string-array":
            arrays = re.findall(r"for \(const \w+ of \[(.*?)\]\)", text, re.S)
            found = [re.escape(item) for item in re.findall(r"'([^']+)'", arrays[0])] if arrays else []
        else:
            _fail_to_check(f"unknown extraction {extraction!r} declared for {rel_path}")
        for pattern in found:
            terms.append((len(terms), f"{symbol} in {rel_path}", pattern))
    return terms


def term_fingerprint(terms):
    """Digest of the harvested list, so a reordered or edited source forces a
    regenerated baseline rather than silently remapping recorded counts onto
    different terms. Safe to print: every term is already plaintext in the
    sources this digests, so it discloses nothing the tree does not.
    """
    joined = "\n".join(f"{index}:{pattern}" for index, _source, pattern in terms)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


# A leading `test_` or a trailing `.test` / `_test` on a file name, stripped
# before a stem is compared against the harvest, so that a connector module and
# the test beside it land in the same bucket rather than in two.
_TEST_AFFIX = re.compile(r"^test[_-]|[._-]test$")

# What may sit between the stem and the extension. Nothing, or `.test`, and
# that is the whole list.
#
# This is deliberately a whitelist rather than "split on the first dot". A
# cross-model audit found that splitting let `<term>.private.py`,
# `<term>.backup.py` and `<term>.schema.json` all inherit the CLOSED
# public-connector verdict, because everything after the first dot was thrown
# away before the comparison. None of those is a connector module. The gate
# would still have FAILED such a file as a new row, so nothing could ship
# through it silently, but the failure line would have named it settled
# public-connector material, and a maintainer who believed that line could
# baseline a genuinely open customer-named file as closed. The bug was in what
# the report ASSERTS, not in what it catches, which is the harder kind to
# notice.
_ALLOWED_QUALIFIERS = ("", "test")


def _bucket_matcher(kind, value, terms):
    """One bucket selector, compiled into (predicate over a path, where).

    `where` is what the report prints beside the count, so a reader can see
    which files a bucket claims without opening the declarations.

    The name-is-a-term kind is why this lives here rather than beside the
    declarations: the only way to say "a file named after the service it talks
    to" without writing a term into a public file is to ask the harvested list
    at run time, and the harvested list is what this module owns.
    """
    if kind == "prefix":
        return (lambda path: path.startswith(value)), f"prefix {value!r}"
    if kind == "path-shape":
        shape = re.compile(value)
        return (lambda path: shape.search(path) is not None), f"path shape {value!r}"
    if kind == "name-is-a-term":
        home = re.compile(value)
        stems = [re.compile(pattern, re.I) for _index, _source, pattern in terms]

        def matches(path):
            if home.search(path) is None:
                return False
            name = path.rsplit("/", 1)[-1]
            parts = name.split(".")
            # parts[0] is the stem, parts[-1] the extension, and whatever sits
            # between them has to be a qualifier this selector recognises. A
            # name with no extension at all (parts of length 1) is a stem on
            # its own and passes with an empty qualifier.
            qualifier = ".".join(parts[1:-1]) if len(parts) > 1 else ""
            if qualifier not in _ALLOWED_QUALIFIERS:
                return False
            stem = _TEST_AFFIX.sub("", parts[0])
            return any(stem_pattern.fullmatch(stem) for stem_pattern in stems)

        return matches, f"a file name that is itself a harvested term, under {value!r}"
    _fail_to_check(f"unknown bucket selector kind {kind!r}; see clean_tree_identity_buckets.py")


def compile_buckets(buckets, terms):
    """The declared buckets as (matches, label, status, reason, where) rows, in
    declaration order, because the first one that matches a path wins.
    """
    compiled = []
    for (kind, value), label, status, reason in buckets:
        matches, where = _bucket_matcher(kind, value, terms)
        compiled.append((matches, label, status, reason, where))
    return tuple(compiled)


def build_matchers(terms, manifest):
    """One alternation over the terms, named groups so a match reports which
    term hit, plus the compiled shape rules.
    """
    try:
        combined = re.compile("|".join(f"(?P<t{index}>{pattern})" for index, _s, pattern in terms), re.I)
    except re.error as error:
        _fail_to_check(f"harvested terms do not compile as a regex: {error}")
    domains = "|".join(pattern for _i, _s, pattern in terms if _DOMAIN_SAFE.match(pattern))
    rules = []
    for rule_id, template, meaning, remedy in manifest.PATTERN_RULES:
        expanded = template.replace(manifest.TERMS_TOKEN, domains)
        rules.append((rule_id, re.compile(expanded, re.I), meaning, remedy))
    return combined, rules
