import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import ConnectMcpPage from './page'

function renderPage(helpUrl: string | null) {
  const config = toClientConfig({
    ...NEUTRAL_CONFIG,
    brand: { ...NEUTRAL_CONFIG.brand, help_url: helpUrl },
  })
  return render(
    <ConfigProvider value={config}>
      <ConnectMcpPage />
    </ConfigProvider>
  )
}

describe('ConnectMcpPage', () => {
  it('documents MCP, references the brand, and shows an endpoint and client config', () => {
    renderPage(null)
    expect(screen.getByRole('heading', { name: 'MCP' })).toBeInTheDocument()
    expect(screen.getAllByText(/Veodyn/).length).toBeGreaterThan(0)
    expect(screen.getByText('Endpoint')).toBeInTheDocument()
    expect(screen.getByText('Example client config')).toBeInTheDocument()
  })

  it('says the endpoint cannot serve anyone yet when no backend is configured', () => {
    // The page used to present a copyable client config with no caveat, for an
    // endpoint that returned 404. It now serves MCP, but only against a real
    // analytics backend, and this is where the user decides to copy the URL.
    renderPage(null)

    expect(screen.getByRole('status')).toHaveTextContent(/no analytics backend configured/i)
  })

  it('shows the client config carrying an API key, which is what the endpoint accepts', () => {
    renderPage(null)

    expect(screen.getByText(/Key <your-veodyn-api-key>/)).toBeInTheDocument()
  })

  it('renders a documentation link only when brand.help_url is set', () => {
    const { unmount } = renderPage('https://docs.example.com')
    expect(screen.getByRole('button', { name: /documentation/i })).toHaveAttribute(
      'href',
      'https://docs.example.com'
    )
    unmount()

    renderPage(null)
    expect(screen.queryByRole('button', { name: /documentation/i })).not.toBeInTheDocument()
  })
})
