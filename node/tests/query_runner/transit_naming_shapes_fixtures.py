from tests.query_runner.transit_naming_gtfs_fixtures import (
    BUS_MEMBERS,
    BUS_STOP_TIMES_TXT,
    BUS_URL,
    RAIL_MEMBERS,
    RAIL_URL,
    archive_fetcher,
    build_archive,
)

SHAPE_TRIPS_TXT = (
    "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n"
    "30-13201,WD,t30a,Pico Rimpau,0,1,30_0\n"
    "30-13201,WD,t30b,Downtown,1,1,30_1\n"
    "720-13201,WD,t720a,Santa Monica,0,2,720_0\n"
    "720-13201,WD,t720c,Santa Monica,0,2,720_0b\n"
    "720-13201,WD,t720d,Santa Monica Express,0,2,720_0b\n"
    "720-13201,WD,t720x,,0,2,720_0-2\n"
    "720-13201,WD,t720b,Downtown,1,2,720_1a\n"
    "720-13201,WD,t720e,Zed,1,2,720_1a\n"
    "720-13201,WD,t720f,Alpha,1,2,720_1\n"
    "94-13201,WD,t94a,,0,3,\n"
    "94-13201,WD,t94b,Central Station,1,3,\n"
    "910-13201,WD,t910a,,0,4,910_0\n"
)
SHAPE_STOP_TIMES_TXT = BUS_STOP_TIMES_TXT + (
    "t720c,09:00:00,09:00:00,1166,1\n"
    "t720c,09:10:00,09:10:00,13574,2\n"
    "t720c,09:20:00,09:20:00,9001,3\n"
    "t720c,09:30:00,09:30:00,9002,4\n"
    "t720d,10:00:00,10:00:00,1166,1\n"
    "t720d,10:10:00,10:10:00,13574,2\n"
    "t720d,10:20:00,10:20:00,9001,3\n"
    "t720d,10:30:00,10:30:00,9002,4\n"
    "t720e,11:00:00,11:00:00,9002,1\n"
    "t720e,11:10:00,11:10:00,13574,2\n"
    "t720e,11:20:00,11:20:00,1166,3\n"
    "t720f,12:00:00,12:00:00,9002,1\n"
    "t720f,12:10:00,12:10:00,13574,2\n"
    "t720f,12:20:00,12:20:00,1166,3\n"
    "t94b,13:00:00,13:00:00,9999,1\n"
    "t94b,13:10:00,13:10:00,1166,2\n"
    "t910a,14:00:00,14:00:00,1166,1\n"
    "t910a,14:10:00,14:10:00,19022,2\n"
)
SHAPES_TXT = (
    "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
    "30_0,34.0,-117.8,10\n"
    "30_0,34.0,-118.0,1\n"
    "30_0,34.01,-117.9,2\n"
    "30_1,34.05,-118.25,1\n"
    "720_0,34.0,-118.0,1\n"
    "720_0,34.1,-118.1,2\n"
    "720_0b,34.0,-118.0,1\n"
    "720_0b,34.0,-117.9,2\n"
    "720_0b,34.0,-117.8,3\n"
    "720_0b,34.0,-117.7,4\n"
    "720_0-2,34.2,-118.0,1\n"
    "720_0-2,34.3,-118.1,2\n"
    "720_0-2,34.4,-118.0,3\n"
    "720_1,34.5,-118.0,1\n"
    "720_1,34.6,-118.1,2\n"
    "720_1a,35.0,-119.0,1\n"
    "720_1a,35.1,-119.1,2\n"
)
SHAPE_BUS_MEMBERS = {
    **BUS_MEMBERS,
    "trips.txt": SHAPE_TRIPS_TXT,
    "stop_times.txt": SHAPE_STOP_TIMES_TXT,
    "shapes.txt": SHAPES_TXT,
}


def shape_archives(bus_members=None):
    return archive_fetcher(
        {BUS_URL: build_archive(bus_members or SHAPE_BUS_MEMBERS), RAIL_URL: build_archive(RAIL_MEMBERS)}
    )
