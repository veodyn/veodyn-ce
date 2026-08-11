import type { SchemaTable } from '../types/schema'

export const mockSchema: Record<number, SchemaTable[]> = {
  // ClickHouse historical tables
  1: [
    {
      name: 'vehicle_locations',
      columns: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'device_id', type: 'String' },
        { name: 'lat', type: 'Float64' },
        { name: 'lon', type: 'Float64' },
        { name: 'speed', type: 'Float32' },
        { name: 'bearing', type: 'Float32' },
        { name: 'is_driving', type: 'UInt8' },
        { name: 'source', type: 'String' },
        { name: 'route_tag', type: 'String' },
        { name: 'vehicle_type', type: 'String' },
      ],
    },
    {
      name: 'bike_share_snapshots',
      columns: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'station_id', type: 'String' },
        { name: 'station_name', type: 'String' },
        { name: 'lat', type: 'Float64' },
        { name: 'lon', type: 'Float64' },
        { name: 'num_bikes_available', type: 'UInt16' },
        { name: 'num_docks_available', type: 'UInt16' },
        { name: 'system', type: 'String' },
      ],
    },
    {
      name: 'air_quality_readings',
      columns: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'station', type: 'String' },
        { name: 'parameter_name', type: 'String' },
        { name: 'aqi', type: 'UInt16' },
        { name: 'category', type: 'String' },
        { name: 'lat', type: 'Float64' },
        { name: 'lon', type: 'Float64' },
      ],
    },
    {
      name: 'traffic_incidents',
      columns: [
        { name: 'id', type: 'String' },
        { name: 'timestamp', type: 'DateTime' },
        { name: 'description', type: 'String' },
        { name: 'lat', type: 'Float64' },
        { name: 'lon', type: 'Float64' },
        { name: 'roadway', type: 'String' },
        { name: 'county', type: 'String' },
        { name: 'severity', type: 'String' },
        { name: 'source', type: 'String' },
        { name: 'category', type: 'String' },
        { name: 'start_date', type: 'DateTime' },
        { name: 'end_date', type: 'Nullable(DateTime)' },
      ],
    },
    {
      name: 'weather_observations',
      columns: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'temp_f', type: 'Float32' },
        { name: 'humidity', type: 'UInt8' },
        { name: 'pressure', type: 'Float32' },
        { name: 'condition', type: 'String' },
        { name: 'description', type: 'String' },
        { name: 'wind_speed', type: 'Float32' },
      ],
    },
    {
      name: 'camera_status',
      columns: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'camera_id', type: 'String' },
        { name: 'title', type: 'String' },
        { name: 'lat', type: 'Float64' },
        { name: 'lon', type: 'Float64' },
        { name: 'city', type: 'String' },
        { name: 'direction', type: 'String' },
        { name: 'is_disabled', type: 'UInt8' },
        { name: 'speed_mph', type: 'Nullable(Float32)' },
      ],
    },
    {
      name: 'bike_trip_counter',
      columns: [
        { name: 'date', type: 'Date' },
        { name: 'system', type: 'String' },
        { name: 'daily_trips', type: 'UInt32' },
        { name: 'weekly_trips', type: 'UInt32' },
        { name: 'monthly_trips', type: 'UInt32' },
        { name: 'yearly_trips', type: 'UInt32' },
        { name: 'total_trips', type: 'UInt64' },
      ],
    },
    {
      name: 'park_and_ride',
      columns: [
        { name: 'id', type: 'String' },
        { name: 'name', type: 'String' },
        { name: 'lat', type: 'Float64' },
        { name: 'lon', type: 'Float64' },
        { name: 'city', type: 'String' },
        { name: 'county', type: 'String' },
        { name: 'total_spaces', type: 'UInt16' },
        { name: 'cost', type: 'String' },
      ],
    },
  ],
  // PostgreSQL operational tables
  2: [
    {
      name: 'gbfs_sources',
      columns: [
        { name: 'id', type: 'serial' },
        { name: 'system_id', type: 'varchar(100)' },
        { name: 'name', type: 'varchar(255)' },
        { name: 'station_information_url', type: 'text' },
        { name: 'station_status_url', type: 'text' },
        { name: 'created_at', type: 'timestamp' },
      ],
    },
    {
      name: 'destinations',
      columns: [
        { name: 'id', type: 'serial' },
        { name: 'point_type', type: 'varchar(20)' },
        { name: 'name', type: 'varchar(255)' },
        { name: 'short_name', type: 'varchar(50)' },
        { name: 'lat', type: 'float8' },
        { name: 'lon', type: 'float8' },
        { name: 'icon_type', type: 'varchar(50)' },
      ],
    },
    {
      name: 'widget_settings',
      columns: [
        { name: 'id', type: 'serial' },
        { name: 'widget', type: 'varchar(100)' },
        { name: 'key', type: 'varchar(255)' },
        { name: 'value', type: 'text' },
      ],
    },
    {
      name: 'client_settings',
      columns: [
        { name: 'id', type: 'serial' },
        { name: 'client_name', type: 'varchar(100)' },
        { name: 'url', type: 'text' },
        { name: 'api_key', type: 'text' },
      ],
    },
  ],
  3: [],
}
