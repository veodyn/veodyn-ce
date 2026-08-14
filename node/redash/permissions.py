import functools
import hmac

from flask_login import current_user
from flask_restful import abort
from funcy import flatten

view_only = True
not_view_only = False

ACCESS_TYPE_VIEW = "view"
ACCESS_TYPE_MODIFY = "modify"
ACCESS_TYPE_DELETE = "delete"

ACCESS_TYPES = (ACCESS_TYPE_VIEW, ACCESS_TYPE_MODIFY, ACCESS_TYPE_DELETE)

# Permission strings this product adds on top of upstream Redash. Upstream does
# not know they exist, so they will never appear in Group.DEFAULT_PERMISSIONS or
# Group.ADMIN_PERMISSIONS and cannot be discovered from the model. Listing them
# here is what lets the group admin endpoint accept them while still rejecting a
# typo; adding a future product permission is one line.
#
# "publish_report" is checked by veodyn-api, "publish_dashboard" and
# "publish_visualization" by this fork's share handlers, and "no_export_data" by
# the frontend. All four are stored on a Redash group, so all four have to be
# assignable here whether or not the check lives in this codebase.
PRODUCT_PERMISSIONS = [
    "publish_report",
    "publish_dashboard",
    "publish_visualization",
    "no_export_data",
]

# Permissions only an existing super admin may grant or revoke. "super_admin"
# gates /status.json and the /api/admin endpoints, which report on the whole
# instance rather than on one organization, so an org admin who could put it on
# a group of their own would hold those endpoints one request later. Revoking is
# restricted for the mirror-image reason: an admin who could strip it off a
# group would be able to lock the super admins out and then be the only route
# back in.
SUPER_ADMIN_PERMISSIONS = ["super_admin"]


def assignable_permissions():
    """Every permission string that may be stored on a group."""
    # Imported here because redash.models imports this module transitively.
    from redash.models import Group

    return set(Group.DEFAULT_PERMISSIONS) | set(Group.ADMIN_PERMISSIONS) | set(PRODUCT_PERMISSIONS)


def restricted_permissions(user):
    """Permission strings `user` may neither grant nor revoke."""
    if user.has_permission("super_admin"):
        return set()

    return set(SUPER_ADMIN_PERMISSIONS)


def holds_restricted_permission(user):
    """Whether `user` holds a permission only a super admin may hand out.

    Absolute rather than measured against an actor, unlike
    restricted_permissions above. The question here is not "may this admin
    change it" but "is this account now worth more than the credential somebody
    already holds for it", and nobody knows who that somebody is.
    """
    return bool(set(SUPER_ADMIN_PERMISSIONS).intersection(user.permissions))


def restricted_holders(users):
    """Which of `users` already hold such a permission, by id.

    Take this BEFORE applying a membership or permission change and hand it to
    rotate_promoted_api_keys afterwards. The pair is what distinguishes a
    crossing from a state, and only a crossing is worth a rotation.
    """
    return {user.id for user in users if holds_restricted_permission(user)}


def rotate_promoted_api_keys(users, held_before):
    """Rotate the api_key of everyone in `users` who has just crossed the line.

    An org admin may read another user's raw api_key while that account is
    ordinary (UserResource.get, gated by can_manage_account below), and at that
    moment the key is worth exactly what the account is worth. The check is
    right and it stays right; what it cannot do is stay right afterwards.
    Api-key authentication resolves the same user row on every request and reads
    the permissions held THEN (authentication.get_user_from_api_key), so a key
    captured while the account was ordinary starts authenticating as a super
    admin the moment somebody promotes it. The two events can be days apart and
    no race is involved.

    So the promotion is where the old credential dies. Both ways across the line
    have to call this, because they are the same event reached from opposite
    sides: putting the user into a group that already carries the permission,
    and putting the permission onto a group the user is already in.

    Crossing into "admin" alone is deliberately not a crossing. Only an org
    admin can read somebody else's key in the first place, and "admin" is a
    permission every org admin can already grant, so a key that grows it hands
    its reader nothing they did not have. Rotating there would break the scripts
    and dashboards people keep api keys in, for no gain.

    Call this with the change already in the session and before the commit, so
    the rotation and the promotion are the same transaction. A promotion that
    committed while its rotation failed would be the vulnerability with an
    audit trail.
    """
    from redash.models import db

    for user in users:
        if user.id in held_before or not holds_restricted_permission(user):
            continue

        user.regenerate_api_key()
        db.session.add(user)


