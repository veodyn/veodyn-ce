from flask import request
from flask_restful import abort

from redash import models
from redash.handlers.base import BaseResource, get_object_or_404
from redash.permissions import (
    lock_org_admin_state,
    require_admin,
    require_grantable_group_name,
    require_grantable_groups,
    require_permission,
    require_remaining_admin,
    restricted_holders,
    rotate_promoted_api_keys,
    validated_permissions,
)

# Every write below that can take admin away from somebody follows the same
# order: lock the org, apply the change to the session, hold it to the
# "somebody can still administer this org" invariant, enqueue the audit event,
# then commit. Checking after the change rather than before it means the count
# is of the state about to be stored, and doing it under the lock means two
# requests cannot each read a safe state and both proceed.
ADMIN_LOCKOUT_MESSAGE = "Can't leave this organization with no enabled user holding admin."


class GroupListResource(BaseResource):
    @require_admin
    def post(self):
        name = request.json["name"]
        group = models.Group(name=name, org=self.current_org)
        models.db.session.add(group)
        models.db.session.commit()

        self.record_event({"action": "create", "object_id": group.id, "object_type": "group"})

        return group.to_dict()

    def get(self):
        if self.current_user.has_permission("admin"):
            groups = models.Group.all(self.current_org)
        else:
            groups = models.Group.query.filter(models.Group.id.in_(self.current_user.group_ids))

        self.record_event({"action": "list", "object_id": "groups", "object_type": "group"})

        return [g.to_dict() for g in groups]


class GroupResource(BaseResource):
    @require_admin
    def post(self, group_id):
        group = models.Group.get_by_id_and_org(group_id, self.current_org)
        lock_org_admin_state(self.current_org)

        name = request.json.get("name", group.name)

        # Upstream refuses every edit to a builtin group. Permissions are the
        # exception this fork carves out: granting a product permission to
        # everyone means granting it on the builtin default group, and that is
        # the whole point of having a write path outside the CLI. Renaming a
        # builtin group stays refused, and reject_last_admin_removal() keeps the
        # builtin admin group's "admin" in place.
        if group.type == models.Group.BUILTIN_GROUP and name != group.name:
            abort(400, message="Can't modify built-in groups.")

        # The name is a privilege too, because SAML resolves group membership by
        # it. Renaming a group that carries a restricted permission is refused
        # for whoever cannot grant that permission outright.
        require_grantable_group_name(group, self.current_user, name)

        previous_permissions = list(group.permissions or [])
        permissions = validated_permissions(group, request.json.get("permissions"), self.current_user)

        # Read before the group changes, because this is one of the two ways a
        # user crosses into a permission an api_key somebody already captured
        # was not worth. The members do not move here; the permission arrives
        # underneath them. See redash.permissions.rotate_promoted_api_keys.
        members = list(models.Group.members(group.id))
        held_restricted_before = restricted_holders(members)

        group.name = name
        if permissions is not None:
            group.permissions = permissions

        require_remaining_admin(self.current_org, ADMIN_LOCKOUT_MESSAGE)

        # Every member at once, not just whoever was looked at: the grant
        # promotes the whole membership, so rotating one key would leave the
        # rest of them captured.
        rotate_promoted_api_keys(members, held_restricted_before)

        # Events are enqueued before the commit, not after it. record_event
        # hands the event to Redis synchronously and that call can fail; with
        # the commit first, a privilege change could persist while its event
        # never existed, and the retry would compare against the already
        # changed list and record nothing either. Enqueuing first fails the
        # change instead of losing the record of it, which is the direction to
        # fail in. A commit that then fails leaves an event for a change that
        # did not happen, which an auditor can see and question; the reverse is
        # invisible.
        self.record_event({"action": "edit", "object_id": group.id, "object_type": "group"})

        if permissions is not None and permissions != previous_permissions:
            # A privilege change gets its own action so an auditor can filter for
            # it, carrying both lists because "what did they have before" is the
            # question asked afterwards.
            self.record_event(
                {
                    "action": "change_permissions",
                    "object_id": group.id,
                    "object_type": "group",
                    "previous_permissions": previous_permissions,
                    "permissions": permissions,
                }
            )

        models.db.session.commit()

        return group.to_dict()

    def get(self, group_id):
        if not (self.current_user.has_permission("admin") or int(group_id) in self.current_user.group_ids):
            abort(403)

        group = models.Group.get_by_id_and_org(group_id, self.current_org)

        self.record_event({"action": "view", "object_id": group_id, "object_type": "group"})

        return group.to_dict()

    @require_admin
    def delete(self, group_id):
        group = models.Group.get_by_id_and_org(group_id, self.current_org)
        lock_org_admin_state(self.current_org)
        if group.type == models.Group.BUILTIN_GROUP:
            abort(400, message="Can't delete built-in groups.")

        # Deletion is the third way to revoke, after editing the permission list
        # and removing members, so the restricted strings are refused here too.
        require_grantable_groups(self.current_org, self.current_user, [group.id])

        members = models.Group.members(group_id)
        for member in members:
            member.group_ids.remove(int(group_id))
            models.db.session.add(member)

        models.db.session.delete(group)
        # Deleting a group takes its permissions away from every member at once,
        # so this route out of admin is guarded like the permission list itself.
        require_remaining_admin(self.current_org, ADMIN_LOCKOUT_MESSAGE)
        models.db.session.commit()


