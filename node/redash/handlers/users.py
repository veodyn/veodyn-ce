from disposable_email_domains import blacklist
from flask import request
from flask_login import current_user, login_user
from flask_restful import abort
from funcy import partial, project
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import NoResultFound

from redash import limiter, models, settings
from redash.authentication.account import (
    invite_link_for_user,
    reset_link_for_user,
    send_invite_email,
    send_password_reset_email,
    send_verify_email,
)
from redash.handlers.base import (
    BaseResource,
    get_object_or_404,
    paginate,
    require_fields,
)
from redash.handlers.base import order_results as _order_results
from redash.permissions import (
    can_manage_account,
    is_admin_or_owner,
    lock_org_admin_state,
    require_admin,
    require_admin_or_owner,
    require_grantable_groups,
    require_manageable_account,
    require_permission,
    require_permission_or_owner,
    require_remaining_admin,
    restricted_holders,
    rotate_promoted_api_keys,
)
from redash.settings import parse_boolean

ADMIN_LOCKOUT_MESSAGE = "Can't leave this organization with no enabled user holding admin."

# Ordering map for relationships
order_map = {
    "name": "name",
    "-name": "-name",
    "active_at": "active_at",
    "-active_at": "-active_at",
    "created_at": "created_at",
    "-created_at": "-created_at",
    "groups": "group_ids",
    "-groups": "-group_ids",
}

order_results = partial(_order_results, default_order="-created_at", allowed_orders=order_map)


def invite_user(org, inviter, user, send_email=True):
    d = user.to_dict()

    invite_url = invite_link_for_user(user)
    if settings.email_server_is_configured() and send_email:
        send_invite_email(inviter, user, invite_url, org)
        d["email_sent"] = True
    else:
        # Only when nobody was mailed. The client keys off the field's presence:
        # UsersList raises an "Email not sent!" modal whenever it comes back, and
        # resendInvitation only reads it under mailSettingsMissing. Returning it
        # unconditionally warned the admin the invite had failed on every send.
        d["invite_link"] = invite_url

    return d


def require_allowed_email(email):
    # `example.com` and `example.com.` are equal - last dot stands for DNS root but usually is omitted
    _, domain = email.lower().rstrip(".").split("@", 1)

    if domain in blacklist or domain in settings.BLOCKED_DOMAINS:
        abort(400, message="Bad email address.")


class UserListResource(BaseResource):
    decorators = BaseResource.decorators + [limiter.limit("200/day;50/hour", methods=["POST"])]

    def get_users(self, disabled, pending, search_term):
        if disabled:
            users = models.User.all_disabled(self.current_org)
        else:
            users = models.User.all(self.current_org)

        if pending is not None:
            users = models.User.pending(users, pending)

        if search_term:
            users = models.User.search(users, search_term)
            self.record_event(
                {
                    "action": "search",
                    "object_type": "user",
                    "term": search_term,
                    "pending": pending,
                }
            )
        else:
            self.record_event({"action": "list", "object_type": "user", "pending": pending})

        # order results according to passed order parameter,
        # special-casing search queries where the database
        # provides an order by search rank
        return order_results(users, fallback=not bool(search_term))

    @require_permission("list_users")
    def get(self):
        page = request.args.get("page", 1, type=int)
        page_size = request.args.get("page_size", 25, type=int)

        groups = {group.id: group for group in models.Group.all(self.current_org)}

        def serialize_user(user):
            d = user.to_dict()
            user_groups = []
            for group_id in set(d["groups"]):
                group = groups.get(group_id)

                if group:
                    user_groups.append({"id": group.id, "name": group.name})

            d["groups"] = user_groups

            return d

        search_term = request.args.get("q", "")

        disabled = request.args.get("disabled", "false")  # get enabled users by default
        disabled = parse_boolean(disabled)

        pending = request.args.get("pending", None)  # get both active and pending by default
        if pending is not None:
            pending = parse_boolean(pending)

        users = self.get_users(disabled, pending, search_term)

        return paginate(users, page, page_size, serialize_user)

    @require_admin
    def post(self):
        req = request.get_json(force=True)
        require_fields(req, ("name", "email"))

        if "@" not in req["email"]:
            abort(400, message="Bad email address.")
        require_allowed_email(req["email"])

        user = models.User(
            org=self.current_org,
            name=req["name"],
            email=req["email"],
            is_invitation_pending=True,
            group_ids=[self.current_org.default_group.id],
        )

        try:
            models.db.session.add(user)
            models.db.session.commit()
        except IntegrityError as e:
            if "email" in str(e):
                abort(400, message="Email already taken.")
            abort(500)

        self.record_event({"action": "create", "object_id": user.id, "object_type": "user"})

        should_send_invitation = "no_invite" not in request.args
        return invite_user(self.current_org, self.current_user, user, send_email=should_send_invitation)