def validated_permissions(group, permissions, user):
    """Return the permission list `user` may store on `group`, or None if unchanged."""
    from redash.models import Group

    if permissions is None:
        return None

    if not isinstance(permissions, list) or not all(isinstance(p, str) for p in permissions):
        abort(400, message="permissions must be a list of strings.")

    current = set(group.permissions or [])
    requested = set(permissions)

    # Only newly granted strings are validated against the catalog. Groups
    # predating this check can hold a string no longer in it, and the admin
    # client re-sends the whole group on every save
    # (client/app/components/groups/GroupName.jsx), so validating the full list
    # would turn a rename into a 400. Additions-only still makes it impossible
    # to introduce an unknown string, which is the point: a stored permission no
    # check reads looks granted and denies.
    unknown = sorted(requested - current - assignable_permissions())
    if unknown:
        abort(400, message="Unknown permissions: {}.".format(", ".join(unknown)))

    # The symmetric difference is every string this request would change, in
    # either direction, which is what the restricted set has to be measured
    # against rather than the additions alone.
    forbidden = sorted((requested ^ current) & restricted_permissions(user))
    if forbidden:
        abort(403, message="Only a super admin can grant or revoke: {}.".format(", ".join(forbidden)))

    if "admin" in current and "admin" not in requested and group.type == Group.BUILTIN_GROUP:
        # The builtin admin group is the one Redash guarantees exists
        # (models.init_db creates it per org), so it keeps "admin" on its own
        # account and not only as the last group standing.
        abort(400, message="Can't remove the admin permission from a built-in group.")

    # dict.fromkeys dedupes while keeping the order the admin sent.
    return list(dict.fromkeys(permissions))


def blocked_permissions(user, permissions):
    """The strings in `permissions` that `user` may neither grant nor revoke."""
    return sorted(restricted_permissions(user).intersection(permissions or []))


def require_grantable_groups(org, user, group_ids):
    """Refuse a membership change over a group carrying a restricted permission.

    Restricting the permission LIST is only half of the grant. Membership is
    the other half: the builtin admin group carries "super_admin"
    (Group.ADMIN_PERMISSIONS), so an org admin able to put anybody into it
    hands out super_admin without ever writing the string. Removal is refused
    for the same mirror-image reason validated_permissions refuses it, because
    emptying the super admin groups locks the super admins out.

    Pass only the ids a request would add or remove. The ids it leaves alone
    are not a change, and refusing those would break re-saving a user whose
    groups happen to include a restricted one.
    """
    from redash.models import Group

    group_ids = list(group_ids)
    if not group_ids or not restricted_permissions(user):
        return

    groups = Group.query.filter(Group.org_id == org.id, Group.id.in_(group_ids))
    blocked = sorted({p for group in groups for p in blocked_permissions(user, group.permissions)})

    if blocked:
        abort(403, message="Only a super admin can change who holds: {}.".format(", ".join(blocked)))


def require_grantable_group_name(group, user, name):
    """Refuse a rename of a group carrying a permission `user` may not grant.

    A group's name is not decoration, it is the identifier SAML resolves
    membership by: User.update_group_assignments looks groups up with
    Group.find_by_name, and authentication.saml_auth calls it with whatever the
    RedashGroups assertion says. Moving a group under a name an assertion
    already carries therefore adds every holder of that assertion to it, which
    is the membership grant refused above reached with neither the permission
    list nor a membership endpoint touched. Renaming away from a name is the
    matching revocation, refused for the same mirror-image reason.

    An unchanged name is not a rename. The admin client re-sends the whole
    group on every save (client/app/components/groups/GroupName.jsx), so
    treating it as one would refuse an ordinary permission edit.
    """
    if name == group.name:
        return

    blocked = blocked_permissions(user, group.permissions)
    if blocked:
        abort(403, message="Only a super admin can rename a group holding: {}.".format(", ".join(blocked)))


