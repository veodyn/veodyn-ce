import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders } from '@/test/utils'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'

// The hover handlers and the interactive layer list are props on Map, not
// markup, so the mock captures them for the tests to drive.
const captured = vi.hoisted(() => ({ map: {} as Record<string, unknown> }))

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: { children?: React.ReactNode }) => {
    captured.map = props as Record<string, unknown>
    return <div data-testid="map">{props.children}</div>
  },
  Source: ({ data, children }: { data: unknown; children?: React.ReactNode }) => (
    <div data-testid="source" data-features={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Layer: ({ id }: { id?: string }) => <div data-testid="layer" data-id={id} />,
  Popup: ({ children, longitude, latitude }: { children?: React.ReactNode; longitude?: number; latitude?: number }) => (
    <div data-testid="popup" data-lng={longitude} data-lat={latitude}>
      {children}
    </div>
  ),
}))

import { ChoroplethRenderer } from './choropleth-renderer'

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

function renderedFeatures(): { properties: Record<string, unknown> }[] {
  return JSON.parse(screen.getByTestId('source').getAttribute('data-features') as string).features
}

// Drives the handler the real map calls on pointer move. There is no MapLibre
// here to hit-test, so the feature under the cursor is supplied the way MapLibre
// supplies it: already picked, on event.features.
function hoverFeature(feature: unknown, lng = 11, lat = 1) {
  const onMouseMove = captured.map.onMouseMove as (event: unknown) => void
  act(() => onMouseMove({ features: feature ? [feature] : [], lngLat: { lng, lat } }))
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

async function renderColumnMode(data: QueryResultData = twoDistricts) {
  renderWithProviders(<ChoroplethRenderer visualization={viz(COLUMN_MODE)} data={data} />)
  await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
}

// keyColumn is meant to label a region, and until this tooltip existed it
// labelled nothing: the key sat in the feature properties and no component read
// it.
describe('ChoroplethRenderer hover tooltip', () => {
  it('shows nothing until something is hovered', async () => {
    await renderColumnMode()
    expect(screen.queryByTestId('popup')).not.toBeInTheDocument()
  })

  it('names the region and its value under the cursor', async () => {
    await renderColumnMode()

    hoverFeature(renderedFeatures().find((f) => f.properties.district === 'North'))

    expect(screen.getByTestId('popup')).toHaveTextContent('North: 100')
  })

  it('places the popup where the cursor is', async () => {
    await renderColumnMode()

    hoverFeature(renderedFeatures()[0], 21, 1.5)

    expect(screen.getByTestId('popup')).toHaveAttribute('data-lng', '21')
    expect(screen.getByTestId('popup')).toHaveAttribute('data-lat', '1.5')
  })

  it('says a region has no value rather than showing an empty tooltip', async () => {
    await renderColumnMode(result([{ district: 'North', trips: null, geom: square(10) }]))

    hoverFeature(renderedFeatures()[0])

    expect(screen.getByTestId('popup')).toHaveTextContent('North: no value')
  })

  it('drops the popup when the cursor moves off every region', async () => {
    await renderColumnMode()

    hoverFeature(renderedFeatures()[0])
    expect(screen.getByTestId('popup')).toBeInTheDocument()

    hoverFeature(null)
    expect(screen.queryByTestId('popup')).not.toBeInTheDocument()
  })

  it('drops the popup when the cursor leaves the map', async () => {
    await renderColumnMode()

    hoverFeature(renderedFeatures()[0])
    const onMouseLeave = captured.map.onMouseLeave as () => void
    act(() => onMouseLeave())

    expect(screen.queryByTestId('popup')).not.toBeInTheDocument()
  })

  // Without the fill layer named as interactive, MapLibre hit-tests nothing and
  // event.features is always empty, so the handler above never fires in a real
  // map however correct it is.
  it('marks the fill layer as the one to hit-test', async () => {
    await renderColumnMode()

    expect(captured.map.interactiveLayerIds).toEqual(['choropleth-fills'])
    expect(screen.getByTestId('layer')).toHaveAttribute('data-id', 'choropleth-fills')
  })

  // A region name is a value out of the query result. It reaches the DOM as a
  // React text child, so nothing interprets it.
  it('renders a region name containing markup as text', async () => {
    await renderColumnMode(result([{ district: '<b>North</b>', trips: 5, geom: square(10) }]))

    hoverFeature(renderedFeatures()[0])

    const popup = screen.getByTestId('popup')
    expect(popup).toHaveTextContent('<b>North</b>: 5')
    expect(popup.querySelector('b')).toBeNull()
  })

  // Same code path, same tooltip: the bundled map gains the label it never had,
  // taken from the property the join matched on.
  describe('on the bundled map', () => {
    const mapOptions = {
      keyColumn: 'district',
      valueColumn: 'trips',
      targetField: 'iso_a2',
      mapType: 'world-countries',
    }

    async function renderMapMode() {
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
              {
                type: 'Feature',
                properties: { iso_a2: 'Nowhere' },
                geometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 1], [2, 0]]] },
              },
            ],
          })
        )
      )
      renderWithProviders(<ChoroplethRenderer visualization={viz(mapOptions)} data={twoDistricts} />)
      await waitFor(() => expect(screen.getByTestId('source')).toBeInTheDocument())
    }

    it('names the matched region and its value', async () => {
      await renderMapMode()

      hoverFeature(renderedFeatures().find((f) => f.properties.iso_a2 === 'North'))

      expect(screen.getByTestId('popup')).toHaveTextContent('North: 100')
    })

    it('names an unmatched region and says it has no value', async () => {
      await renderMapMode()

      hoverFeature(renderedFeatures().find((f) => f.properties.iso_a2 === 'Nowhere'))

      expect(screen.getByTestId('popup')).toHaveTextContent('Nowhere: no value')
    })

    it('hit-tests the same fill layer', async () => {
      await renderMapMode()

      expect(captured.map.interactiveLayerIds).toEqual(['choropleth-fills'])
    })
  })
})
