from sys import exit

from redash import models


def resolve_group(org, token):
    if token.isdigit():
        return int(token)
    group = models.Group.query.filter(models.Group.name == token, models.Group.org == org).first()
    if group is None:
        exit("There is no group %r in organization %r." % (token, org.slug))
    return group.id


def build_groups(org, groups, is_admin):
    if isinstance(groups, str):
        groups = [resolve_group(org, token.strip()) for token in groups.split(",") if token.strip()]

    if not groups:
        groups = [org.default_group.id]

    if is_admin:
        groups += [org.admin_group.id]

    return groups
