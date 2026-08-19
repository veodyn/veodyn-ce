import type { Capture } from '@/types/capture'

// Capture ids match the freshness.captureId values on this pack's catalog
// datasets. Order, cadences, receipt timestamps and the status sequence are
// independent of the private tenant pack's capture list on purpose: this file
// used to carry the same order, the same cadences and the same timestamps down
// to the minute, which let the two packs be diffed against each other row by
// row.
export const mockCaptures: Capture[] = [
  {
    id: 'bikeshare-gbfs',
    name: 'Bike Share GBFS',
    source: 'Bike Share',
    cadence: 'every 3 min',
    lastReceivedAt: '2026-07-22T04:12:00Z',
    status: 'fresh',
    datasetCount: 1,
  },
  {
    id: 'fleet-avl',
    name: 'Fleet AVL',
    source: 'Fleet Operations',
    cadence: 'every 2 min',
    lastReceivedAt: '2026-07-22T04:10:00Z',
    status: 'fresh',
    datasetCount: 1,
  },
  {
    id: 'aqi-hourly',
    name: 'Air Quality Index',
    source: 'Sensor Network',
    cadence: 'every 30 min',
    lastReceivedAt: '2026-07-22T03:30:00Z',
    status: 'fresh',
    datasetCount: 1,
  },
  {
    id: 'traffic-incidents',
    name: 'Traffic Incidents',
    source: 'Incident Reporting',
    cadence: 'every 10 min',
    lastReceivedAt: '2026-07-21T21:40:00Z',
    status: 'down',
    datasetCount: 1,
  },
  {
    id: 'route-counts-daily',
    name: 'Onboard Passenger Counters',
    source: 'Route AVL',
    cadence: 'every 12 hours',
    lastReceivedAt: '2026-07-22T00:00:00Z',
    status: 'fresh',
    datasetCount: 1,
  },
  {
    id: 'camera-inventory',
    name: 'Traffic Camera Inventory',
    source: 'Camera Operations',
    cadence: 'every 10 days',
    lastReceivedAt: '2026-07-11T00:00:00Z',
    status: 'stale',
    datasetCount: 1,
  },
  {
    id: 'bikeshare-trip-ledger',
    name: 'Bike Share Trip Ledger',
    source: 'Bike Share',
    cadence: 'daily',
    lastReceivedAt: '2026-07-20T09:30:00Z',
    status: 'stale',
    datasetCount: 1,
  },
  {
    id: 'rail-scada',
    name: 'Rail SCADA Telemetry',
    source: 'Rail Operations',
    cadence: 'every 4 min',
    lastReceivedAt: '2026-07-22T04:08:00Z',
    status: 'fresh',
    datasetCount: 1,
  },
]
