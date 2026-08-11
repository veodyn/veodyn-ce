import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/utils'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'

// react-map-gl needs WebGL. Mock it to render children into inspectable nodes
// and expose the props each subcomponent received.
vi.mock('react-map-gl/maplibre', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  Source: ({ data, children }: { data: unknown; children?: React.ReactNode }) => (
    <div data-testid="source" data-features={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Layer: ({ paint }: { paint: unknown }) => <div data-testid="layer" data-paint={JSON.stringify(paint)} />,
}))

import { ChoroplethRenderer } from './choropleth-renderer'

const geojson = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { iso_a2: 'US' }, geometry: { type: 'Polygon', coordinates: [] } },
    { type: 'Feature', properties: { iso_a2: 'CA' }, geometry: { type: 'Polygon', coordinates: [] } },
  ],
}

const noMatchGeojson = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { iso_a2: 'MX' }, geometry: { type: 'Polygon', coordinates: [] } }],
}

function viz(options: Record<string, unknown>): MockVisualization {
  return { id: 1, type: 'CHOROPLETH', name: 'Choropleth', description: '', options, created_at: '', updated_at: '' }
}

const data: QueryResultData = {
  columns: [
    { name: 'code', friendly_name: 'code', type: 'string' },
    { name: 'v', friendly_name: 'v', type: 'integer' },
  ],
  rows: [
    { code: 'US', v: 100 },
    { code: 'CA', v: 10 },
  ],
}

describe('ChoroplethRenderer', () => {
  it('degrades to a muted message when key/value columns are unset', () => {
    // No geojson MSW handler is registered here on purpose: with the columns
    // unset the renderer gates useVizGeoJson off (enabled: false), so no fetch
    // fires and MSW's onUnhandledRequest guard stays quiet.
    renderWithProviders(<ChoroplethRenderer visualization={viz({})} data={data} />)
    expect(screen.getByText(/requires key and value columns/i)).toBeInTheDocument()
  })

  it('paints matched regions with concrete rgb colors from the palette', async () => {
    server.use(http.get('/geo/world-countries.geojson', () => HttpResponse.json(geojson)))
    renderWithProviders(
      <ChoroplethRenderer
        visualization={viz({ keyColumn: 'code', valueColumn: 'v', targetField: 'iso_a2', mapType: 'world-countries' })}
        data={data}
      />
    )
    await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
    const features = JSON.parse(screen.getByTestId('source').getAttribute('data-features') as string)
    const us = features.features.find((f: { properties: { iso_a2: string } }) => f.properties.iso_a2 === 'US')
    expect(us.properties.fillColor).toMatch(/^rgb\(/)
    const paint = JSON.parse(screen.getByTestId('layer').getAttribute('data-paint') as string)
    expect(paint['fill-color']).toEqual(['get', 'fillColor'])
  })

  it('shows a loading state while the geojson geometry is fetching', async () => {
    server.use(
      http.get('/geo/world-countries.geojson', async () => {
        await delay(20)
        return HttpResponse.json(geojson)
      })
    )
    renderWithProviders(
      <ChoroplethRenderer
        visualization={viz({ keyColumn: 'code', valueColumn: 'v', targetField: 'iso_a2', mapType: 'world-countries' })}
        data={data}
      />
    )
    expect(screen.getByText(/loading map geometry/i)).toBeInTheDocument()
    expect(screen.queryByTestId('source')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
  })

  it('shows an error state, never the map, when the geojson fetch fails', async () => {
    server.use(http.get('/geo/world-countries.geojson', () => new HttpResponse(null, { status: 500 })))
    renderWithProviders(
      <ChoroplethRenderer
        visualization={viz({ keyColumn: 'code', valueColumn: 'v', targetField: 'iso_a2', mapType: 'world-countries' })}
        data={data}
      />
    )
    await waitFor(() => expect(screen.getByText(/map geometry is unavailable/i)).toBeInTheDocument())
    expect(screen.queryByTestId('map')).not.toBeInTheDocument()
  })

  it('renders the no-data state, not the map, when nothing joins (matchedCount is 0)', async () => {
    server.use(http.get('/geo/world-countries.geojson', () => HttpResponse.json(noMatchGeojson)))
    renderWithProviders(
      <ChoroplethRenderer
        visualization={viz({ keyColumn: 'code', valueColumn: 'v', targetField: 'iso_a2', mapType: 'world-countries' })}
        data={data}
      />
    )
    await waitFor(() => expect(screen.getByText(/no regions matched/i)).toBeInTheDocument())
    expect(screen.queryByTestId('map')).not.toBeInTheDocument()
  })

  describe('theme change repaints the fills', () => {
    afterEach(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.style.removeProperty('--card')
      document.documentElement.style.removeProperty('--chart-1')
    })

    function usFill(): string {
      const features = JSON.parse(screen.getByTestId('source').getAttribute('data-features') as string)
      const us = features.features.find((f: { properties: { iso_a2: string } }) => f.properties.iso_a2 === 'US')
      return us.properties.fillColor as string
    }

    it('repaints matched regions when the documentElement theme class flips, with no data or option change', async () => {
      // At value 100 (the max of this series), getSequentialScaleHex's OKLab mix
      // lands at t=1, which round-trips a hex color back to itself exactly (see
      // chart-colors.ts). That lets this test pin an exact rgb() string for each
      // theme rather than only asserting the two states differ.
      document.documentElement.style.setProperty('--card', '#FFFFFF')
      document.documentElement.style.setProperty('--chart-1', '#112233')

      server.use(http.get('/geo/world-countries.geojson', () => HttpResponse.json(geojson)))
      renderWithProviders(
        <ChoroplethRenderer
          visualization={viz({ keyColumn: 'code', valueColumn: 'v', targetField: 'iso_a2', mapType: 'world-countries' })}
          data={data}
        />
      )
      await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
      expect(usFill()).toBe('rgb(17, 34, 51)')

      // Flip the theme the way authenticated-layout.tsx does it: the class on
      // document.documentElement, not the React theme context. Change the token
      // values alongside it, standing in for the stylesheet rule a real .dark
      // class would otherwise apply.
      document.documentElement.style.setProperty('--card', '#000000')
      document.documentElement.style.setProperty('--chart-1', '#AABBCC')
      document.documentElement.classList.add('dark')

      await waitFor(() => expect(usFill()).toBe('rgb(170, 187, 204)'))
    })
  })
})
