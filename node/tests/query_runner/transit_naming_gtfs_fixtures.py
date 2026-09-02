import io
import zipfile

BUS_URL = "https://gitlab.example.org/gtfs_bus.zip"
RAIL_URL = "https://gitlab.example.org/gtfs_rail.zip"

BUS_ROUTES_TXT = (
    "route_id,route_short_name,route_long_name,route_desc,route_type,route_color,route_text_color\n"
    "94-13201,94,Metro Local Line,DTWN LA - NOHO STA,3,,\n"
    "30-13201,30,Metro Local Line,PICO RIMPAU - DTWN LA,3,,\n"
    "9-13201,Dodger Stadium Express,,Game days from Union Station,3,,\n"
    "22-13201,South Bay Dodger Stadium Express,,Game days from Harbor Gateway,3,,\n"
    "901-13201,,Metro G Line (Orange) 901,METRO G LINE,3,FC4C02,FFFFFF\n"
    "910-13201,,Metro J Line (Silver) 910/950,METRO J LINE,3,ADB8BF,000000\n"
    "10-13201,10/48,Metro Local Line,W HOLLYWOOD-DTWN LA,3,,\n"
    "720-13201,720,Metro Rapid Line,SANTA MONICA - DTWN LA,3,E16710,FFFFFF\n"
)
BUS_TRIPS_TXT = (
    "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n"
    "30-13201,WD,t30a,,0,1,30_0\n"
    "30-13201,WD,t30b,,1,1,30_1\n"
    "720-13201,WD,t720a,,0,2,720_0\n"
    "720-13201,WD,t720x,,0,2,720_0x\n"
    "720-13201,WD,t720b,,1,2,720_1\n"
    "94-13201,WD,t94a,,0,3,94_0\n"
)
BUS_STOP_TIMES_TXT = (
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
    "t30a,06:00:00,06:00:00,3000001,1\n"
    "t30a,06:05:00,06:05:00,13574,2\n"
    "t30a,06:09:00,06:09:00,19022,3\n"
    "t30a,06:12:00,06:12:00,1166,4\n"
    "t30b,07:00:00,07:00:00,1166,1\n"
    "t30b,07:03:00,07:03:00,19022,2\n"
    "t30b,07:07:00,07:07:00,13574,3\n"
    "t30b,07:12:00,07:12:00,3000001,4\n"
    "t720a,08:00:00,08:00:00,1166,1\n"
    "t720a,08:10:00,08:10:00,13574,2\n"
    "t720a,08:20:00,08:20:00,9001,3\n"
    "t720a,08:30:00,08:30:00,9002,4\n"
    "t720x,09:00:00,09:00:00,1166,1\n"
    "t720x,09:10:00,09:10:00,13574,2\n"
    "t720x,09:20:00,09:20:00,9003,3\n"
    "t720b,10:00:00,10:00:00,9002,1\n"
    "t720b,10:10:00,10:10:00,9001,2\n"
    "t720b,10:20:00,10:20:00,13574,3\n"
    "t720b,10:30:00,10:30:00,1166,4\n"
    "t94a,11:00:00,11:00:00,1166,1\n"
    "t94a,11:10:00,11:10:00,19022,2\n"
)
BUS_STOPS_TXT = (
    "stop_id,stop_code,stop_name,stop_lat,stop_lon\n"
    "1166,1166,1st / Main,34.051917,-118.243244\n"
    "13574,13574,Grand / Pico,34.0400,-118.2600\n"
    "19022,19022,Broadway / 5th,34.0480,-118.2510\n"
    "3000001,3000001,Pico / Rimpau,34.0470,-118.3440\n"
    "9001,9001,Wilshire / Western,34.0600,-118.3000\n"
    "9002,9002,Wilshire / Normandie,34.0700,-118.3100\n"
    "9003,9003,Wilshire / Vermont,34.0650,-118.3050\n"
)
RAIL_ROUTES_TXT = (
    "route_id,route_short_name,route_long_name,route_desc,route_type,route_color,route_text_color\n"
    "801,,Metro A Line,,0,0072BC,FFFFFF\n"
    "802,,Metro B Line,,1,EB131B,FFFFFF\n"
    "807,,Metro K Line,,0,E56DB1,000000\n"
)
RAIL_TRIPS_TXT = "route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n801,WD,r801a,,0,1,801NB\n"
RAIL_STOP_TIMES_TXT = (
    "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
    "r801a,05:00:00,05:00:00,80101,1\n"
    "r801a,05:03:00,05:03:00,80102,2\n"
)
RAIL_STOPS_TXT = (
    "stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
    "80101,80101,Downtown Long Beach Station,33.768071,-118.192921,0,80101S\n"
    "80101S,80101S,Downtown Long Beach Station,33.768071,-118.192921,1,\n"
    "80102,80102,Pacific Ave Station,33.7720,-118.1930,0,\n"
)

BUS_MEMBERS = {
    "routes.txt": BUS_ROUTES_TXT,
    "trips.txt": BUS_TRIPS_TXT,
    "stop_times.txt": BUS_STOP_TIMES_TXT,
    "stops.txt": BUS_STOPS_TXT,
}
RAIL_MEMBERS = {
    "routes.txt": RAIL_ROUTES_TXT,
    "trips.txt": RAIL_TRIPS_TXT,
    "stop_times.txt": RAIL_STOP_TIMES_TXT,
    "stops.txt": RAIL_STOPS_TXT,
}


def build_archive(members):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, text in members.items():
            archive.writestr(name, text.encode("utf-8"))
    return buffer.getvalue()


def archive_fetcher(by_url):
    calls = []

    def fetch(url, max_bytes, timeout=None):
        calls.append(url)
        content = by_url[url]
        if isinstance(content, Exception):
            raise content
        return content

    fetch.calls = calls
    return fetch


def metro_archives():
    return archive_fetcher({BUS_URL: build_archive(BUS_MEMBERS), RAIL_URL: build_archive(RAIL_MEMBERS)})