def can_manage_account(actor, target):
    """Whether `actor` may act on `target`'s account rather than only look at it.

    Gating the group endpoints alone does not keep super_admin out of reach of
    an org admin, because an account is reachable without its permissions ever
    being edited: an invite or password-reset link is the account, a user's own
    api_key authenticates as that user with all of their permissions
    (authentication.get_user_from_api_key), and changing somebody's email plus
    the public reset flow is the same takeover one step longer. So an admin who
    may not grant a permission may not act on an account already holding it
    either, and may not read that account's api_key. Acting on your own account
    is always allowed, since it escalates nothing.
    """
    return actor.id == target.id or not blocked_permissions(actor, target.permissions)


def require_manageable_account(actor, target):
    """Refuse an admin acting on an account that outranks them. See can_manage_account."""
    if can_manage_account(actor, target):
        return

    blocked = blocked_permissions(actor, target.permissions)
    abort(403, message="Only a super admin can manage an account holding: {}.".format(", ".join(blocked)))


def lock_org_admin_state(org):
    """Serialize this request against any other one changing who holds admin.

    enabled_admin_count() reads rows another in-flight request may be about to
    change. Without a lock two requests each dropping a different last route to
    admin both read a safe count and both commit, and the organization ends up
    with nobody able to administer it. Locking the organization row makes the
    read-then-write sequence one at a time per org, and the lock is released
    with the transaction at the end of the request.

    Everything read after this line is read fresh, which is the second half of
    what the lock is for and does not follow from the lock on its own. A
    request that waited here read rows before it waited, and SQLAlchemy hands
    back an instance already in the identity map without applying the columns
    it just fetched. So a query issued under the lock can still answer with the
    state the request queued behind.

    Which rows that reaches is narrower than it sounds, and worth stating
    exactly, because the wrong version of this reasoning justifies a line that
    does nothing. The identity map holds weak references, so an ordinary row
    loaded and dropped (the groups @require_admin walks to evaluate
    current_user.permissions, for instance) is collected and genuinely reloaded
    later. What survives is whatever something still points at, and across a
    request that is current_user and current_org: Flask-Login keeps the user on
    the request context and the org proxy keeps the organization on the app
    context, both loaded at authentication time, before this lock existed.
    current_user.group_ids is the one that bites, because the membership
    endpoints rewrite that array whole. Read from before the wait, it is
    written back with only this request's edit applied, resurrecting a group
    another request had just removed. handlers/settings.py refreshes
    current_org by hand for the same reason; this covers both.

    Nothing pending is lost. The locking query autoflushes, so anything dirtied
    earlier is written before the expire and read back by it. Every caller
    takes this lock before writing anything anyway, for the lock-ordering
    reason each of them documents, so the flush is a no-op in practice.
    """
    from redash.models import Organization, db

    db.session.query(Organization).filter(Organization.id == org.id).with_for_update().one()
    db.session.expire_all()


def enabled_admin_count(org):
    """How many enabled users still hold "admin" on this organization.

    Counting groups is not enough. A group can carry "admin" and have no
    members, which locks the organization out exactly as completely as no group
    carrying it at all.
    """
    from redash.models import Group, User

    admin_group_ids = [
        group.id for group in Group.query.filter(Group.org_id == org.id, Group.permissions.any("admin"))
    ]

    if not admin_group_ids:
        return 0

    return User.query.filter(
        User.org_id == org.id,
        User.disabled_at.is_(None),
        User.group_ids.overlap(admin_group_ids),
    ).count()


def require_remaining_admin(org, message):
    """Refuse a pending change that would leave the organization unadministered.

    Call this with the change already in the session and before the commit, so
    the count sees what the request is about to store and the whole decision
    happens inside the transaction the lock above guards. Locking every
    administrator out through a web form is not recoverable from the web: it
    takes a shell and redash.cli.groups.
    """
    from redash.models import db

    if enabled_admin_count(org) > 0:
        return

    db.session.rollback()
    abort(400, message=message)


