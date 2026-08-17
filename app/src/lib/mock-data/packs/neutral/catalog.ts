import type { Dataset, DomainHub } from '@/types/catalog'
import { mockQueries } from './queries'
import { mockDashboards } from './dashboards'

// Real query ids from this pack, so dataset CTAs reach a working query.
const railRidershipQueryId = mockQueries.find((q) => q.id === 1)?.id ?? null
const airQualityQueryId = mockQueries.find((q) => q.id === 2)?.id ?? null
const bikeAvailabilityQueryId = mockQueries.find((q) => q.id === 3)?.id ?? null
const trafficIncidentsQueryId = mockQueries.find((q) => q.id === 4)?.id ?? null
const fleetStatusQueryId = mockQueries.find((q) => q.id === 5)?.id ?? null
const bikeTripsQueryId = mockQueries.find((q) => q.id === 6)?.id ?? null
const trafficCamerasQueryId = mockQueries.find((q) => q.id === 7)?.id ?? null

// Real dashboard ids from this pack, so hub dashboard links resolve.
const overviewDashboardId = mockDashboards.find((d) => d.id === 1)?.id
const bikeShareDashboardId = mockDashboards.find((d) => d.id === 2)?.id

export const mockDatasets: Dataset[] = [
  {
    id: 'route-ridership-daily',
    name: 'Route Ridership (Daily)',
    description: 'Daily boardings by route across the transit network, from onboard passenger counters.',
    domain: 'transit',
    schema: [
      { name: 'service_date', type: 'date', description: 'Calendar day of service' },
      { name: 'route_id', type: 'string', description: 'Route identifier' },
      { name: 'boardings', type: 'integer', description: 'Total boardings' },
      { name: 'revenue_hours', type: 'float', description: 'In-service hours for the route' },
    ],
    freshness: { lastUpdatedAt: '2026-07-21T06:00:00Z', status: 'fresh', feedId: 'route-counts-daily' },
    coverage: { start: '2019-01-01T00:00:00Z', end: '2026-07-20T00:00:00Z' },
    rowCount: 3_450_610,
    sources: ['Onboard Passenger Counters', 'Service Schedule'],
    tags: ['ridership', 'transit', 'daily'],
    sampleQueryId: null,
    origin: 'capture',
    writable: false,
  },
  {
    id: 'bike-share-availability',
    name: 'Bike Share Station Availability',
    description: 'Current bike and dock availability across all bike share stations, refreshed every 5 minutes.',
    domain: 'transit',
    schema: [
      { name: 'station_name', type: 'string' },
      { name: 'lat', type: 'float' },
      { name: 'lon', type: 'float' },
      { name: 'bikes', type: 'integer', description: 'Bikes currently available' },
      { name: 'docks', type: 'integer', description: 'Docks currently available' },
      { name: 'system', type: 'string' },
    ],
    freshness: { lastUpdatedAt: '2026-07-22T05:55:00Z', status: 'fresh', feedId: 'bikeshare-gbfs' },
    coverage: { start: '2025-01-05T00:00:00Z', end: '2026-07-22T05:55:00Z' },
    rowCount: 214_050,
    sources: ['Bike Share GBFS Feed'],
    tags: ['bike-share', 'availability', 'real-time'],
    sampleQueryId: bikeAvailabilityQueryId,
    origin: 'capture',
    writable: false,
  },
  {
    id: 'bike-share-daily-trips',
    name: 'Bike Share Daily Trips',
    description: 'Daily trip counter (daily, weekly, monthly, total) from the bike share trip ledger.',
    domain: 'transit',
    schema: [
      { name: 'date', type: 'date' },
      { name: 'system', type: 'string' },
      { name: 'daily_trips', type: 'integer' },
      { name: 'weekly_trips', type: 'integer' },
      { name: 'monthly_trips', type: 'integer' },
      { name: 'total_trips', type: 'integer' },
    ],
    freshness: { lastUpdatedAt: '2026-07-10T23:00:00Z', status: 'stale', feedId: 'bikeshare-trip-ledger' },
    coverage: { start: '2025-01-05T00:00:00Z', end: '2026-07-10T00:00:00Z' },
    rowCount: 46_920,
    sources: ['Bike Share Trip Ledger'],
    tags: ['bike-share', 'trips', 'daily'],
    sampleQueryId: bikeTripsQueryId,
    origin: 'capture',
    writable: false,
  },
  {
    id: 'rail-network-daily-ridership',
    name: 'Rail Network Daily Ridership',
    description: 'Daily vehicle counts and average speed by rail line, sourced from rail SCADA telemetry.',
    domain: 'rail',
    schema: [
      { name: 'date', type: 'date' },
      { name: 'line', type: 'string', description: 'Rail line tag' },
      { name: 'vehicle_count', type: 'integer' },
      { name: 'avg_speed', type: 'float', description: 'Average speed in mph' },
    ],
    freshness: { lastUpdatedAt: '2026-07-21T06:00:00Z', status: 'fresh', feedId: 'rail-scada' },
    coverage: { start: '2020-06-01T00:00:00Z', end: '2026-07-20T00:00:00Z' },
    rowCount: 1_204_880,
    sources: ['Rail SCADA'],
    tags: ['rail', 'ridership'],
    sampleQueryId: railRidershipQueryId,
    origin: 'capture',
    writable: false,
  },
  {
    id: 'traffic-incidents-weekly',
    name: 'Traffic Incidents (Weekly)',
    description: 'Reported traffic incidents for the current week, broken out by severity and category.',
    domain: 'freeway',
    schema: [
      { name: 'date', type: 'date' },
      { name: 'category', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'source', type: 'string', description: 'Reporting feed' },
      { name: 'incident_count', type: 'integer' },
    ],
    freshness: { lastUpdatedAt: '2026-07-22T04:30:00Z', status: 'fresh', feedId: 'incident-feed' },
    coverage: { start: '2025-03-20T00:00:00Z', end: '2026-07-22T00:00:00Z' },
    rowCount: 318_640,
    sources: ['Incident Reporting Feed'],
    tags: ['traffic', 'incidents', 'safety'],
    sampleQueryId: trafficIncidentsQueryId,
    origin: 'capture',
    writable: false,
  },
  {
    id: 'fleet-vehicle-status',
    name: 'Fleet Vehicle Status Summary',
    description: 'Real-time status of service patrol vehicles: driving vs stationary, refreshed every minute.',
    domain: 'freeway',
    schema: [
      { name: 'driving', type: 'integer' },
      { name: 'stationary', type: 'integer' },
      { name: 'total_vehicles', type: 'integer' },
      { name: 'avg_speed_mph', type: 'float' },
    ],
    freshness: { lastUpdatedAt: '2026-07-22T05:59:00Z', status: 'fresh', feedId: 'fleet-avl' },
    coverage: { start: '2025-04-15T00:00:00Z', end: '2026-07-22T05:59:00Z' },
    rowCount: 892_410,
    sources: ['Fleet Automatic Vehicle Location'],
    tags: ['fleet', 'vehicles', 'real-time'],
    sampleQueryId: fleetStatusQueryId,
    origin: 'capture',
    writable: false,
  },
  {
    id: 'traffic-cameras-by-city',
    name: 'Traffic Cameras by City',
    description: 'CCTV traffic camera inventory and active/disabled status, grouped by city and direction.',
    domain: 'freeway',
    schema: [
      { name: 'city', type: 'string' },
      { name: 'direction', type: 'string' },
      { name: 'total_cameras', type: 'integer' },
      { name: 'active_cameras', type: 'integer' },
      { name: 'disabled_cameras', type: 'integer' },
    ],
    freshness: { lastUpdatedAt: '2026-06-30T15:00:00Z', status: 'stale', feedId: 'camera-inventory' },
    coverage: { start: '2025-06-10T00:00:00Z', end: '2026-06-30T00:00:00Z' },
    rowCount: 5_120,
    sources: ['Camera Inventory Feed'],
    tags: ['cameras', 'cctv', 'traffic'],
    sampleQueryId: trafficCamerasQueryId,
    origin: 'capture',
    writable: false,
  },
  {
    id: 'air-quality-by-station',
    name: 'Air Quality Index by Station',
    description: 'Hourly AQI readings from monitoring stations across the region.',
    domain: null,
    schema: [
      { name: 'hour', type: 'timestamp' },
      { name: 'station', type: 'string' },
      { name: 'parameter_name', type: 'string' },
      { name: 'avg_aqi', type: 'float' },
      { name: 'max_aqi', type: 'float' },
      { name: 'category', type: 'string' },
    ],
    freshness: { lastUpdatedAt: '2026-07-22T04:00:00Z', status: 'fresh', feedId: 'aqi-hourly' },
    coverage: { start: '2024-07-10T00:00:00Z', end: '2026-07-22T04:00:00Z' },
    rowCount: 1_680_220,
    sources: ['Regional Air Quality Monitors'],
    tags: ['air-quality', 'environment', 'health'],
    sampleQueryId: airQualityQueryId,
    origin: 'capture',
    writable: false,
  },
]

