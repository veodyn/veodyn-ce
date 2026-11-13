import math

EARTH_RADIUS_M = 6_371_000


def finite_point(record, lat_key, lng_key):
    try:
        point = float(record.get(lat_key)), float(record.get(lng_key))
    except (TypeError, ValueError):
        return None
    return point if math.isfinite(point[0]) and math.isfinite(point[1]) else None


def meters_between(lat_a, lng_a, lat_b, lng_b):
    d_lat, d_lng = math.radians(lat_b - lat_a), math.radians(lng_b - lng_a)
    haversine = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat_a)) * math.cos(math.radians(lat_b)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(haversine))
