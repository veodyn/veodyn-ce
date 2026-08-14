import hashlib
import logging

from flask import render_template
from itsdangerous import URLSafeTimedSerializer

from redash import settings
from redash.tasks import send_mail
from redash.utils import base_url

logger = logging.getLogger(__name__)
serializer = URLSafeTimedSerializer(settings.SECRET_KEY)

# One salt per purpose. Without them all three link kinds were the same string,
# so a verification link mailed to a user was byte-for-byte a password-reset
# credential and could be replayed against the reset endpoint. itsdangerous
# folds the salt into the signing key, so a token minted for one purpose fails
# signature validation against another.
INVITE_SALT = "invite"
RESET_SALT = "reset"
VERIFY_SALT = "verify"


def password_stamp(user):
    """A short digest of the user's current password hash.

    Signing this alongside the user id is what gives these tokens single-use
    semantics without a new column: setting a password changes the hash, so
    every token minted before that stops validating. A digest rather than the
    hash itself, so no credential material travels in the URL.

    `or ""` covers an invited user who has never had a password. The value is
    stable across the GET and the POST of one invite flow and changes exactly
    once, when the POST sets the password.
    """
    return hashlib.sha256((user.password_hash or "").encode()).hexdigest()[:16]


def invite_token(user, salt=INVITE_SALT):
    return serializer.dumps([str(user.id), password_stamp(user)], salt=salt)


def verify_link_for_user(user):
    token = invite_token(user, salt=VERIFY_SALT)
    verify_url = "{}/verify/{}".format(base_url(user.org), token)

    return verify_url


def invite_link_for_user(user):
    token = invite_token(user, salt=INVITE_SALT)
    invite_url = "{}/invite/{}".format(base_url(user.org), token)

    return invite_url


def reset_link_for_user(user):
    token = invite_token(user, salt=RESET_SALT)
    invite_url = "{}/reset/{}".format(base_url(user.org), token)

    return invite_url


def validate_token(token, salt):
    """Return (user_id, stamp) for a token minted under `salt`.

    The stamp is not checked here, because checking it needs the user and the
    id is what says which user to load. _resolve_token_user in
    handlers/authentication.py does both halves together; nothing else should
    call this without following it with that comparison.
    """
    max_token_age = settings.INVITATION_TOKEN_MAX_AGE
    user_id, stamp = serializer.loads(token, max_age=max_token_age, salt=salt)
    return user_id, stamp


def send_verify_email(user, org):
    context = {"user": user, "verify_url": verify_link_for_user(user)}
    html_content = render_template("emails/verify.html", **context)
    text_content = render_template("emails/verify.txt", **context)
    subject = "{}, please verify your email address".format(user.name)

    send_mail.delay([user.email], subject, html_content, text_content)


def send_invite_email(inviter, invited, invite_url, org):
    # base_url(org) is the same call the setup link (invite_url, above) is
    # built from. The "Your Redash account is" line used to be built
    # separately with url_for('redash.index', ..., _external=True), which
    # resolves to this API's own host rather than UI_BASE_URL, same family
    # of bug as the "/" redirect loop (settings/__init__.py). Passing it
    # through the same base_url() keeps both links pointed at one place.
    context = dict(inviter=inviter, invited=invited, org=org, invite_url=invite_url, base_url=base_url(org))
    html_content = render_template("emails/invite.html", **context)
    text_content = render_template("emails/invite.txt", **context)
    subject = "{} invited you to join Redash".format(inviter.name)

    send_mail.delay([invited.email], subject, html_content, text_content)


def send_password_reset_email(user):
    reset_link = reset_link_for_user(user)
    context = dict(user=user, reset_link=reset_link)
    html_content = render_template("emails/reset.html", **context)
    text_content = render_template("emails/reset.txt", **context)
    subject = "Reset your password"

    send_mail.delay([user.email], subject, html_content, text_content)
    return reset_link


def send_user_disabled_email(user):
    html_content = render_template("emails/reset_disabled.html", user=user)
    text_content = render_template("emails/reset_disabled.txt", user=user)
    subject = "Your Redash account is disabled"

    send_mail.delay([user.email], subject, html_content, text_content)