class GroupMemberListResource(BaseResource):
    @require_admin
    def post(self, group_id):
        user_id = request.json["user_id"]
        # Joining a group cannot remove an administrator, so this endpoint was
        # left out of the lock while the lock only answered the lockout
        # question. It answers the rotation question too, and there this
        # endpoint is one of the two sides. A member add and a permission grant
        # on the same group, running at once, each read a state in which nobody
        # crossed the line: the add cannot see a permission that has not
        # committed, and the grant's Group.members() cannot see a membership
        # that has not committed. Both rotate nothing, both commit, and a key
        # captured while the account was ordinary is now a super admin's.
        #
        # Taken before the group and the user are loaded and before the "did
        # they already hold it" reading below, because those three are exactly
        # what the concurrent grant invalidates.
        lock_org_admin_state(self.current_org)
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        group = models.Group.get_by_id_and_org(group_id, self.current_org)
        # Joining a group is a grant of everything that group carries, so the
        # restricted strings are refused here exactly as in the permission list.
        require_grantable_groups(self.current_org, self.current_user, [group.id])
        held_restricted_before = restricted_holders([user])
        user.group_ids.append(group.id)
        # The other way across the line: the permission does not move, the user
        # moves onto it. Same revocation for the same reason.
        rotate_promoted_api_keys([user], held_restricted_before)
        models.db.session.commit()

        self.record_event(
            {
                "action": "add_member",
                "object_id": group.id,
                "object_type": "group",
                "member_id": user.id,
            }
        )
        return user.to_dict()

    @require_permission("list_users")
    def get(self, group_id):
        if not (self.current_user.has_permission("admin") or int(group_id) in self.current_user.group_ids):
            abort(403)

        members = models.Group.members(group_id)
        return [m.to_dict() for m in members]


class GroupMemberResource(BaseResource):
    @require_admin
    def delete(self, group_id, user_id):
        # Before the user is loaded, for the same reason the member add takes it
        # before loading anything. A user row read on the way in and then held
        # across the wait carries a group_ids array from before whatever this
        # request queued behind, and group_ids is rewritten whole here: the
        # stale array would be written back with only this group taken out of
        # it, resurrecting a membership another request had just removed.
        lock_org_admin_state(self.current_org)
        user = models.User.get_by_id_and_org(user_id, self.current_org)
        require_grantable_groups(self.current_org, self.current_user, [int(group_id)])
        user.group_ids.remove(int(group_id))
        # Emptying the admin group leaves the org unadministered just as surely
        # as taking "admin" off it, and a group carrying a permission nobody
        # holds is the case counting groups alone cannot see.
        require_remaining_admin(self.current_org, ADMIN_LOCKOUT_MESSAGE)

        self.record_event(
            {
                "action": "remove_member",
                "object_id": group_id,
                "object_type": "group",
                "member_id": user.id,
            }
        )

        models.db.session.commit()


def serialize_data_source_with_group(data_source, data_source_group):
    d = data_source.to_dict()
    d["view_only"] = data_source_group.view_only
    return d


class GroupDataSourceListResource(BaseResource):
    @require_admin
    def post(self, group_id):
        data_source_id = request.json["data_source_id"]
        data_source = models.DataSource.get_by_id_and_org(data_source_id, self.current_org)
        group = models.Group.get_by_id_and_org(group_id, self.current_org)

        data_source_group = data_source.add_group(group)
        models.db.session.commit()

        self.record_event(
            {
                "action": "add_data_source",
                "object_id": group_id,
                "object_type": "group",
                "member_id": data_source.id,
            }
        )

        return serialize_data_source_with_group(data_source, data_source_group)

    @require_admin
    def get(self, group_id):
        group = get_object_or_404(models.Group.get_by_id_and_org, group_id, self.current_org)

        # TOOD: move to models
        data_sources = models.DataSource.query.join(models.DataSourceGroup).filter(
            models.DataSourceGroup.group == group
        )

        self.record_event({"action": "list", "object_id": group_id, "object_type": "group"})

        return [ds.to_dict(with_permissions_for=group) for ds in data_sources]


class GroupDataSourceResource(BaseResource):
    @require_admin
    def post(self, group_id, data_source_id):
        data_source = models.DataSource.get_by_id_and_org(data_source_id, self.current_org)
        group = models.Group.get_by_id_and_org(group_id, self.current_org)
        view_only = request.json["view_only"]

        data_source_group = data_source.update_group_permission(group, view_only)
        models.db.session.commit()

        self.record_event(
            {
                "action": "change_data_source_permission",
                "object_id": group_id,
                "object_type": "group",
                "member_id": data_source.id,
                "view_only": view_only,
            }
        )

        return serialize_data_source_with_group(data_source, data_source_group)

    @require_admin
    def delete(self, group_id, data_source_id):
        data_source = models.DataSource.get_by_id_and_org(data_source_id, self.current_org)
        group = models.Group.get_by_id_and_org(group_id, self.current_org)

        data_source.remove_group(group)
        models.db.session.commit()

        self.record_event(
            {
                "action": "remove_data_source",
                "object_id": group_id,
                "object_type": "group",
                "member_id": data_source.id,
            }
        )
