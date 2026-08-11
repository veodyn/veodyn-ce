// The example package's own test.
//
// The mechanism (registration, the import boundary) is tested elsewhere:
// index.test.ts and plugin-boundary.test.ts. This file proves the plugin
// itself is real: it registers into the shared registry with origin
// 'plugin', and it actually mounts.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { registerVisualization, registeredVisualizations } from '@/lib/visualizations'
import { HELLO_PANEL_TYPE, helloPanelPlugin } from './hello-panel'

// Same reason a tenant package's own panel test does it: registration is per
// module graph, and this graph is the one under test.
registerVisualization(helloPanelPlugin)

function viz(): MockVisualization {
  return {
    id: 1,
    type: HELLO_PANEL_TYPE,
    name: 'Hello',
    description: '',
    options: {},
    created_at: '',
    updated_at: '',
  }
}

const NO_ROWS: QueryResultData = { columns: [], rows: [] }

describe('helloPanelPlugin', () => {
  it('registers with origin plugin, not core', () => {
    const entry = registeredVisualizations().find((e) => e.plugin.type === HELLO_PANEL_TYPE)
    expect(entry?.origin).toBe('plugin')
  })

  it('renders its panel', () => {
    const Renderer = helloPanelPlugin.Renderer
    render(<Renderer visualization={viz()} data={NO_ROWS} />)
    expect(screen.getByText('Hello Panel')).toBeInTheDocument()
  })
})
