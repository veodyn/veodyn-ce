from unittest.mock import Mock, patch

from redash.query_runner.wzdx import WZDx

FEED_URL = "https://wzdx.example.gov/workzones.geojson"
DEVICE_URL = "https://wzdx.example.gov/devices.geojson"

FEED_INFO = {
    "update_date": "2020-06-18T15:00:00Z",
    "publisher": "TestDOT",
    "contact_name": "Frederick Francis Feedmanager",
    "contact_email": "fred.feedmanager@testdot.gov",
    "update_frequency": 60,
    "version": "4.2",
    "license": "https://creativecommons.org/publicdomain/zero/1.0/",
    "data_sources": [
        {
            "data_source_id": "1",
            "organization_name": "Test City 1",
            "update_frequency": 300,
            "update_date": "2020-06-18T14:37:31Z",
        },
        {
            "data_source_id": "2",
            "organization_name": "TestDOT",
            "contact_email": "samuel.sourcefeed@testdot.gov",
            "update_frequency": 60,
            "update_date": "2020-06-18T14:39:01Z",
            "region": "central",
        },
    ],
}

SIMPLE = {
    "id": "af2e3f51-611f-4ce0-9282-2f28ca68e62f",
    "type": "Feature",
    "properties": {
        "core_details": {
            "data_source_id": "1",
            "event_type": "work-zone",
            "road_names": ["I-80", "I-35"],
            "direction": "northbound",
            "description": "Single direction work zone without lane-level information.",
            "creation_date": "2009-12-31T18:01:01Z",
            "update_date": "2009-12-31T18:01:01Z",
        },
        "beginning_milepost": 125.2,
        "ending_milepost": 126.3,
        "is_start_position_verified": False,
        "is_end_position_verified": False,
        "start_date": "2010-01-01T01:00:00Z",
        "end_date": "2010-01-02T01:00:00Z",
        "location_method": "channel-device-method",
        "is_start_date_verified": False,
        "is_end_date_verified": False,
        "vehicle_impact": "some-lanes-closed",
        "reduced_speed_limit_kph": 88.514,
    },
    "geometry": {
        "type": "LineString",
        "coordinates": [[-93.776684, 41.617961], [-93.776682, 41.618244], [-93.776688, 41.622297]],
    },
}

LANED = {
    "id": "edf2162b-1f5d-4ddd-a731-78fb81a22e6a",
    "type": "Feature",
    "properties": {
        "core_details": {
            "data_source_id": "1",
            "event_type": "work-zone",
            "road_names": ["128th Street"],
            "direction": "northbound",
            "name": "WDM-58493-NB",
            "description": "Single direction work zone with detailed lane-level information.",
            "creation_date": "2009-12-13T13:35:26Z",
            "update_date": "2009-12-31T15:11:16Z",
        },
        "beginning_cross_street": "US 6, Hickman Road",
        "ending_cross_street": "Douglas Ave",
        "start_date": "2010-01-01T06:00:00Z",
        "end_date": "2010-05-01T05:00:00Z",
        "work_zone_type": "static",
        "location_method": "channel-device-method",
        "is_start_date_verified": False,
        "is_end_date_verified": False,
        "vehicle_impact": "some-lanes-closed-merge-left",
        "lanes": [
            {
                "order": 1,
                "status": "open",
                "type": "general",
                "restrictions": [{"type": "reduced-width", "value": 10, "unit": "feet"}],
            },
            {"order": 2, "status": "closed", "type": "general"},
        ],
    },
    "geometry": {"type": "LineString", "coordinates": [[-93.791522, 41.614948], [-93.793479, 41.628577]]},
}

