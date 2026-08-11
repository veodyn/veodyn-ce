import type { MockQueryResult } from '../types/query-results'
import { vizQueryResultsC } from './viz-fixtures-c'
import { vizQueryResultsD } from './viz-fixtures-d'
import { vizQueryResultsE } from './viz-fixtures-e'
import { vizQueryResultsF } from './viz-fixtures-f'

// Helper to generate dates
function daysAgo(n: number): string {
  const d = new Date(2026, 2, 19) // March 19, 2026
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

const RAIL_LINES = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5', 'Line 6']

export const mockQueryResults: Record<number, MockQueryResult> = {
  // Query 1: Rail Network Daily Ridership
  101: {
    id: 101,
    query_hash: 'hash_101',
    query: 'SELECT toDate(timestamp) AS date, route_tag AS line...',
    data: {
      columns: [
        { name: 'date', friendly_name: 'Date', type: 'date' },
        { name: 'line', friendly_name: 'Line', type: 'string' },
        { name: 'vehicle_count', friendly_name: 'Vehicle Count', type: 'integer' },
        { name: 'avg_speed', friendly_name: 'Avg Speed (mph)', type: 'float' },
      ],
      rows: RAIL_LINES.flatMap((line, idx) =>
        Array.from({ length: 30 }, (_, i) => ({
          date: daysAgo(29 - i),
          line,
          vehicle_count: Math.floor(Math.random() * 40) + (idx === 1 ? 80 : idx === 0 ? 70 : 40),
          avg_speed: Math.round((Math.random() * 15 + 25) * 10) / 10,
        }))
      ),
    },
    data_source_id: 1,
    runtime: 0.342,
    retrieved_at: '2026-03-18T06:00:00Z',
  },

  // Query 2: Air Quality Index by Station
  102: {
    id: 102,
    query_hash: 'hash_102',
    query: 'SELECT toStartOfHour(timestamp) AS hour, station...',
    data: {
      columns: [
        { name: 'hour', friendly_name: 'Hour', type: 'datetime' },
        { name: 'station', friendly_name: 'Station', type: 'string' },
        { name: 'parameter_name', friendly_name: 'Parameter', type: 'string' },
        { name: 'avg_aqi', friendly_name: 'Avg AQI', type: 'float' },
        { name: 'max_aqi', friendly_name: 'Max AQI', type: 'integer' },
        { name: 'category', friendly_name: 'Category', type: 'string' },
      ],
      rows: [
        { hour: '2026-03-19T08:00:00', station: 'Downtown', parameter_name: 'PM2.5', avg_aqi: 62, max_aqi: 78, category: 'Moderate' },
        { hour: '2026-03-19T08:00:00', station: 'Station B', parameter_name: 'PM2.5', avg_aqi: 45, max_aqi: 52, category: 'Good' },
        { hour: '2026-03-19T08:00:00', station: 'Station C', parameter_name: 'PM2.5', avg_aqi: 71, max_aqi: 89, category: 'Moderate' },
        { hour: '2026-03-19T08:00:00', station: 'Station D', parameter_name: 'Ozone', avg_aqi: 38, max_aqi: 44, category: 'Good' },
        { hour: '2026-03-19T07:00:00', station: 'Downtown', parameter_name: 'PM2.5', avg_aqi: 58, max_aqi: 72, category: 'Moderate' },
        { hour: '2026-03-19T07:00:00', station: 'Station B', parameter_name: 'PM2.5', avg_aqi: 42, max_aqi: 49, category: 'Good' },
        { hour: '2026-03-19T07:00:00', station: 'Station C', parameter_name: 'PM2.5', avg_aqi: 65, max_aqi: 81, category: 'Moderate' },
        { hour: '2026-03-19T06:00:00', station: 'Downtown', parameter_name: 'PM2.5', avg_aqi: 48, max_aqi: 56, category: 'Good' },
        { hour: '2026-03-19T06:00:00', station: 'Station B', parameter_name: 'PM2.5', avg_aqi: 35, max_aqi: 41, category: 'Good' },
        { hour: '2026-03-19T06:00:00', station: 'Station C', parameter_name: 'PM2.5', avg_aqi: 55, max_aqi: 68, category: 'Moderate' },
        { hour: '2026-03-19T06:00:00', station: 'Station D', parameter_name: 'Ozone', avg_aqi: 32, max_aqi: 38, category: 'Good' },
      ],
    },
    data_source_id: 1,
    runtime: 1.205,
    retrieved_at: '2026-03-18T07:00:00Z',
  },

  // Query 3: Bike Share Station Availability
  103: {
    id: 103,
    query_hash: 'hash_103',
    query: 'SELECT station_name, lat, lon, num_bikes_available...',
    data: {
      columns: [
        { name: 'station_name', friendly_name: 'Station', type: 'string' },
        { name: 'lat', friendly_name: 'Latitude', type: 'float' },
        { name: 'lon', friendly_name: 'Longitude', type: 'float' },
        { name: 'bikes', friendly_name: 'Bikes Available', type: 'integer' },
        { name: 'docks', friendly_name: 'Docks Available', type: 'integer' },
        { name: 'total_capacity', friendly_name: 'Total Capacity', type: 'integer' },
        { name: 'pct_full', friendly_name: '% Full', type: 'float' },
        { name: 'system', friendly_name: 'System', type: 'string' },
      ],
      // Coordinates are a deliberately synthetic grid, not a real transit
      // network: this used to be the exact real-world station coordinates of
      // named locations in the private tenant pack, station for station,
      // which let the two packs be aligned row by row.
      rows: [
        { station_name: 'Station A', lat: 12.1000, lon: -46.2000, bikes: 6, docks: 9, total_capacity: 15, pct_full: 40.0, system: 'bike_share_a' },
        { station_name: 'Station B', lat: 12.2500, lon: -46.3500, bikes: 4, docks: 11, total_capacity: 15, pct_full: 26.7, system: 'bike_share_a' },
        { station_name: 'Station C', lat: 12.4000, lon: -46.5000, bikes: 10, docks: 5, total_capacity: 15, pct_full: 66.7, system: 'bike_share_a' },
        { station_name: 'Station D', lat: 12.5500, lon: -46.6500, bikes: 7, docks: 8, total_capacity: 15, pct_full: 46.7, system: 'bike_share_a' },
        { station_name: 'Station E', lat: 12.7000, lon: -46.8000, bikes: 9, docks: 6, total_capacity: 15, pct_full: 60.0, system: 'bike_share_a' },
        { station_name: 'Station F', lat: 12.8500, lon: -46.9500, bikes: 3, docks: 12, total_capacity: 15, pct_full: 20.0, system: 'bike_share_a' },
        { station_name: 'Station G', lat: 13.0000, lon: -47.1000, bikes: 8, docks: 7, total_capacity: 15, pct_full: 53.3, system: 'bike_share_a' },
        { station_name: 'Station H', lat: 13.1500, lon: -47.2500, bikes: 5, docks: 10, total_capacity: 15, pct_full: 33.3, system: 'bike_share_a' },
        { station_name: 'Station I', lat: 13.3000, lon: -47.4000, bikes: 11, docks: 4, total_capacity: 15, pct_full: 73.3, system: 'bike_share_b' },
        { station_name: 'Station J', lat: 13.4500, lon: -47.5500, bikes: 12, docks: 3, total_capacity: 15, pct_full: 80.0, system: 'bike_share_b' },
      ],
    },
    data_source_id: 1,
    runtime: 0.567,
    retrieved_at: '2026-03-18T08:00:00Z',
  },

  // Query 4: Traffic Incidents This Week
  104: {
    id: 104,
    query_hash: 'hash_104',
    query: 'SELECT toDate(timestamp) AS date, category...',
    data: {
      columns: [
        { name: 'date', friendly_name: 'Date', type: 'date' },
        { name: 'category', friendly_name: 'Category', type: 'string' },
        { name: 'severity', friendly_name: 'Severity', type: 'string' },
        { name: 'source', friendly_name: 'Source', type: 'string' },
        { name: 'incident_count', friendly_name: 'Incidents', type: 'integer' },
      ],
      rows: [
        { date: daysAgo(0), category: 'Accident', severity: 'Major', source: 'Traffic Ops', incident_count: 12 },
        { date: daysAgo(0), category: 'Road Work', severity: 'Minor', source: 'Traffic Ops', incident_count: 28 },
        { date: daysAgo(0), category: 'Closure', severity: 'Major', source: 'Traffic Ops', incident_count: 5 },
        { date: daysAgo(0), category: 'Accident', severity: 'Minor', source: 'Waze', incident_count: 34 },
        { date: daysAgo(0), category: 'Hazard', severity: 'Minor', source: 'Waze', incident_count: 18 },
        { date: daysAgo(1), category: 'Accident', severity: 'Major', source: 'Traffic Ops', incident_count: 15 },
        { date: daysAgo(1), category: 'Road Work', severity: 'Minor', source: 'Traffic Ops', incident_count: 31 },
        { date: daysAgo(1), category: 'Closure', severity: 'Major', source: 'Traffic Ops', incident_count: 7 },
        { date: daysAgo(1), category: 'Accident', severity: 'Minor', source: 'Waze', incident_count: 41 },
        { date: daysAgo(2), category: 'Accident', severity: 'Major', source: 'Traffic Ops', incident_count: 9 },
        { date: daysAgo(2), category: 'Road Work', severity: 'Minor', source: 'Traffic Ops', incident_count: 25 },
        { date: daysAgo(2), category: 'Accident', severity: 'Minor', source: 'Waze', incident_count: 37 },
        { date: daysAgo(2), category: 'Hazard', severity: 'Minor', source: 'Waze', incident_count: 22 },
      ],
    },
    data_source_id: 1,
    runtime: 2.103,
    retrieved_at: '2026-02-28T15:00:00Z',
  },

  // Query 5: Fleet Vehicle Status Summary
  105: {
    id: 105,
    query_hash: 'hash_105',
    query: 'SELECT countIf(is_driving = 1) AS driving...',
    data: {
      columns: [
        { name: 'status', friendly_name: 'Status', type: 'string' },
        { name: 'count', friendly_name: 'Count', type: 'integer' },
        { name: 'total_vehicles', friendly_name: 'Total Vehicles', type: 'integer' },
        { name: 'avg_speed_mph', friendly_name: 'Avg Speed (mph)', type: 'float' },
      ],
      rows: [
        { status: 'Driving', count: 42, total_vehicles: 67, avg_speed_mph: 34.2 },
        { status: 'Stationary', count: 25, total_vehicles: 67, avg_speed_mph: 0 },
      ],
    },
    data_source_id: 1,
    runtime: 0.089,
    retrieved_at: '2026-03-18T09:00:00Z',
  },

  // Query 6: Bike Share Daily Trips
  106: {
    id: 106,
    query_hash: 'hash_106',
    query: 'SELECT date, system, daily_trips...',
    data: {
      columns: [
        { name: 'date', friendly_name: 'Date', type: 'date' },
        { name: 'system', friendly_name: 'System', type: 'string' },
        { name: 'daily_trips', friendly_name: 'Daily Trips', type: 'integer' },
        { name: 'weekly_trips', friendly_name: 'Weekly Trips', type: 'integer' },
        { name: 'monthly_trips', friendly_name: 'Monthly Trips', type: 'integer' },
        { name: 'total_trips', friendly_name: 'Total Trips', type: 'integer' },
      ],
      rows: Array.from({ length: 30 }, (_, i) => ({
        date: daysAgo(29 - i),
        system: 'bike_share_a',
        daily_trips: Math.floor(Math.random() * 400) + 600,
        weekly_trips: Math.floor(Math.random() * 2000) + 5000,
        monthly_trips: Math.floor(Math.random() * 5000) + 25000,
        total_trips: 1_245_000 + i * 850,
      })),
    },
    data_source_id: 1,
    runtime: 0.445,
    retrieved_at: '2026-03-10T13:00:00Z',
  },

  // Query 7: Traffic Cameras by City
  107: {
    id: 107,
    query_hash: 'hash_107',
    query: 'SELECT city, direction, count(*) AS total_cameras...',
    data: {
      columns: [
        { name: 'city', friendly_name: 'City', type: 'string' },
        { name: 'direction', friendly_name: 'Direction', type: 'string' },
        { name: 'total_cameras', friendly_name: 'Total Cameras', type: 'integer' },
        { name: 'active_cameras', friendly_name: 'Active', type: 'integer' },
        { name: 'disabled_cameras', friendly_name: 'Disabled', type: 'integer' },
        { name: 'avg_speed', friendly_name: 'Avg Speed (mph)', type: 'float' },
      ],
      rows: [
        { city: 'City A', direction: 'NB', total_cameras: 45, active_cameras: 42, disabled_cameras: 3, avg_speed: 38.5 },
        { city: 'City A', direction: 'SB', total_cameras: 43, active_cameras: 41, disabled_cameras: 2, avg_speed: 35.2 },
        { city: 'City A', direction: 'EB', total_cameras: 38, active_cameras: 36, disabled_cameras: 2, avg_speed: 41.7 },
        { city: 'City A', direction: 'WB', total_cameras: 36, active_cameras: 34, disabled_cameras: 2, avg_speed: 29.8 },
      ],
    },
    data_source_id: 1,
    runtime: 0.156,
    retrieved_at: '2026-01-20T15:00:00Z',
  },

  // Query 8: Weather & Temperature History
  108: {
    id: 108,
    query_hash: 'hash_108',
    query: 'SELECT toStartOfHour(timestamp) AS hour, avg(temp_f)...',
    data: {
      columns: [
        { name: 'hour', friendly_name: 'Hour', type: 'datetime' },
        { name: 'temp_f', friendly_name: 'Temp (F)', type: 'float' },
        { name: 'humidity', friendly_name: 'Humidity (%)', type: 'integer' },
        { name: 'condition', friendly_name: 'Condition', type: 'string' },
        { name: 'wind_mph', friendly_name: 'Wind (mph)', type: 'float' },
      ],
      rows: Array.from({ length: 48 }, (_, i) => {
        const hour = i % 24
        const dayOffset = Math.floor(i / 24)
        const baseTemp = hour >= 6 && hour <= 18 ? 72 + (hour - 12) * 0.8 : 58 + Math.abs(hour - 3) * 0.5
        return {
          hour: `2026-03-${String(18 - dayOffset).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`,
          temp_f: Math.round((baseTemp + Math.random() * 6 - 3) * 10) / 10,
          humidity: Math.floor(Math.random() * 30) + (hour < 8 ? 55 : 35),
          condition: hour >= 6 && hour <= 18 ? 'Clear' : 'Clear',
          wind_mph: Math.round((Math.random() * 8 + 3) * 10) / 10,
        }
      }),
    },
    data_source_id: 1,
    runtime: 1.887,
    retrieved_at: '2026-02-15T10:00:00Z',
  },

  // Query 10 (archived): Old incident summary
  110: {
    id: 110,
    query_hash: 'hash_110',
    query: 'SELECT count(*) FROM traffic_incidents...',
    data: {
      columns: [
        { name: 'total', friendly_name: 'Total Incidents', type: 'integer' },
      ],
      rows: [{ total: 347 }],
    },
    data_source_id: 1,
    runtime: 0.045,
    retrieved_at: '2025-06-01T10:00:00Z',
  },

  // Results 111-121, for the queries in viz-fixtures-c/d/e/f. Spread rather
  // than written out here, so each of those files stays the one place its
  // types are authored and this file stays under the size hook.
  ...vizQueryResultsC,
  ...vizQueryResultsD,
  ...vizQueryResultsE,
  ...vizQueryResultsF,
}
