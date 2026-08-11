import hashlib
import itertools
import logging
import time
from functools import reduce
from operator import or_

from flask import request_started
from flask_login import AnonymousUserMixin, UserMixin, current_user
from passlib.apps import custom_app_context as pwd_context
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy_utils import EmailType
from sqlalchemy_utils.models import generic_repr

from redash import redis_connection
from redash.utils import dt_from_timestamp, generate_token

from .base import Column, GFKBase, db, key_type, primary_key
from .mixins import BelongsToOrgMixin, TimestampMixin
from .types import MutableDict, MutableList, json_cast_property

logger = logging.getLogger(__name__)


LAST_ACTIVE_KEY = "users:last_active_at"


def sync_last_active_at():
    """
    Update User model with the active_at timestamp from Redis. We first fetch
    all the user_ids to update, and then fetch the timestamp to minimize the
    time between fetching the value and updating the DB. This is because there
    might be a more recent update we skip otherwise.
    """
    user_ids = redis_connection.hkeys(LAST_ACTIVE_KEY)
    for user_id in user_ids:
        timestamp = redis_connection.hget(LAST_ACTIVE_KEY, user_id)
        active_at = dt_from_timestamp(timestamp)
        user = User.query.filter(User.id == user_id).first()
        if user:
            user.active_at = active_at
        redis_connection.hdel(LAST_ACTIVE_KEY, user_id)
    db.session.commit()


def update_user_active_at(sender, *args, **kwargs):
    """
    Used as a Flask request_started signal callback that adds
    the current user's details to Redis
    """
    if current_user.is_authenticated and not current_user.is_api_user():
        redis_connection.hset(LAST_ACTIVE_KEY, current_user.id, int(time.time()))


def init_app(app):
    """
    A Flask extension to keep user details updates in Redis and
    sync it periodically to the database (User.details).
    """
    request_started.connect(update_user_active_at, app)


class PermissionsCheckMixin:
    def has_permission(self, permission):
        return self.has_permissions((permission,))

    def has_permissions(self, permissions):
        has_permissions = reduce(
            lambda a, b: a and b,
            [permission in self.permissions for permission in permissions],
            True,
        )

        return has_permissions