SEQUENCED = {
    "id": "8bfb0ce0-98cd-4e92-924d-f0a9d3a4ba8f",
    "type": "Feature",
    "properties": {
        "core_details": {
            "data_source_id": "2",
            "event_type": "work-zone",
            "related_road_events": [
                {"type": "first-in-sequence", "id": "6f57aded-7291-462e-9892-607b2b7d116c"},
                {"type": "next-in-sequence", "id": "e6c2abad-04e2-41fd-bd66-4cc41e4bb6e7"},
            ],
            "road_names": ["I-235"],
            "direction": "westbound",
            "name": "Project 65773 Event 2",
            "description": "Single-direction work zone represented by three sequential road events; second event.",
            "creation_date": "2009-12-31T11:56:26Z",
            "update_date": "2009-12-31T11:56:26Z",
        },
        "beginning_milepost": 2.9,
        "ending_milepost": 2.5,
        "start_date": "2010-01-01T14:00:00Z",
        "end_date": "2010-01-05T23:00:00Z",
        "location_method": "channel-device-method",
        "vehicle_impact": "some-lanes-closed",
        "worker_presence": {
            "are_workers_present": True,
            "method": "check-in-app",
            "worker_presence_last_confirmed_date": "2010-01-04T15:00:00Z",
            "confidence": "high",
            "definition": ["humans-in-right-of-way"],
        },
        "reduced_speed_limit_kph": 88.514,
        "restrictions": [],
        "types_of_work": [{"type_name": "surface-work", "is_architectural_change": True}],
        "lanes": [
            {"order": 1, "status": "closed", "type": "shoulder"},
            {"order": 2, "status": "closed", "type": "general"},
            {"order": 3, "status": "open", "type": "general"},
        ],
    },
    "geometry": {"type": "LineString", "coordinates": [[-93.724769, 41.593457], [-93.730149, 41.593410]]},
}

DETOUR = {
    "id": "detour-1",
    "type": "Feature",
    "properties": {
        "core_details": {
            "data_source_id": "2",
            "event_type": "detour",
            "road_names": ["Grand Ave"],
            "direction": "eastbound",
            "name": "Detour for Project 65773",
        },
        "start_date": "2010-01-01T14:00:00Z",
        "end_date": "2010-01-05T23:00:00Z",
    },
    "geometry": {"type": "LineString", "coordinates": [[-93.72, 41.59], [-93.71, 41.59]]},
}

WORK_ZONE_FEED = {
    "feed_info": FEED_INFO,
    "type": "FeatureCollection",
    "features": [SIMPLE, LANED, SEQUENCED, DETOUR],
}

ARROW_BOARD = {
    "id": "280258a2-d131-4d8d-b5a7-2cef813b25a8",
    "type": "Feature",
    "properties": {
        "core_details": {
            "device_type": "arrow-board",
            "data_source_id": "ff55b721-bd18-4c21-8ad7-1b31fdddd876",
            "road_names": ["I-80", "I-35"],
            "device_status": "ok",
            "has_automatic_location": True,
            "road_direction": "northbound",
            "name": "Arrow Board 1",
            "is_moving": False,
            "update_date": "2021-12-06T14:54:12Z",
        },
        "pattern": "right-arrow-flashing",
        "is_in_transport_position": False,
    },
    "geometry": {"type": "Point", "coordinates": [-93.776684, 41.617961]},
}

CAMERA = {
    "id": "camera-1",
    "type": "Feature",
    "properties": {
        "core_details": {
            "device_type": "camera",
            "data_source_id": "ff55b721-bd18-4c21-8ad7-1b31fdddd876",
            "device_status": "error",
            "status_messages": ["No image for 2 hours"],
            "has_automatic_location": False,
            "update_date": "2021-12-06T14:54:12Z",
        },
        "image_url": "https://cameras.example.gov/1.jpg",
    },
    "geometry": {"type": "Point", "coordinates": [-93.78, 41.62]},
}

DEVICE_FEED = {
    "feed_info": {**FEED_INFO, "publisher": "TestVendor"},
    "type": "FeatureCollection",
    "features": [ARROW_BOARD, CAMERA],
}

PAYLOADS = {FEED_URL: WORK_ZONE_FEED, DEVICE_URL: DEVICE_FEED}


def getter(payloads):
    def get(url, timeout=None, headers=None):
        response = Mock()
        response.json.return_value = payloads[url]
        response.raise_for_status.return_value = None
        return response

    return get


def run(query, payloads=PAYLOADS, get=None, **config):
    runner = WZDx({"feed_url": FEED_URL, "request_timeout": 5, **config})
    with patch("redash.query_runner.wzdx.requests.get", side_effect=get or getter(payloads)) as mocked:
        data, error = runner.run_query(query, None)
    return data, error, mocked


def rows_by_id(data):
    return {row["id"]: row for row in data["rows"]}
