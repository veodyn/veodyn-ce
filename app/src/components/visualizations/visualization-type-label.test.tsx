import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  PLUGIN_API_VERSION,
  registerVisualization,
  type VisualizationPlugin,
} from '@/lib/visualizations'
import { VisualizationTypeLabel } from './visualization-type-label'

registerVisualization({
  apiVersion: PLUGIN_API_VERSION,
  type: 'TEST_TICKER',
  displayName: 'Ticker',
  icon: () => null,
  defaultOptions: {},
  Renderer: () => null,
} satisfies VisualizationPlugin)

describe('VisualizationTypeLabel', () => {
  it('names a plugin type as one', () => {
    render(<VisualizationTypeLabel type="TEST_TICKER" />)
    expect(screen.getByText('Plugin[Ticker]')).toBeInTheDocument()
  })

  // Marking everything would mark nothing: the point of the convention is that
  // an analyst can tell which entries this deployment added.
  it('leaves a core type named plainly', () => {
    render(<VisualizationTypeLabel type="TABLE" />)
    expect(screen.getByText('Table')).toBeInTheDocument()
    expect(screen.queryByText(/Plugin\[/)).not.toBeInTheDocument()
  })

  // Falls back to the raw type rather than rendering an empty label, and to
  // the same string the renderer prints, so a reader who sees "Unsupported
  // visualization type: X" beside a picker entry sees one name, not two.
  it('falls back to the type name for something nothing registered', () => {
    render(<VisualizationTypeLabel type="NOT_REGISTERED" />)
    expect(screen.getByText('NOT_REGISTERED')).toBeInTheDocument()
  })

  // The icon is decoration beside a name that already says "Plugin", so it is
  // hidden from assistive tech rather than announced twice.
  it('hides the plug icon from screen readers', () => {
    const { container } = render(<VisualizationTypeLabel type="TEST_TICKER" />)
    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })

  it('gives a core type no icon at all', () => {
    const { container } = render(<VisualizationTypeLabel type="TABLE" />)
    expect(container.querySelector('svg')).toBeNull()
  })
})