class UserInviteResource(BaseResource):
    @require_admin
    def get(self, user_id):
        """Return the invite link without sending an email."""
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        # An invite link is the account. Handing one for a super admin to an
        # org admin is the same escalation as granting the permission.
        require_manageable_account(self.current_user, user)
        return {"invite_link": invite_link_for_user(user)}

    @require_admin
    def post(self, user_id):
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        require_manageable_account(self.current_user, user)
        return invite_user(self.current_org, self.current_user, user)


class UserResetPasswordResource(BaseResource):
    @require_admin
    def get(self, user_id):
        """Return the password reset link without sending an email."""
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        if user.is_disabled:
            abort(404, message="Not found")
        # Same reason as the invite link above: this response is a credential
        # for somebody else's account, not a report about it.
        require_manageable_account(self.current_user, user)
        return {"reset_link": reset_link_for_user(user)}

    @require_admin
    def post(self, user_id):
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        if user.is_disabled:
            abort(404, message="Not found")
        require_manageable_account(self.current_user, user)
        reset_link = send_password_reset_email(user)

        return {"reset_link": reset_link}


class UserRegenerateApiKeyResource(BaseResource):
    def post(self, user_id):
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        if user.is_disabled:
            abort(404, message="Not found")
        if not is_admin_or_owner(user_id):
            abort(403)
        require_manageable_account(self.current_user, user)

        user.regenerate_api_key()
        models.db.session.commit()

        self.record_event({"action": "regnerate_api_key", "object_id": user.id, "object_type": "user"})

        return user.to_dict(with_api_key=True)


