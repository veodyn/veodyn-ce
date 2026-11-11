import math


def finite_point(record, lat_key, lng_key):
    try:
        point = float(record.get(lat_key)), float(record.get(lng_key))
    except (TypeError, ValueError):
        return None
    return point if math.isfinite(point[0]) and math.isfinite(point[1]) else None
