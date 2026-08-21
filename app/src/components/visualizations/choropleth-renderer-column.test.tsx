import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/utils'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'

// Same WebGL-free mock as choropleth-renderer.test.tsx, plus the map's own
// props: the fitted viewport is the thing column mode adds, and it is a prop,
// not markup. Hover lives in choropleth-renderer-tooltip.test.tsx.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children, initialViewState }: { children?: React.ReactNode; initialViewState?: unknown }) => (
    <div data-testid="map" data-view={JSON.stringify(initialViewState)}>
      {children}
    </div>
  ),
  Source: ({ data, children }: { data: unknown; children?: React.ReactNode }) => (
    <div data-testid="source" data-features={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Layer: ({ paint }: { paint: unknown }) => <div data-testid="layer" data-paint={JSON.stringify(paint)} />,
  Popup: ({ children }: { children?: React.ReactNode }) => <div data-testid="popup">{children}</div>,
}))

import { ChoroplethRenderer } from './choropleth-renderer'

const geoRequests = vi.fn()

beforeEach(() => {
  geoRequests.mockClear()
  // Registered so a request would succeed rather than surface as an unhandled
  // one: the assertion has to be that nothing asked, not that asking failed.
  server.use(
    http.get('/geo/:file', () => {
      geoRequests()
      return HttpResponse.json({ type: 'FeatureCollection', features: [] })
    })
  )
})

function viz(options: Record<string, unknown>): MockVisualization {
  return { id: 1, type: 'CHOROPLETH', name: 'Choropleth', description: '', options, created_at: '', updated_at: '' }
}

function square(x: number): string {
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [[[x, 0], [x + 2, 0], [x + 2, 2], [x, 2], [x, 0]]],
  })
}

const columns = [
  { name: 'district', friendly_name: 'district', type: 'string' },
  { name: 'trips', friendly_name: 'trips', type: 'integer' },
  { name: 'geom', friendly_name: 'geom', type: 'string' },
]

function result(rows: Record<string, unknown>[]): QueryResultData {
  return { columns, rows } as QueryResultData
}

const COLUMN_MODE = {
  boundarySource: 'column',
  keyColumn: 'district',
  valueColumn: 'trips',
  geometryColumn: 'geom',
}

const twoDistricts = result([
  { district: 'North', trips: 100, geom: square(10) },
  { district: 'South', trips: 10, geom: square(20) },
])

