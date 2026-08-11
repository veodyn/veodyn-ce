"""Matching core for the assignment-shape credential detector.

Split out of credential_scan_password_shaped.py purely for the file-size
hook: that module was already at this repo's 300-line limit before it grew
a hashing entry point (password_shaped_hashes_in_text, added for
scripts/scan-secrets.py's KNOWN_EXCEPTIONS guard). This module owns every
regex and the literal-resolution pipeline; credential_scan_password_shaped.py
is now the thin public surface that both test_no_embedded_credentials.py and
credential_scan.py import from, same relationship credential_scan.py has to
this whole family of modules. Added to credential_scan.py's SELF_PATHS for
the same self-match reason as its sibling: its docstrings and comments use
the words (password, secret, token) the detector below matches on.

`_password_shaped_findings_in_line` is deliberately not exported past this
pair of modules: it is the only place the actual matched literal exists in
memory. The public functions in credential_scan_password_shaped.py either
discard it (returning only a description) or hash it (returning a one-way
digest), so nothing further downstream ever sees a credential value.
"""

import re
from pathlib import Path

# Assignment shape (`key: value`, `KEY=value`, `--flag value`) is only
# low-noise in an actual deploy/config file. The same colon syntax is also
# how every TypeScript interface field, every Python/JS object literal, and
# most prose in docs/ is written, and running this detector unscoped over
# those found roughly 230 hits the very first time it ran repo-wide, nearly
# all of them a `apiKey: someVariable` object property, a `token: string`
# type field, or a test fixture's fake value, not a credential. Scoping to
# the file types this repo actually keeps deploy config in cuts that to the
# real ones, without narrowing the KEY or VALUE matching itself, which is
# what would risk missing a real credential that happens to sit in one of
# these files.
_DEPLOY_CONFIG_SUFFIXES = {".yml", ".yaml", ".sh", ".env", ".cfg", ".ini", ".toml", ".conf"}


def looks_like_deploy_config_file(rel_path):
    name = Path(rel_path).name
    if name.startswith(".env"):
        return True
    suffix = Path(rel_path).suffix
    if suffix in _DEPLOY_CONFIG_SUFFIXES:
        return True
    # Extensionless: Dockerfile, bin/run, an env-file with no suffix, and the
    # like. credential_scan.py's own is_excluded() already keeps this
    # detector from ever seeing an extensionless file that isn't plausibly
    # text (content-sniffed upstream), so there is no separate binary risk
    # to guard against here; scanning it is exactly what closes the same
    # blind spot CREDENTIAL_SHAPED closed for extensionless env files.
    return suffix == ""


# A key name that reads as "this holds a secret", matched as a
# case-insensitive substring so it catches snake_case, camelCase,
# kebab-case, and SCREAMING_SNAKE alike: `postgresPassword`,
# `CLICKHOUSE_PASSWORD`, `api-key`, `apikey`.
_SECRET_KEY_RE = re.compile(r"(password|passwd|secret|token|api[-_]?key)", re.IGNORECASE)

# Key names that contain one of the words above but name something other
# than a secret VALUE: a Kubernetes object's name (`secretName`,
# `registrySecretName`, `SharedSecretName` all point at a Secret resource,
# not hold one), or a duration/flag whose name happens to contain "token" or
# "password" (`invitationTokenMaxAge`, `passwordLoginEnabled`). Found by
# actually running this detector across helm/ during development; kept
# narrow and suffix-based so a real `somethingPasswordName` stays excluded
# without also excusing `apiKeyNamespace` or other words that merely start
# the same way.
_NON_SECRET_KEY_SUFFIXES = ("name", "maxage", "enabled")

# Exact key names (case-insensitive) that are a Helm/Kubernetes chart
# convention for "the name of an existing Secret object", never a literal
# value: a chart values file writing `redash.existingSecret: "some-secret"`
# is naming a Secret object the cluster already holds, not carrying its
# contents.
_NON_SECRET_EXACT_KEYS = frozenset({"existingsecret", "existingtoken"})


def _looks_like_secret_key(key):
    if not _SECRET_KEY_RE.search(key):
        return False
    lowered = key.lower()
    if lowered in _NON_SECRET_EXACT_KEYS:
        return False
    return not any(lowered.endswith(suffix) for suffix in _NON_SECRET_KEY_SUFFIXES)


_QUOTED_OR_TOKEN = r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|\S+'

# YAML `key: value`, optionally a `- key: value` list item, optionally a
# quoted key. Value is a quoted string, or a bare scalar up to a trailing
# `#` comment (YAML does not require quoting a scalar).
_YAML_ASSIGNMENT_RE = re.compile(
    r"""^\s*(?:-\s*)?['"]?(?P<key>[A-Za-z][A-Za-z0-9_.\-]*)['"]?\s*:\s*
        (?P<value>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s#][^\n#]*?)
        \s*(?:\#.*)?$""",
    re.VERBOSE,
)

# Shell `KEY=value`, searched anywhere on the line (not anchored to line
# start) so `PGPASSWORD="$POSTGRES_PASSWORD" psql ...` still matches the
# assignment even though the rest of the line is a command. The key must be
# preceded by start-of-line, whitespace, or `;`, which is what keeps this
# from also matching the `secretKey=` inside a compound
# `--from-literal=secretKey="${SECRET_KEY}"` flag value.
_SHELL_ASSIGNMENT_RE = re.compile(
    r"""(?:^|[\s;])(?P<key>[A-Za-z_][A-Za-z0-9_]*)=(?P<value>""" + _QUOTED_OR_TOKEN + r""")"""
)

# `--flag value` / `--flag=value` CLI form.
_FLAG_ASSIGNMENT_RE = re.compile(
    r"""--(?P<key>[A-Za-z][A-Za-z0-9_-]*)(?:=|\s+)(?P<value>""" + _QUOTED_OR_TOKEN + r""")"""
)

