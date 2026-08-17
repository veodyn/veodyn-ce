"""The assignment-shaped half of the credential scan.

Split out of test_no_embedded_credentials.py, which holds the AST check over
`redash/query_runner/*.py` and the repository-wide value-shape scan. This file
covers the second detector only: the one that reads the KEY of an assignment
rather than the shape of its value, so it catches a human-chosen password that
`CREDENTIAL_SHAPED` is blind to (credential_scan_password_shaped.py).

Its cases are all about the key-name judgement, which is where the detector's
false positives and its holes both come from, so they are worth reading
together rather than interleaved with the value-shape cases.
"""

from tests.query_runner.credential_scan import (
    CREDENTIAL_SHAPED,
    password_shaped_offenders_in_text,
)


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


def test_password_shaped_detector_skips_keys_that_address_a_secret():
    # Three ways a deploy values file points AT a credential without holding
    # one: the name of a Secret object, the same thing under the chart's own
    # convention, and the vault path the 1Password operator resolves. All
    # three read as secret-ish to the key regex and none carries a value.
    text = (
        'existingSecret: "veodyn-de-secret"\n'
        'SharedSecretName: "veodyn-de-secret"\n'
        'onePasswordItemPath: "vaults/k8s/items/prod-veodyn-de"\n'
    )
    offenders = password_shaped_offenders_in_text("helm/envs/values-prod.yaml", text)
    assert offenders == [], offenders


def test_addressing_exemption_is_exact_and_does_not_excuse_lookalike_keys():
    # The exemption above is an exact-key list, deliberately not a "key
    # contains path/secret" rule. Without this test it could be widened to a
    # suffix match and nothing would notice, which would turn a carve-out into
    # a hole: `SECRET_PATH` and `onePasswordItemSecret` are both plausible key
    # names for something that really does hold a value.
    #
    # Non-hex and non-base64 for the same reason the fixture above is: this
    # file is tracked, so the repository-wide value-shape scan reads it too,
    # and a 32-char hex fixture here is indistinguishable from a real key. It
    # was one, briefly, and the scan caught it the moment the file was
    # committed.
    fake_credential = "NotHexOrBase64ShapedEither"
    text = f'SECRET_PATH: "{fake_credential}"\nonePasswordItemSecret: "{fake_credential}"\n'
    assert not CREDENTIAL_SHAPED.findall(text), (
        "test fixture is invalid: a value-shaped fixture in a tracked file trips the "
        "repository-wide scan, and this test does not need one"
    )
    offenders = password_shaped_offenders_in_text("helm/envs/values-prod.yaml", text)
    assert len(offenders) == 2, offenders
    for offender in offenders:
        assert fake_credential not in offender, "the offender message must never carry the matched value"