def token_is_revoked_by_archive(obj):
    """Whether archiving `obj` has taken its own legacy api_key out of service.

    Query.api_key is a column on the row rather than an ApiKey record, so
    nothing revokes it. Query.archive leaves it alone deliberately, and
    revoke_share_tokens_when_target_is_archived deactivates the ApiKey rows that
    belong to the visualizations, not a column on the query. A write-side fix
    would have to blank the column, which is destructive and only reaches the
    archives that flush, so the token is refused at read time instead.

    Asked in two layers, because they are handed different objects and only one
    of them is the query. See has_access_to_object below and
    authentication.get_user_from_api_key.

    getattr rather than a plain attribute read: has_access_to_object also sees
    data sources and the bare group dicts require_access is sometimes called
    with, and neither has the column. is_archived is nullable, and a NULL on a
    row predating the column default is falsy, which is the answer that leaves a
    live query live.
    """
    return bool(getattr(obj, "is_archived", False))


def has_access(obj, user, need_view_only):
    if hasattr(obj, "api_key") and user.is_api_user():
        return has_access_to_object(obj, user.id, need_view_only)
    else:
        return has_access_to_groups(obj, user, need_view_only)


def secret_equal(left, right):
    """Constant-time comparison of two secrets, safe on attacker-controlled input.

    Encoded to bytes first, and that is the whole point rather than a detail.
    hmac.compare_digest raises TypeError on a str holding a non-ASCII character,
    and the right-hand side here is a query-string parameter, so comparing the
    strings directly turned `?api_key=<any non-ASCII>` into a 500 where a wrong
    ASCII key answers 404. Bytes never raise on content.

    Either side missing is False rather than an error: an object with no key and
    a caller with no key must not match each other.
    """
    if not left or not right:
        return False
    return hmac.compare_digest(str(left).encode("utf-8"), str(right).encode("utf-8"))


def has_access_to_object(obj, api_key, need_view_only):
    # Before the token comparison rather than after it, because an archived
    # object's own token is dead whichever branch below would have matched it.
    if token_is_revoked_by_archive(obj):
        return False

    if secret_equal(obj.api_key, api_key):
        return need_view_only
    elif hasattr(obj, "dashboard_api_keys"):
        # A dashboard token that reaches this query. `any` over a constant-time
        # comparison rather than `in`, which short-circuits on the first
        # differing byte the same way `==` did.
        return any(secret_equal(key, api_key) for key in obj.dashboard_api_keys) and need_view_only
    else:
        return False


def has_access_to_groups(obj, user, need_view_only):
    groups = obj.groups if hasattr(obj, "groups") else obj

    if "admin" in user.permissions:
        return True

    matching_groups = set(groups.keys()).intersection(user.group_ids)

    if not matching_groups:
        return False

    required_level = 1 if need_view_only else 2

    group_level = 1 if all(flatten([groups[group] for group in matching_groups])) else 2

    return required_level <= group_level


def require_access(obj, user, need_view_only):
    if not has_access(obj, user, need_view_only):
        abort(403)


class require_permissions:
    def __init__(self, permissions, allow_one=False):
        self.permissions = permissions
        self.allow_one = allow_one

    def __call__(self, fn):
        @functools.wraps(fn)
        def decorated(*args, **kwargs):
            if self.allow_one:
                has_permissions = any([current_user.has_permission(permission) for permission in self.permissions])
            else:
                has_permissions = current_user.has_permissions(self.permissions)

            if has_permissions:
                return fn(*args, **kwargs)
            else:
                abort(403)

        return decorated


def require_permission(permission):
    return require_permissions((permission,))


def require_any_of_permission(permissions):
    return require_permissions(permissions, True)


def require_admin(fn):
    return require_permission("admin")(fn)


def require_super_admin(fn):
    return require_permission("super_admin")(fn)


def has_permission_or_owner(permission, object_owner_id):
    return int(object_owner_id) == current_user.id or current_user.has_permission(permission)


def is_admin_or_owner(object_owner_id):
    return has_permission_or_owner("admin", object_owner_id)


def require_permission_or_owner(permission, object_owner_id):
    if not has_permission_or_owner(permission, object_owner_id):
        abort(403)


def require_admin_or_owner(object_owner_id):
    if not is_admin_or_owner(object_owner_id):
        abort(403, message="You don't have permission to edit this resource.")


def can_modify(obj, user):
    return is_admin_or_owner(obj.user_id) or user.has_access(obj, ACCESS_TYPE_MODIFY)


def require_object_modify_permission(obj, user):
    if not can_modify(obj, user):
        abort(403)