_ASSIGNMENT_PATTERNS = (_YAML_ASSIGNMENT_RE, _SHELL_ASSIGNMENT_RE, _FLAG_ASSIGNMENT_RE)

# A password embedded in a connection URI's userinfo, `scheme://user:pass@host`:
# the case that prompted this was a chart values key named
# `externalPostgreSQL`, which does not itself read as a secret at all, so this
# needs its own match, not just a wider key regex. `user` and `password` are
# resolved and validated the same way an assignment's value is (indirection,
# placeholder, length, literal-chars); the username is never a secret and is
# safe to name in the finding.
_URI_CREDENTIAL_RE = re.compile(
    r"""[A-Za-z][A-Za-z0-9+.\-]*://(?P<user>[^:/@\s"']*):(?P<password>[^@/\s"']+)@"""
)

# A resolved value made only of characters a typed-in password or token
# plausibly contains. This is what rejects a value that is not actually a
# literal: `${PROD_RELEASE}-redash` (a Secret name built from a variable),
# `$(openssl rand -base64 32)` (a command substitution), or
# `{{ .host }}-tls` (a Helm template expression with a literal suffix) all
# still contain `$`, `{`, `}`, `(`, or `)` after quote-stripping and are
# rejected here, without needing a special case for each shape.
_LITERAL_VALUE_RE = re.compile(r"^[\w!@#%^&*+=./:,~-]+$")

# A value that IS one of these shell indirections, resolved before the
# literal-character check above ever runs.
_SHELL_EXPANSION_RE = re.compile(r"^\$\{(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)(?::-(?P<default>.*))?\}$")
_BARE_VAR_RE = re.compile(r"^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$")
_HELM_TEMPLATE_RE = re.compile(r"^\{\{.*\}\}$")

_EMPTY_VALUES = {"", "null", "~", "none"}

# CHANGE_ME*, PUT_*, <...>, xxx, example*, changeme: obvious placeholders a
# template or example file uses to show the shape of a value, not a value
# itself. A run of `*` is the same idea in a different spelling: found in
# helm/charts/flow/contrib-helm-chart/templates/configmap.yaml, which echoes
# a connection URL with its password masked as `******` for a log line, not
# leaked into it.
_PLACEHOLDER_RE = re.compile(
    r"""^(
        change_?me\w* |
        put_\w* |
        <[^>]*> |
        x{3,} |
        \*{3,} |
        example\w*
    )$""",
    re.IGNORECASE | re.VERBOSE,
)

# Shorter than this is almost always a flag, a short code, or a placeholder,
# not a real password or token.
_MIN_VALUE_LEN = 5


def _strip_quotes(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def _resolve_literal(raw_value):
    """Return the literal string this assignment actually writes, or None
    if it is not a literal credential candidate at all: a `secret:NAME`
    lookup, a Helm template expression, or a shell variable reference with
    no default.
    """
    value = _strip_quotes(raw_value)

    if value.lower().startswith("secret:"):
        return None
    if _HELM_TEMPLATE_RE.match(value):
        return None

    expansion = _SHELL_EXPANSION_RE.match(value)
    if expansion:
        default = expansion.group("default")
        if default is None:
            return None
        return _strip_quotes(default)

    if _BARE_VAR_RE.match(value):
        return None

    return value


def _is_placeholder(value):
    if value.lower() in _EMPTY_VALUES:
        return True
    return bool(_PLACEHOLDER_RE.match(value.strip()))


def _resolved_and_valid(raw_value):
    """Run a captured raw value through the shared resolve/placeholder/
    length/literal-chars pipeline. Returns the resolved literal, or None if
    it is not a credential candidate.
    """
    literal = _resolve_literal(raw_value)
    if literal is None:
        return None
    if _is_placeholder(literal):
        return None
    if len(literal) < _MIN_VALUE_LEN:
        return None
    if not _LITERAL_VALUE_RE.match(literal):
        return None
    return literal


def password_shaped_findings_in_line(line):
    """Yield (description, literal) for every password-shaped finding on
    `line` (an assignment's key name, or a connection URI's userinfo), once
    per matched span. Not re-exported past credential_scan_password_shaped.py:
    see this module's docstring for why the literal never travels further.

    A comment line (its first non-whitespace character is `#`) is skipped
    outright, not just for the YAML form (whose anchored key regex already
    cannot match past a leading `#`): the shell and `--flag` forms search
    the whole line rather than anchoring to its start, so
    `# export CI_TOKEN="your-ci-token"`, a usage example in a header
    comment, would otherwise match `CI_TOKEN=` as a real assignment. The
    real targets this detector exists for are never written as comments.
    """
    if line.lstrip().startswith("#"):
        return
    seen_spans = set()
    for pattern in _ASSIGNMENT_PATTERNS:
        for match in pattern.finditer(line):
            span = match.span()
            if span in seen_spans:
                continue
            key = match.group("key")
            if not _looks_like_secret_key(key):
                continue
            literal = _resolved_and_valid(match.group("value"))
            if literal is None:
                continue
            seen_spans.add(span)
            yield f"assignment for key {key!r}", literal

    # A connection URI (`postgresql://user:pass@host`) carries its password
    # in the userinfo, not behind any key at all: a chart values key named
    # `externalPostgreSQL` is the real example, and that key name does not
    # itself read as a secret.
    for match in _URI_CREDENTIAL_RE.finditer(line):
        span = match.span("password")
        if span in seen_spans:
            continue
        literal = _resolved_and_valid(match.group("password"))
        if literal is None:
            continue
        seen_spans.add(span)
        yield f"connection URI password (user {match.group('user')!r})", literal