describe('ChoroplethRenderer in geometry-column mode', () => {
  it('draws one region per row with a concrete fill from the palette', async () => {
    renderWithProviders(<ChoroplethRenderer visualization={viz(COLUMN_MODE)} data={twoDistricts} />)

    await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
    const features = JSON.parse(screen.getByTestId('source').getAttribute('data-features') as string)
    expect(features.features).toHaveLength(2)
    const north = features.features.find((f: { properties: { district: string } }) => f.properties.district === 'North')
    expect(north.properties.fillColor).toMatch(/^rgb\(/)
    expect(north.geometry.type).toBe('Polygon')
  })

  // The whole point of the mode: the boundaries are in the result, so there is
  // no bundled asset to fetch and no reason to wait on one.
  it('fetches no map geometry at all', async () => {
    renderWithProviders(<ChoroplethRenderer visualization={viz(COLUMN_MODE)} data={twoDistricts} />)

    await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
    expect(geoRequests).not.toHaveBeenCalled()
  })

  it('never shows the loading state, since nothing is loading', () => {
    renderWithProviders(<ChoroplethRenderer visualization={viz(COLUMN_MODE)} data={twoDistricts} />)

    expect(screen.queryByText(/loading map geometry/i)).not.toBeInTheDocument()
  })

  // A city's districts against the bundled map's fixed zoom 1 would be a speck
  // in the ocean.
  it('opens fitted to the regions rather than on the whole world', async () => {
    renderWithProviders(<ChoroplethRenderer visualization={viz(COLUMN_MODE)} data={twoDistricts} />)

    await waitFor(() => expect(screen.getByTestId('map')).toBeInTheDocument())
    const view = JSON.parse(screen.getByTestId('map').getAttribute('data-view') as string)
    expect(view.longitude).toBe(16)
    expect(view.latitude).toBe(1)
    expect(view.zoom).toBeGreaterThan(1)
  })

  it('says so when no row carried readable geometry, in its own words', async () => {
    renderWithProviders(
      <ChoroplethRenderer
        visualization={viz(COLUMN_MODE)}
        data={result([
          { district: 'North', trips: 100, geom: 'not json' },
          { district: 'South', trips: 10, geom: '' },
        ])}
      />
    )

    await waitFor(() => expect(screen.getByText(/no region geometry could be read/i)).toBeInTheDocument())
    expect(screen.getByText(/"geom"/)).toBeInTheDocument()
    expect(screen.queryByText(/no regions matched the key column/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('map')).not.toBeInTheDocument()
    expect(geoRequests).not.toHaveBeenCalled()
  })

  it('asks for a geometry column when the mode is on and none is picked', () => {
    renderWithProviders(
      <ChoroplethRenderer
        visualization={viz({ boundarySource: 'column', keyColumn: 'district', valueColumn: 'trips' })}
        data={twoDistricts}
      />
    )

    expect(screen.getByText(/needs a geometry column/i)).toBeInTheDocument()
    expect(geoRequests).not.toHaveBeenCalled()
  })

  // Unshaded regions still say where the districts are, which is more than an
  // empty box says. Map mode has no such option: without a join there is
  // nothing to draw but the whole world.
  it('still draws the regions when no row has a usable value', async () => {
    renderWithProviders(
      <ChoroplethRenderer
        visualization={viz(COLUMN_MODE)}
        data={result([{ district: 'North', trips: null, geom: square(10) }])}
      />
    )

    await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
    const features = JSON.parse(screen.getByTestId('source').getAttribute('data-features') as string)
    expect(features.features).toHaveLength(1)
    expect(features.features[0].properties.__value).toBe(null)
  })

  describe('rows it could not read', () => {
    it('notes how many rows were left out when the map still drew', async () => {
      renderWithProviders(
        <ChoroplethRenderer
          visualization={viz(COLUMN_MODE)}
          data={result([
            { district: 'North', trips: 100, geom: square(10) },
            { district: 'South', trips: 10, geom: 'not json' },
            { district: 'East', trips: 5, geom: '' },
            { district: 'West', trips: 1, geom: JSON.stringify({ type: 'Polygon', coordinates: [0, 0] }) },
          ])}
        />
      )

      await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
      expect(screen.getByText(/3 rows had unreadable geometry/i)).toBeInTheDocument()
    })

    it('counts a single skipped row in the singular', async () => {
      renderWithProviders(
        <ChoroplethRenderer
          visualization={viz(COLUMN_MODE)}
          data={result([
            { district: 'North', trips: 100, geom: square(10) },
            { district: 'South', trips: 10, geom: 'not json' },
          ])}
        />
      )

      await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
      expect(screen.getByText(/1 row had unreadable geometry/i)).toBeInTheDocument()
    })

    it('says nothing when every row was readable', async () => {
      renderWithProviders(<ChoroplethRenderer visualization={viz(COLUMN_MODE)} data={twoDistricts} />)

      await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
      expect(screen.queryByText(/unreadable geometry/i)).not.toBeInTheDocument()
    })

    // The all-unreadable case is its own empty state and keeps its own words,
    // rather than a map-less note counting rows.
    it('leaves the all-unreadable empty state alone', async () => {
      renderWithProviders(
        <ChoroplethRenderer
          visualization={viz(COLUMN_MODE)}
          data={result([{ district: 'North', trips: 100, geom: 'not json' }])}
        />
      )

      await waitFor(() => expect(screen.getByText(/no region geometry could be read/i)).toBeInTheDocument())
      expect(screen.queryByText(/rows had unreadable geometry/i)).not.toBeInTheDocument()
    })
  })

  it('still requires the key and value columns', () => {
    renderWithProviders(
      <ChoroplethRenderer
        visualization={viz({ boundarySource: 'column', geometryColumn: 'geom' })}
        data={twoDistricts}
      />
    )

    expect(screen.getByText(/requires key and value columns/i)).toBeInTheDocument()
    expect(geoRequests).not.toHaveBeenCalled()
  })

  describe('map mode', () => {
    const mapOptions = {
      keyColumn: 'district',
      valueColumn: 'trips',
      targetField: 'iso_a2',
      mapType: 'world-countries',
    }

    it('still fetches the bundled asset and still opens on the world view', async () => {
      server.use(
        http.get('/geo/world-countries.geojson', () => {
          geoRequests()
          return HttpResponse.json({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { iso_a2: 'North' },
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
              },
            ],
          })
        })
      )
      renderWithProviders(<ChoroplethRenderer visualization={viz(mapOptions)} data={twoDistricts} />)

      await waitFor(() => expect(screen.getByTestId('map')).toBeInTheDocument())
      expect(geoRequests).toHaveBeenCalled()
      const view = JSON.parse(screen.getByTestId('map').getAttribute('data-view') as string)
      expect(view).toEqual({ latitude: 20, longitude: 0, zoom: 1 })
    })

    it('ignores a geometryColumn left over from a mode switch', async () => {
      server.use(
        http.get('/geo/world-countries.geojson', () =>
          HttpResponse.json({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { iso_a2: 'North' },
                geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
              },
            ],
          })
        )
      )
      renderWithProviders(
        <ChoroplethRenderer visualization={viz({ ...mapOptions, geometryColumn: 'geom' })} data={twoDistricts} />
      )

      await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
      const features = JSON.parse(screen.getByTestId('source').getAttribute('data-features') as string)
      expect(features.features).toHaveLength(1)
      expect(features.features[0].properties.iso_a2).toBe('North')
    })
  })
})
