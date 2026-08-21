import sys
from collections import deque

from redash import models


def resolve_user(user_id, is_api_key, query_id):
    if user_id is not None:
        if is_api_key:
            api_key = user_id
            if query_id is not None:
                q = models.Query.get_by_id(query_id)
            else:
                q = models.Query.by_api_key(api_key)

            return models.ApiUser(api_key, q.org, q.groups)
        else:
            return models.User.get_by_id(user_id)
    else:
        return None


def get_size_iterative(dict_obj):
    """Iteratively finds size of objects in bytes"""
    seen = set()
    size = 0
    objects = deque([dict_obj])

    while objects:
        current = objects.popleft()
        if id(current) in seen:
            continue
        seen.add(id(current))
        size += sys.getsizeof(current)

        if isinstance(current, dict):
            objects.extend(current.keys())
            objects.extend(current.values())
        elif hasattr(current, "__dict__"):
            objects.append(current.__dict__)
        elif hasattr(current, "__iter__") and not isinstance(current, (str, bytes, bytearray)):
            objects.extend(current)

    return size
