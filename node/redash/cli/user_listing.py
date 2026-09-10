import json

from redash import models


def users_as_json(users):
    return json.dumps(
        [
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "org": {"slug": user.org.slug, "name": user.org.name},
                "active": not user.is_disabled,
            }
            for user in users
        ],
        indent=2,
    )


def user_as_text(user):
    groups = models.Group.query.filter(models.Group.id.in_(user.group_ids)).all()
    return "Id: {}\nName: {}\nEmail: {}\nOrganization: {}\nActive: {}\nGroups: {}".format(
        user.id,
        user.name,
        user.email,
        user.org.name,
        not user.is_disabled,
        ", ".join(group.name for group in groups),
    )