@generic_repr("id", "name", "email")
class User(TimestampMixin, db.Model, BelongsToOrgMixin, UserMixin, PermissionsCheckMixin):
    id = primary_key("User")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship("Organization", backref=db.backref("users", lazy="dynamic"))
    name = Column(db.String(320))
    email = Column(EmailType)
    password_hash = Column(db.String(128), nullable=True)
    group_ids = Column(
        "groups",
        MutableList.as_mutable(ARRAY(key_type("Group"))),
        nullable=True,
    )
    api_key = Column(db.String(40), default=lambda: generate_token(40), unique=True)

    disabled_at = Column(db.DateTime(True), default=None, nullable=True)
    details = Column(
        MutableDict.as_mutable(JSONB),
        nullable=True,
        server_default="{}",
        default={},
    )
    active_at = json_cast_property(db.DateTime(True), "details", "active_at", default=None)
    _profile_image_url = json_cast_property(db.Text(), "details", "profile_image_url", default=None)
    is_invitation_pending = json_cast_property(db.Boolean(True), "details", "is_invitation_pending", default=False)
    is_email_verified = json_cast_property(db.Boolean(True), "details", "is_email_verified", default=True)

    __tablename__ = "users"
    __table_args__ = (db.Index("users_org_id_email", "org_id", "email", unique=True),)

    def __str__(self):
        return "%s (%s)" % (self.name, self.email)

    def __init__(self, *args, **kwargs):
        if kwargs.get("email") is not None:
            kwargs["email"] = kwargs["email"].lower()
        super(User, self).__init__(*args, **kwargs)

    @property
    def is_disabled(self):
        return self.disabled_at is not None

    def disable(self):
        self.disabled_at = db.func.now()

    def enable(self):
        self.disabled_at = None

    def regenerate_api_key(self):
        self.api_key = generate_token(40)

    def to_dict(self, with_api_key=False):
        # Disabled users used to get a generic icon (images/avatar.svg)
        # swapped in for their gravatar/custom photo, served as a static
        # asset by the fork's own React client. That client is gone, so the
        # path this used to build 404s against the product UI's origin.
        # Omitting the URL gets the same effect without depending on an
        # asset this app no longer serves: the product's UserAvatar already
        # renders initials on a plain background whenever profile_image_url
        # is absent, which is the same "generic, non-personal" look.
        profile_image_url = None if self.is_disabled else self.profile_image_url

        d = {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "profile_image_url": profile_image_url,
            "groups": self.group_ids,
            "updated_at": self.updated_at,
            "created_at": self.created_at,
            "disabled_at": self.disabled_at,
            "is_disabled": self.is_disabled,
            "active_at": self.active_at,
            "is_invitation_pending": self.is_invitation_pending,
            "is_email_verified": self.is_email_verified,
        }

        if self.password_hash is None:
            d["auth_type"] = "external"
        else:
            d["auth_type"] = "password"

        if with_api_key:
            d["api_key"] = self.api_key

        return d

    @staticmethod
    def is_api_user():
        return False

    @property
    def profile_image_url(self):
        if self._profile_image_url:
            return self._profile_image_url

        email_md5 = hashlib.md5(self.email.lower().encode(), usedforsecurity=False).hexdigest()
        return "https://www.gravatar.com/avatar/{}?s=40&d=identicon".format(email_md5)

    @property
    def permissions(self):
        """Every permission string this user's groups carry, within their own org.

        The org condition is not redundant with the callers. Every current web
        path that writes group_ids validates the ids through get_by_id_and_org
        first, so nothing reaches here with a foreign id today, but this is the
        function that decides what a user may do: under MULTI_ORG a future path
        that forgot that validation would hand out another tenant's permissions
        here, silently. Filtering on org makes the property safe by
        construction rather than by the discipline of everything upstream.

        Nothing legitimate is dropped. Both users.org_id and groups.org_id are
        NOT NULL in the schema (models.base.Column defaults nullable=False, and
        the columns have carried the constraint since the initial schema), so
        there is no legacy row whose NULL org would fail the comparison, and a
        group in another org was never a grant worth keeping.
        """
        # TODO: this should be cached.
        groups = Group.query.filter(Group.id.in_(self.group_ids), Group.org_id == self.org_id)
        return list(itertools.chain(*[g.permissions for g in groups]))

    @classmethod
    def get_by_org(cls, org):
        return cls.query.filter(cls.org == org)

    @classmethod
    def get_by_id(cls, _id):
        return cls.query.filter(cls.id == _id).one()

    @classmethod
    def get_by_email_and_org(cls, email, org):
        return cls.get_by_org(org).filter(cls.email == email).one()

    @classmethod
    def get_by_api_key_and_org(cls, api_key, org):
        return cls.get_by_org(org).filter(cls.api_key == api_key).one()

    @classmethod
    def all(cls, org):
        return cls.get_by_org(org).filter(cls.disabled_at.is_(None))

    @classmethod
    def all_disabled(cls, org):
        return cls.get_by_org(org).filter(cls.disabled_at.isnot(None))

    @classmethod
    def search(cls, base_query, term):
        term = "%{}%".format(term)
        search_filter = or_(cls.name.ilike(term), cls.email.like(term))

        return base_query.filter(search_filter)

    @classmethod
    def pending(cls, base_query, pending):
        if pending:
            return base_query.filter(cls.is_invitation_pending.is_(True))
        else:
            return base_query.filter(cls.is_invitation_pending.isnot(True))  # check for both `false`/`null`

    @classmethod
    def find_by_email(cls, email):
        return cls.query.filter(cls.email == email)

    def hash_password(self, password):
        self.password_hash = pwd_context.hash(password)

    def verify_password(self, password):
        return self.password_hash and pwd_context.verify(password, self.password_hash)

    def update_group_assignments(self, group_names):
        """Replace this user's groups with the ones an assertion names.

        Its only caller is authentication.saml_auth.idp_initiated, which hands
        over whatever the RedashGroups attribute says. Group.find_by_name will
        not resolve a builtin group by name, so an assertion cannot put anyone
        in the admin group by calling itself "admin".

        The builtin groups the user is ALREADY in are carried across the
        rewrite rather than replaced away. Without that, the refusal in
        find_by_name turns every SAML login into a demotion for the deployments
        that legitimately map an identity provider group onto Redash's own
        admin group: the assertion can no longer name it, this method rewrites
        the whole list on every callback, and the organization loses an
        administrator per login until it has none and nobody is left who can
        hand the permission back.

        The cost is real and deliberate: an assertion can no longer REVOKE a
        builtin membership either. Dropping "admin" from someone's identity
        provider groups leaves them an administrator in Redash until an
        administrator removes them through the members endpoint. A stale admin
        is recoverable by any of the others; an organization with no admin at
        all is not, so the weaker property is the one worth keeping.

        Only builtin groups are carried over. A regular group the assertion
        stops naming is still removed, which is what the attribute is for.

        That carve-out is about the builtin admin group and reaches no further.
        Most deployments never map an identity provider group onto it: they make
        a REGULAR group, put "admin" on it, and map onto that. For them the
        rewrite above is still a demotion, and when its holder was the last
        enabled administrator it is the whole organization losing the ability to
        administer itself. So the same invariant the group and user endpoints
        answer to is enforced here, under the same organization lock, which also
        serializes a login against the requests that can take admin away
        concurrently.

        A login is not a form submission, so the refusal is shaped differently.
        Failing the login closed would leave that sole administrator unable to
        reach the product at all, which is the lockout stated the other way
        round and is exactly the outcome not worth risking. The login therefore
        COMPLETES, and what gives way is the assertion's demotion: the groups
        carrying "admin" come back and everything else the assertion says still
        happens. The property traded away is that an identity provider can no
        longer demote the LAST administrator on its own. Somebody has to do it
        through the members endpoint, which is a live administrator's job and
        therefore always possible; the reverse is not.
        """
        # Imported here because redash.permissions imports redash.models
        # transitively. Resolving through the module rather than binding the
        # names at import time is also what lets the concurrency tests slow the
        # count down where the race actually is.
        from redash import permissions

        # The organization row first, before a single attribute of this user is
        # written. The lock query autoflushes, so a dirtied User would be
        # flushed by it and this transaction would hold the user row and then
        # ask for the organization row. UserDisableResource.post and
        # UserResource.post take the same two in the order below, and a login
        # meeting one of them under the opposite order would deadlock.
        permissions.lock_org_admin_state(self.org)

        held_restricted_before = permissions.restricted_holders([self])

        groups = Group.find_by_name(self.org, group_names)
        groups.append(self.org.default_group)
        group_ids = [g.id for g in groups]

        # Scoped to the user's own org, so a foreign id already sitting in
        # group_ids is dropped rather than resurrected.
        kept = Group.query.filter(
            Group.id.in_(self.group_ids or []),
            Group.org_id == self.org_id,
            Group.type == Group.BUILTIN_GROUP,
        )
        group_ids.extend(g.id for g in kept if g.id not in group_ids)

        previous_group_ids = list(self.group_ids or [])
        self.group_ids = list(group_ids)
        db.session.flush()

        # Counted with the proposed assignment already in the session, so the
        # answer is about the state this login is about to store rather than
        # the one it started from.
        if permissions.enabled_admin_count(self.org) == 0:
            # The narrowest rescue that works. Only groups the user already had
            # come back, and only the ones carrying "admin", so a login can
            # never be turned into a promotion by this branch.
            rescued = Group.query.filter(
                Group.id.in_(previous_group_ids),
                Group.org_id == self.org_id,
                Group.permissions.any("admin"),
            )
            group_ids.extend(g.id for g in rescued if g.id not in group_ids)
            self.group_ids = list(group_ids)
            db.session.flush()

        # A regular group can carry "super_admin" once a super admin puts it
        # there, and this method joins users to regular groups by name, so a
        # login is a third door into the promotion that kills a captured key.
        # See redash.permissions.rotate_promoted_api_keys.
        permissions.rotate_promoted_api_keys([self], held_restricted_before)

        db.session.add(self)
        db.session.commit()

    def has_access(self, obj, access_type):
        return AccessPermission.exists(obj, access_type, grantee=self)

    def get_id(self):
        identity = hashlib.md5(
            "{},{}".format(self.email, self.password_hash).encode(), usedforsecurity=False
        ).hexdigest()
        return "{0}-{1}".format(self.id, identity)

    def get_actual_user(self):
        return repr(self) if self.is_api_user() else self.email