export const mockDomainHubs: DomainHub[] = [
  {
    key: 'transit',
    label: 'Transit',
    icon: 'bus',
    datasetIds: ['route-ridership-daily', 'bike-share-availability', 'bike-share-daily-trips'],
    dashboardIds: [overviewDashboardId, bikeShareDashboardId].filter((v): v is number => v != null),
    counters: [
      { label: 'Weekly boardings', value: 5_382_240, delta: 2.4, deltaUnit: '%', queryId: railRidershipQueryId ?? undefined },
      // Wired to the KPI object of the same name in ./kpis, so this tile renders
      // a live KpiScorecard. The id is a literal, not an import: kpis.ts already
      // imports mockDomainHubs from here, and importing back would be a cycle.
      // neutral.test.ts asserts every kpiId resolves in its pack. This counter's
      // own value/delta are only the fallback for an unresolved kpiId
      // (HubCounterRow renders the live KPI's evaluation instead), so they do
      // not need to track the KPI's own history.
      { label: 'On-time performance', value: 90, unit: '%', delta: 0.8, kpiId: 'on-time-performance' },
      { label: 'Active routes', value: 96 },
    ],
  },
  {
    key: 'freeway',
    label: 'Freeways',
    icon: 'car',
    datasetIds: ['traffic-incidents-weekly', 'fleet-vehicle-status', 'traffic-cameras-by-city'],
    dashboardIds: [overviewDashboardId].filter((v): v is number => v != null),
    counters: [
      { label: 'Open incidents', value: 29, delta: -3.1, deltaUnit: '%', queryId: trafficIncidentsQueryId ?? undefined },
      { label: 'Fleet vehicles active', value: 34, queryId: fleetStatusQueryId ?? undefined },
      { label: 'Cameras online', value: 2_180, delta: 1.6, deltaUnit: '%' },
    ],
  },
  {
    key: 'rail',
    label: 'Rail',
    icon: 'train',
    datasetIds: ['rail-network-daily-ridership'],
    dashboardIds: [overviewDashboardId].filter((v): v is number => v != null),
    counters: [
      { label: 'Daily rail boardings', value: 176_540, delta: 2.9, deltaUnit: '%', queryId: railRidershipQueryId ?? undefined },
      { label: 'Average speed', value: 31, unit: 'mph' },
    ],
  },
]
