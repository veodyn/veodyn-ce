import type { MockDashboard } from '../types/dashboard-types'
import { vizGalleryWidgetsC } from './viz-fixtures-c'
import { vizGalleryWidgetsD } from './viz-fixtures-d'
import { vizGalleryWidgetsE } from './viz-fixtures-e'
import { vizGalleryWidgetsF } from './viz-fixtures-f'

export const mockDashboards: MockDashboard[] = [
  {
    id: 1,
    name: 'Transportation Overview',
    slug: 'transportation-overview',
    tags: ['executive', 'kpi', 'real-time'],
    is_archived: false,
    is_draft: false,
    is_favorite: true,
    can_edit: true,
    user: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    widgets: [
      {
        id: 1,
        dashboard_id: 1,
        visualization: { id: 2, query: { id: 1 }, type: 'CHART', name: 'Ridership Trend', description: '', options: { globalSeriesType: 'line', columnMapping: { date: 'x', vehicle_count: 'y', line: 'series' } } },
        width: 1,
        options: { position: { col: 0, row: 0, sizeX: 4, sizeY: 8 } },
      },
      {
        id: 2,
        dashboard_id: 1,
        visualization: { id: 10, query: { id: 5 }, type: 'COUNTER', name: 'Total Vehicles', description: '', options: { counterLabel: 'Active Fleet Vehicles', counterColName: 'total_vehicles', rowNumber: 1 } },
        width: 1,
        options: { position: { col: 4, row: 0, sizeX: 2, sizeY: 5 } },
      },
      {
        id: 3,
        dashboard_id: 1,
        visualization: { id: 4, query: { id: 2 }, type: 'CHART', name: 'AQI Trend', description: '', options: { globalSeriesType: 'area', columnMapping: { hour: 'x', avg_aqi: 'y', station: 'series' } } },
        width: 1,
        options: { position: { col: 0, row: 8, sizeX: 3, sizeY: 8 } },
      },
      {
        id: 4,
        dashboard_id: 1,
        visualization: { id: 7, query: { id: 4 }, type: 'CHART', name: 'Incidents by Day', description: '', options: { globalSeriesType: 'bar', columnMapping: { date: 'x', incident_count: 'y', category: 'series' }, stacking: 'stack' } },
        width: 1,
        options: { position: { col: 3, row: 8, sizeX: 3, sizeY: 8 } },
      },
      {
        id: 5,
        dashboard_id: 1,
        text: '## Regional Transportation\n\nReal-time overview of the rail network, fleet vehicles, air quality, and traffic incidents across the regional transportation network.\n\n*Data from the analytics warehouse (historical store).*',
        width: 1,
        options: { position: { col: 4, row: 5, sizeX: 2, sizeY: 3 } },
      },
    ],
    dashboard_filters_enabled: true,
    created_at: '2024-08-01T10:00:00Z',
    updated_at: '2026-03-15T14:00:00Z',
    public_url: null,
    api_key: null,
  },
  {
    id: 2,
    name: 'Bike Share Analytics',
    slug: 'bike-share-analytics',
    tags: ['bike-share', 'mobility'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    can_edit: true,
    user: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    widgets: [
      {
        id: 6,
        dashboard_id: 2,
        visualization: { id: 16, query: { id: 3 }, type: 'MAP', name: 'Station Map', description: '', options: { latColName: 'lat', lonColName: 'lon', popup: { enabled: true, template: '{{ station_name }}' } } },
        width: 1,
        options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 10 } },
      },
      {
        id: 7,
        dashboard_id: 2,
        visualization: { id: 5, query: { id: 3 }, type: 'TABLE', name: 'Table', description: '', options: {} },
        width: 1,
        options: { position: { col: 3, row: 0, sizeX: 3, sizeY: 10 } },
      },
      {
        id: 8,
        dashboard_id: 2,
        visualization: { id: 17, query: { id: 6 }, type: 'CHART', name: 'Daily Trip Trend', description: '', options: { globalSeriesType: 'bar', columnMapping: { date: 'x', daily_trips: 'y' } } },
        width: 1,
        options: { position: { col: 0, row: 10, sizeX: 6, sizeY: 8 } },
      },
    ],
    dashboard_filters_enabled: false,
    created_at: '2025-02-15T09:00:00Z',
    updated_at: '2026-03-12T11:00:00Z',
    public_url: null,
    api_key: null,
  },
  {
    id: 3,
    name: 'Weather & Environment',
    slug: 'weather-environment',
    tags: ['weather', 'air-quality', 'environment'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    can_edit: true,
    user: { id: 3, name: 'Bob Developer', email: 'bob@example.com' },
    widgets: [
      {
        id: 9,
        dashboard_id: 3,
        visualization: { id: 18, query: { id: 8 }, type: 'CHART', name: 'Temperature Chart', description: '', options: { globalSeriesType: 'line', columnMapping: { hour: 'x', temp_f: 'y', humidity: 'yRight' } } },
        width: 1,
        options: { position: { col: 0, row: 0, sizeX: 6, sizeY: 8 } },
      },
      // Widget ids 70 and 71 rather than the next integer: these ids are
      // per-pack and already crowded, and a collision makes find(w => w.id === n)
      // return the wrong widget. These were 50 and 51 and hit exactly that on the
      // way in: a branch developed in parallel had put its parameterised fixture
      // on widget 50 of this same dashboard, and dashboard-parameters.fixture
      // then found this chart instead and read no parameters off it. Leaving a
      // gap is not enough when two branches leave the same gap. Placed on
      // dashboard 3, not dashboard 1, because three tests assert dashboard 1's
      // slide count in the wall/present deck.
      {
        id: 70,
        dashboard_id: 3,
        visualization: { id: 50, query: { id: 8 }, type: 'CHART', name: 'Temperature (node column chart)', description: '', options: { globalSeriesType: 'column', columnMapping: { hour: 'x', temp_f: 'y' } } },
        width: 1,
        options: { position: { col: 0, row: 8, sizeX: 3, sizeY: 8 } },
      },
      {
        id: 71,
        dashboard_id: 3,
        visualization: { id: 51, query: { id: 8 }, type: 'CHART', name: 'Humidity bars over temperature line', description: '', options: { globalSeriesType: 'line', columnMapping: { hour: 'x', temp_f: 'y', humidity: 'y' }, seriesOptions: { humidity: { type: 'column' }, temp_f: { type: 'line' } } } },
        width: 1,
        options: { position: { col: 3, row: 8, sizeX: 3, sizeY: 8 } },
      },
      {
        id: 10,
        dashboard_id: 3,
        visualization: { id: 3, query: { id: 2 }, type: 'TABLE', name: 'Table', description: '', options: {} },
        width: 1,
        options: { position: { col: 0, row: 16, sizeX: 6, sizeY: 10 } },
      },
      // The only fixture with dashboard parameters, mirrored in packs/la. See
      // that file for why it lives on this dashboard rather than dashboard 1.
      {
        id: 50,
        dashboard_id: 3,
        visualization: {
          id: 13,
          query: {
            id: 8,
            name: 'Weather & Temperature History',
            latest_query_data_id: 108,
            options: {
              parameters: [
                { name: 'days', title: 'Last N Days', type: 'number', value: 7 },
                { name: 'window', title: 'Service window', type: 'date-range', value: 'd_last_30_days' },
                {
                  name: 'statuses',
                  title: 'Statuses',
                  type: 'enum',
                  value: ['Open'],
                  enumOptions: 'Open\nClosed\nPending',
                  multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' },
                },
              ],
            },
          },
          type: 'TABLE',
          name: 'Weather',
          description: '',
          options: {},
        },
        width: 1,
        options: {
          position: { col: 0, row: 18, sizeX: 6, sizeY: 8 },
          parameterMappings: {
            days: { type: 'dashboard-add-new', mapTo: 'days', title: 'Last N Days' },
            statuses: { type: 'dashboard-add-new', mapTo: 'statuses', title: 'Statuses' },
            window: { type: 'widget-level' },
          },
        },
      },
    ],
    dashboard_filters_enabled: false,
    created_at: '2025-09-10T14:00:00Z',
    updated_at: '2026-02-20T16:00:00Z',
    public_url: null,
    api_key: null,
  },
  // Archived, so the Archive tab and its Restore action are walkable without a
  // backend. Every other listing filters this row out, which is the point.
  {
    id: 4,
    name: 'Retired Fleet Report',
    slug: 'retired-fleet-report',
    tags: ['fleet'],
    is_archived: true,
    is_draft: false,
    is_favorite: false,
    can_edit: true,
    user: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    widgets: [],
    dashboard_filters_enabled: false,
    created_at: '2024-05-02T09:00:00Z',
    updated_at: '2025-11-18T12:00:00Z',
    public_url: null,
    api_key: null,
  },
  // One widget per visualization type that had no fixture at all, so every
  // type can be seen rendering side by side without a backend. Its own
  // dashboard rather than an existing one: dashboard 1 is the wall/present
  // deck and three tests assert its slide count, and the other two are
  // subject-matter dashboards a gallery does not belong on.
  {
    id: 5,
    name: 'Visualization Gallery',
    slug: 'visualization-gallery',
    tags: ['reference'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    can_edit: true,
    user: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    widgets: [
      ...vizGalleryWidgetsC,
      ...vizGalleryWidgetsD,
      ...vizGalleryWidgetsE,
      ...vizGalleryWidgetsF,
    ],
    dashboard_filters_enabled: false,
    created_at: '2026-07-31T09:00:00Z',
    updated_at: '2026-07-31T09:00:00Z',
    public_url: null,
    api_key: null,
  },
]
