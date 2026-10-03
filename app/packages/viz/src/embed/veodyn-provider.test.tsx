import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useThemeScope } from '../components/theme/theme-scope'
import { PLUGIN_API_VERSION, type VisualizationPlugin } from '../lib/visualizations/plugin'
import { getVisualization } from '../lib/visualizations/registry'
import { useVizEnvironment } from '../lib/viz-environment'
import { useVizFormats } from '../lib/viz-formats'
import { VeodynProvider } from './veodyn-provider'

function plugin(type: string): VisualizationPlugin {
  return { apiVersion: PLUGIN_API_VERSION, type, displayName: type, icon: () => null, defaultOptions: {}, Renderer: () => null }
}

function Probe() {
  const environment = useVizEnvironment()
  const formats = useVizFormats()
  return (
    <dl>
      <dt>theme</dt>
      <dd>{useThemeScope()}</dd>
      <dt>assets</dt>
      <dd>{environment.assetsUrl}</dd>
      <dt>root</dt>
      <dd>{environment.root?.className ?? 'none'}</dd>
      <dt>portal container</dt>
      <dd>{environment.portalContainer?.dataset.veodynPart ?? 'none'}</dd>
      <dt>date</dt>
      <dd>{formats.dateFormat}</dd>
    </dl>
  )
}

describe('VeodynProvider', () => {
  it('registers its plugins before its children first render', () => {
    const plugins = [plugin('TEST_VP_SYNC')]
    function Child() {
      return <p>{getVisualization('TEST_VP_SYNC') ? 'registered' : 'missing'}</p>
    }

    render(
      <VeodynProvider baseUrl="https://veodyn.test" plugins={plugins}>
        <Child />
      </VeodynProvider>
    )

    expect(screen.getByText('registered')).toBeInTheDocument()
  })

  it('lets two providers on one page share a plugin list', () => {
    const plugins = [plugin('TEST_VP_SHARED')]

    expect(() =>
      render(
        <>
          <VeodynProvider baseUrl="https://a.test" plugins={plugins}>
            <p>a</p>
          </VeodynProvider>
          <VeodynProvider baseUrl="https://b.test" plugins={plugins}>
            <p>b</p>
          </VeodynProvider>
        </>
      )
    ).not.toThrow()
  })

  it('survives a rerender with a plugin list built inline', () => {
    const shared = plugin('TEST_VP_INLINE')
    const { rerender } = render(
      <VeodynProvider baseUrl="https://veodyn.test" plugins={[shared]}>
        <p>first</p>
      </VeodynProvider>
    )

    expect(() =>
      rerender(
        <VeodynProvider baseUrl="https://veodyn.test" plugins={[shared]}>
          <p>second</p>
        </VeodynProvider>
      )
    ).not.toThrow()
  })

  it('renders a scoped root carrying the theme it was given', () => {
    const { container } = render(
      <VeodynProvider baseUrl="https://veodyn.test" theme="dark">
        <p>child</p>
      </VeodynProvider>
    )

    const root = container.querySelector('.veodyn')
    expect(root).toHaveAttribute('data-theme', 'dark')
    expect(root).toContainElement(screen.getByText('child'))
  })

  it('supplies the theme, the environment and the formats to visualizations', () => {
    render(
      <VeodynProvider baseUrl="https://veodyn.test" theme="dark" formats={{ dateFormat: 'DD.MM.YYYY' }}>
        <Probe />
      </VeodynProvider>
    )

    expect(screen.getByText('theme').nextSibling).toHaveTextContent('dark')
    expect(screen.getByText('assets').nextSibling).toHaveTextContent('https://veodyn.test')
    expect(screen.getByText('root').nextSibling).toHaveTextContent('veodyn')
    expect(screen.getByText('portal container').nextSibling).toHaveTextContent('portal')
    expect(screen.getByText('date').nextSibling).toHaveTextContent('DD.MM.YYYY')
  })

  it('fetches assets from a separate origin when told to', () => {
    render(
      <VeodynProvider baseUrl="https://veodyn.test" assetsUrl="https://cdn.veodyn.test">
        <Probe />
      </VeodynProvider>
    )

    expect(screen.getByText('assets').nextSibling).toHaveTextContent('https://cdn.veodyn.test')
  })

  it('defaults to the light theme', () => {
    render(
      <VeodynProvider baseUrl="https://veodyn.test">
        <Probe />
      </VeodynProvider>
    )

    expect(screen.getByText('theme').nextSibling).toHaveTextContent('light')
  })
})