@generic_repr("id", "name", "type", "org_id")
class Group(db.Model, BelongsToOrgMixin):
    DEFAULT_PERMISSIONS = [
        "create_dashboard",
        "create_query",
        "edit_dashboard",
        "edit_query",
        "view_query",
        "view_source",
        "execute_query",
        "list_users",
        "schedule_query",
        "list_dashboards",
        "list_alerts",
        "list_data_sources",
    ]
    ADMIN_PERMISSIONS = ["admin", "super_admin"]

    BUILTIN_GROUP = "builtin"
    REGULAR_GROUP = "regular"

    id = primary_key("Group")
    data_sources = db.relationship("DataSourceGroup", back_populates="group", cascade="all")
    org_id = Column(key_type("Organization"), db.ForeignKey("organizations.id"))
    org = db.relationship("Organization", back_populates="groups")
    type = Column(db.String(255), default=REGULAR_GROUP)
    name = Column(db.String(100))
    permissions = Column(ARRAY(db.String(255)), default=DEFAULT_PERMISSIONS)
    created_at = Column(db.DateTime(True), default=db.func.now())

    __tablename__ = "groups"

    def __str__(self):
        return str(self.id)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "permissions": self.permissions,
            "type": self.type,
            "created_at": self.created_at,
        }

    @classmethod
    def all(cls, org):
        return cls.query.filter(cls.org == org)

    @classmethod
    def members(cls, group_id):
        return User.query.filter(User.group_ids.any(group_id))

    @classmethod
    def find_by_name(cls, org, group_names):
        """Groups in `org` named by `group_names`, never a builtin one.

        Its only caller is update_group_assignments above, which
        authentication.saml_auth.idp_initiated hands whatever the RedashGroups
        assertion says. Names in an assertion come from the identity provider, so
        matching on the name alone let the literal string "admin" resolve to the
        BUILTIN admin group, which carries "super_admin" in every organization
        init_db creates.

        Nothing legitimate is lost: update_group_assignments appends
        org.default_group itself, so the other builtin was never reached by name
        either, and a regular group of the organization's own keeps resolving
        even when it shares a builtin's name. is_distinct_from rather than
        == REGULAR_GROUP keeps a group whose type is NULL assignable.
        """
        result = cls.query.filter(
            cls.org == org,
            cls.name.in_(group_names),
            cls.type.is_distinct_from(cls.BUILTIN_GROUP),
        )
        return list(result)


