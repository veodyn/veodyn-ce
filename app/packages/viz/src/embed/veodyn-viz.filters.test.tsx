import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { PLUGIN_API_VERSION, type VisualizationPlugin, type VisualizationRendererProps } from '../lib/visualizations/plugin'
import { VeodynProvider } from './veodyn-provider'
import { VeodynViz } from './veodyn-viz'

const BASE = 'https://veodyn.test'

function Roadways({ data }: VisualizationRendererProps) {
  return <p>{`roads: ${data.rows.map((row) => String(row.text)).join(',')}`}</p>
}

const PLUGINS: VisualizationPlugin[] = [
  { apiVersion: PLUGIN_API_VERSION, type: 'TEST_VF_ROWS', displayName: 'Rows', icon: () => null, defaultOptions: {}, Renderer: Roadways },
]

const BODY = {
  visualization: { type: 'TEST_VF_ROWS', name: 'Alerts', description: '', options: {} },
  data: {
    columns: [
      { name: 'County::filter', friendly_name: 'County::filter', type: 'string' },
      { name: 'text', friendly_name: 'text', type: 'string' },
    ],
    rows: [
      { 'County::filter': 'Northfield', text: 'I-5 crash' },
      { 'County::filter': 'Orange', text: 'SR-55 roadwork' },
      { 'County::filter': 'Northfield', text: 'I-110 closure' },
    ],
  },
}

describe('VeodynViz result filters', () => {
  it('draws a control for a ::filter column and narrows the rows it renders', async () => {
    server.use(http.get(`${BASE}/api/public/dashboards/d/widgets/4`, () => HttpResponse.json(BODY)))

    render(
      <VeodynProvider baseUrl={BASE} plugins={PLUGINS}>
        <VeodynViz dashboardToken="d" widgetId={4} />
      </VeodynProvider>
    )

    expect(await screen.findByText('roads: I-5 crash,SR-55 roadwork,I-110 closure')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('County'), { target: { value: 'Northfield' } })
    expect(screen.getByText('roads: I-5 crash,I-110 closure')).toBeInTheDocument()
  })

  it('draws no control when the host turns filters off', async () => {
    server.use(http.get(`${BASE}/api/public/visualizations/t`, () => HttpResponse.json(BODY)))

    render(
      <VeodynProvider baseUrl={BASE} plugins={PLUGINS}>
        <VeodynViz token="t" filters={false} />
      </VeodynProvider>
    )

    await screen.findByText('roads: I-5 crash,SR-55 roadwork,I-110 closure')
    expect(screen.queryByLabelText('County')).toBeNull()
  })
})