class UserResource(BaseResource):
    decorators = BaseResource.decorators + [limiter.limit("50/hour", methods=["POST"])]

    def get(self, user_id):
        require_permission_or_owner("list_users", user_id)
        user = get_object_or_404(models.User.get_by_id_and_org, user_id, self.current_org)

        self.record_event({"action": "view", "object_id": user_id, "object_type": "user"})

        # An admin who may not manage this account may not read its api_key
        # either. That key authenticates as its owner carrying every one of
        # their permissions (authentication.get_user_from_api_key), so putting
        # it in a response body hands over the account itself.
        return user.to_dict(with_api_key=is_admin_or_owner(user_id) and can_manage_account(self.current_user, user))

    def post(self, user_id):  # noqa: C901
        require_admin_or_owner(user_id)
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        # Editing somebody else's email is the takeover the public password
        # reset flow finishes, so an account holding a permission this admin
        # cannot grant is not theirs to edit at all.
        require_manageable_account(self.current_user, user)

        req = request.get_json(True)

        params = project(req, ("email", "name", "password", "old_password", "group_ids"))

        if "group_ids" in params:
            if not self.current_user.has_permission("admin"):
                abort(403, message="Must be admin to change groups membership.")

            # Rewriting a user's groups is member removal by another name, so it
            # answers to the same "somebody can still administer this org"
            # invariant as DELETE /api/groups/<id>/members/<id>, under the same
            # org lock. See redash.permissions.require_remaining_admin.
            #
            # The lock is taken here, before any User field is written, and that
            # ordering is the point rather than an accident of layout. The lock
            # query autoflushes, so a password hashed first would be flushed by
            # it and this request would hold the user row and then ask for the
            # organization row. UserDisableResource.post takes the same two in
            # the opposite order, so a password-plus-membership update meeting a
            # disable of the same account would deadlock and the database would
            # abort one administrative request at random.
            lock_org_admin_state(self.current_org)

            # A read, so it does not disturb the ordering above, and it has to
            # happen before the membership is rewritten: only the crossing from
            # not holding a restricted permission to holding one is worth
            # revoking a credential over.
            held_restricted_before = restricted_holders([user])

        if "password" in params and "old_password" not in params:
            abort(403, message="Must provide current password to update password.")

        if "old_password" in params and not user.verify_password(params["old_password"]):
            abort(403, message="Incorrect current password.")

        if "password" in params:
            user.hash_password(params.pop("password"))
            params.pop("old_password")

        if "group_ids" in params:
            requested_group_ids = set()
            for group_id in params["group_ids"]:
                try:
                    models.Group.get_by_id_and_org(group_id, self.current_org)
                except NoResultFound:
                    abort(400, message="Group id {} is invalid.".format(group_id))
                # int() only after the lookup proved the id real, and it matters
                # because the stored ids are ints: comparing them against the
                # strings a client may send would read every group as changed.
                requested_group_ids.add(int(group_id))

            if len(params["group_ids"]) == 0:
                params.pop("group_ids")
            else:
                # Rewriting the list adds and removes groups at once, and both
                # directions are a change of who holds what those groups carry.
                # Only the ids that actually move are checked, so re-sending a
                # membership unchanged is not treated as a grant.
                require_grantable_groups(
                    self.current_org,
                    self.current_user,
                    requested_group_ids ^ set(user.group_ids or []),
                )

        if "email" in params:
            require_allowed_email(params["email"])

        email_address_changed = "email" in params and params["email"] != user.email
        needs_to_verify_email = email_address_changed and settings.email_server_is_configured()
        if needs_to_verify_email:
            user.is_email_verified = False

        try:
            self.update_model(user, params)

            if "group_ids" in params:
                require_remaining_admin(self.current_org, ADMIN_LOCKOUT_MESSAGE)
                # This endpoint rewrites memberships, so it is the same
                # promotion the members endpoint performs reached through a
                # different door, and a key captured before it dies here too.
                # See redash.permissions.rotate_promoted_api_keys.
                rotate_promoted_api_keys([user], held_restricted_before)

            models.db.session.commit()

            if needs_to_verify_email:
                send_verify_email(user, self.current_org)

            # The user has updated their email or password. This should invalidate all _other_ sessions,
            # forcing them to log in again. Since we don't want to force _this_ session to have to go
            # through login again, we call `login_user` in order to update the session with the new identity details.
            if current_user.id == user.id:
                login_user(user, remember=True)
        except IntegrityError as e:
            if "email" in str(e):
                message = "Email already taken."
            else:
                message = "Error updating record"

            abort(400, message=message)

        self.record_event(
            {
                "action": "edit",
                "object_id": user.id,
                "object_type": "user",
                "updated_fields": list(params.keys()),
            }
        )

        return user.to_dict(with_api_key=is_admin_or_owner(user_id))

    @require_admin
    def delete(self, user_id):
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        require_manageable_account(self.current_user, user)
        # admin cannot delete self; current user is an admin (`@require_admin`)
        # so just check user id
        if user.id == current_user.id:
            abort(
                403,
                message="You cannot delete your own account. "
                "Please ask another admin to do this for you.",  # fmt: skip
            )
        elif not user.is_invitation_pending:
            abort(
                403,
                message="You cannot delete activated users. "
                "Please disable the user instead.",  # fmt: skip
            )
        models.db.session.delete(user)
        models.db.session.commit()

        return user.to_dict(with_api_key=is_admin_or_owner(user_id))


class UserDisableResource(BaseResource):
    @require_admin
    def post(self, user_id):
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        # Disabling is one of the ways the last route to admin disappears, so
        # it takes the org lock before reading anything it will decide on. The
        # refusal to disable yourself below is not a substitute: two enabled
        # admins disabling each other at the same moment each pass that check,
        # and without the lock both commit and nobody is left.
        lock_org_admin_state(self.current_org)
        require_manageable_account(self.current_user, user)
        # admin cannot disable self; current user is an admin (`@require_admin`)
        # so just check user id
        if user.id == current_user.id:
            abort(
                403,
                message="You cannot disable your own account. "
                "Please ask another admin to do this for you.",  # fmt: skip
            )
        user.disable()
        require_remaining_admin(self.current_org, ADMIN_LOCKOUT_MESSAGE)
        models.db.session.commit()

        return user.to_dict(with_api_key=is_admin_or_owner(user_id))

    @require_admin
    def delete(self, user_id):
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        # Enabling grants the admin nothing, but the response carries the
        # account's api_key, so it is gated with the rest of them.
        require_manageable_account(self.current_user, user)
        user.enable()
        models.db.session.commit()

        return user.to_dict(with_api_key=is_admin_or_owner(user_id))