@generic_repr("id", "object_type", "object_id", "access_type", "grantor_id", "grantee_id")
class AccessPermission(GFKBase, db.Model):
    id = primary_key("AccessPermission")
    # 'object' defined in GFKBase
    access_type = Column(db.String(255))
    grantor_id = Column(key_type("User"), db.ForeignKey("users.id"))
    grantor = db.relationship(User, backref="grantor", foreign_keys=[grantor_id])
    grantee_id = Column(key_type("User"), db.ForeignKey("users.id"))
    grantee = db.relationship(User, backref="grantee", foreign_keys=[grantee_id])

    __tablename__ = "access_permissions"

    @classmethod
    def grant(cls, obj, access_type, grantee, grantor):
        grant = cls.query.filter(
            cls.object_type == obj.__tablename__,
            cls.object_id == obj.id,
            cls.access_type == access_type,
            cls.grantee == grantee,
            cls.grantor == grantor,
        ).one_or_none()

        if not grant:
            grant = cls(
                object_type=obj.__tablename__,
                object_id=obj.id,
                access_type=access_type,
                grantee=grantee,
                grantor=grantor,
            )
            db.session.add(grant)

        return grant

    @classmethod
    def revoke(cls, obj, grantee, access_type=None):
        permissions = cls._query(obj, access_type, grantee)
        return permissions.delete()

    @classmethod
    def find(cls, obj, access_type=None, grantee=None, grantor=None):
        return cls._query(obj, access_type, grantee, grantor)

    @classmethod
    def exists(cls, obj, access_type, grantee):
        return cls.find(obj, access_type, grantee).count() > 0

    @classmethod
    def _query(cls, obj, access_type=None, grantee=None, grantor=None):
        q = cls.query.filter(cls.object_id == obj.id, cls.object_type == obj.__tablename__)

        if access_type:
            q = q.filter(AccessPermission.access_type == access_type)

        if grantee:
            q = q.filter(AccessPermission.grantee == grantee)

        if grantor:
            q = q.filter(AccessPermission.grantor == grantor)

        return q

    def to_dict(self):
        d = {
            "id": self.id,
            "object_id": self.object_id,
            "object_type": self.object_type,
            "access_type": self.access_type,
            "grantor": self.grantor_id,
            "grantee": self.grantee_id,
        }
        return d


class AnonymousUser(AnonymousUserMixin, PermissionsCheckMixin):
    # record_event() reads id and name off every user it records. A refused
    # public read is anonymous by definition and still has to be recorded.
    id = None
    name = "Anonymous"

    @property
    def permissions(self):
        return []

    @staticmethod
    def is_api_user():
        return False


class ApiUser(UserMixin, PermissionsCheckMixin):
    def __init__(self, api_key, org, groups, name=None):
        self.object = None
        if isinstance(api_key, str):
            self.id = api_key
            self.name = name
        else:
            self.id = api_key.api_key
            self.name = "ApiKey: {}".format(api_key.id)
            self.object = api_key.object
        self.group_ids = groups
        self.org = org

    def __repr__(self):
        return "<{}>".format(self.name)

    @staticmethod
    def is_api_user():
        return True

    @property
    def org_id(self):
        if not self.org:
            return None
        return self.org.id

    @property
    def permissions(self):
        return ["view_query"]

    @staticmethod
    def has_access(obj, access_type):
        return False

    def get_actual_user(self):
        return repr(self)
