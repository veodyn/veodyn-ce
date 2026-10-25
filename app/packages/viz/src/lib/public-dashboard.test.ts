import { describe, expect, it } from 'vitest'
import {
  normalizePublicDashboard,
  normalizePublicParameterValues,
  publicDashboardUrl,
  publicDashboardWidgetUrl,
  publicParameterValuesUrl,
} from './public-dashboard'

const UPSTREAM = {
  name: 'Home · traffic map',
  layout: [],
  dashboard_filters_enabled: false,
  updated_at: '2026-10-12T10:00:00Z',
  created_at: '2026-10-01T10:00:00Z',
  options: {},
  widgets: [
    {
      id: 12,
      width: 1,
      options: { position: { col: 3, row: 0, sizeX: 3, sizeY: 8 } },
      text: '',
      updated_at: '2026-10-12T10:00:00Z',
      created_at: '2026-10-01T10:00:00Z',
      visualization: {
        type: 'TABLE',
        name: 'Departures',
        description: 'Next trains',
        options: { publicParameters: { stop: '^[0-9]+$' } },
        updated_at: '2026-10-12T10:00:00Z',
        created_at: '2026-10-01T10:00:00Z',
        query: {
          id: 87,
          name: 'Internal Naming: public stops',
          description: 'internal',
          options: {
            parameters: [
              { name: 'stop', title: 'Stop', type: 'query', queryId: 3, value: '80214' },
              { name: 'agency', title: 'Agency', type: 'enum', enumOptions: 'a\nb', value: 'a' },
              { name: 'note', type: 'text', value: 'x' },
            ],
          },
        },
      },
    },
    {
      id: 11,
      width: 1,
      options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 4 } },
      text: '## Welcome',
      updated_at: '2026-10-12T10:00:00Z',
      created_at: '2026-10-01T10:00:00Z',
    },
  ],
}

describe('normalizePublicDashboard', () => {
  it('keeps layout, text and the visualization config in grid order', () => {
    const payload = normalizePublicDashboard(UPSTREAM)

    expect(payload).toEqual({
      name: 'Home · traffic map',
      widgets: [
        {
          id: 11,
          position: { col: 0, row: 0, sizeX: 3, sizeY: 4 },
          hideTitle: false,
          text: '## Welcome',
          visualization: null,
          parameters: [],
        },
        {
          id: 12,
          position: { col: 3, row: 0, sizeX: 3, sizeY: 8 },
          hideTitle: false,
          text: null,
          visualization: {
            type: 'TABLE',
            name: 'Departures',
            description: 'Next trains',
            options: { publicParameters: { stop: '^[0-9]+$' } },
          },
          parameters: [{ name: 'stop', title: 'Stop', defaultValue: '80214' }],
        },
      ],
    })
  })

  it('passes on nothing about the queries behind the widgets', () => {
    const serialized = JSON.stringify(normalizePublicDashboard(UPSTREAM))

    expect(serialized).not.toContain('87')
    expect(serialized).not.toContain('Internal Naming')
    expect(serialized).not.toContain('internal')
    expect(serialized).not.toContain('queryId')
  })

  it('is idempotent, so the client can normalize the proxy output again', () => {
    const once = normalizePublicDashboard(UPSTREAM)

    expect(normalizePublicDashboard(once)).toEqual(once)
  })

  it('clamps a position to the six-column grid', () => {
    const payload = normalizePublicDashboard({
      widgets: [{ id: 1, text: 'x', options: { position: { col: 5, row: -2, sizeX: 4, sizeY: 0 } } }],
    })

    expect(payload?.widgets[0].position).toEqual({ col: 5, row: 0, sizeX: 1, sizeY: 1 })
  })

  it('honours a hideTitle widget option', () => {
    const payload = normalizePublicDashboard({
      widgets: [{ ...UPSTREAM.widgets[0], options: { ...UPSTREAM.widgets[0].options, hideTitle: true } }],
    })

    expect(payload?.widgets[0].hideTitle).toBe(true)
  })

  it.each([['a bare string', 'gone'], ['no widget list', { name: 'x' }], ['null', null]])(
    'refuses %s',
    (_label, raw) => {
      expect(normalizePublicDashboard(raw)).toBeNull()
    }
  )

  it('drops widgets without a numeric id', () => {
    expect(normalizePublicDashboard({ widgets: [{ text: 'x' }] })?.widgets).toEqual([])
  })
})

describe('normalizePublicParameterValues', () => {
  it('keeps name and value as strings', () => {
    expect(
      normalizePublicParameterValues({ values: [{ name: 'Central Station', value: 80214 }, { value: 'b' }], truncated: true })
    ).toEqual({ values: [{ name: 'Central Station', value: '80214' }, { name: 'b', value: 'b' }], truncated: true })
  })

  it('refuses a body without a value list', () => {
    expect(normalizePublicParameterValues({})).toBeNull()
  })
})

describe('public dashboard addresses', () => {
  it('build same-origin proxy paths with the token encoded', () => {
    expect(publicDashboardUrl('https://v.test/', 'a b')).toBe('https://v.test/api/public/dashboards/a%20b')
    expect(publicDashboardWidgetUrl('https://v.test', 't', 12)).toBe('https://v.test/api/public/dashboards/t/widgets/12')
    expect(publicParameterValuesUrl('https://v.test', 't', 12, 'stop', 'Union St')).toBe(
      'https://v.test/api/public/dashboards/t/widgets/12/parameters/stop/values?q=Union%20St'
    )
    expect(publicParameterValuesUrl('https://v.test', 't', 12, 'stop')).toBe(
      'https://v.test/api/public/dashboards/t/widgets/12/parameters/stop/values'
    )
  })
})
