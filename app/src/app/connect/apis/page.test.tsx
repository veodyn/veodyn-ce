import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import ConnectApisPage from './page'

function renderPage(helpUrl: string | null) {
  const config = toClientConfig({
    ...NEUTRAL_CONFIG,
    brand: { ...NEUTRAL_CONFIG.brand, help_url: helpUrl },
  })
  return render(
    <ConfigProvider value={config}>
      <ConnectApisPage />
    </ConfigProvider>
  )
}

describe('ConnectApisPage', () => {
  it('documents the API, references the brand, and shows example sections', () => {
    renderPage(null)
    expect(screen.getByRole('heading', { name: 'APIs' })).toBeInTheDocument()
    expect(screen.getByText(/Veodyn/)).toBeInTheDocument()
    expect(screen.getByText('Base URL')).toBeInTheDocument()
    expect(screen.getByText('Authentication')).toBeInTheDocument()
    expect(screen.getByText('Example request')).toBeInTheDocument()
  })

  it('uses this instance origin in the examples, not a placeholder', () => {
    const { container } = renderPage(null)
    // After mount the origin replaces the first-paint placeholder, so the
    // copyable examples carry real connection info.
    expect(container.textContent).not.toContain('your-instance.example')
    expect(container.textContent).toContain(window.location.origin)
  })

  // The page used to document `curl --cookie "session=<your-session>"` and say
  // requests authenticate with your signed-in session. There is nowhere in the
  // product to obtain that cookie, while the profile page issues a personal API
  // key and the MCP page next door already pointed at it.
  it('documents the credential the product actually issues, and where to get it', () => {
    const { container } = renderPage(null)

    expect(container.textContent).toContain('Authorization: Key <your-api-key>')
    expect(container.textContent).not.toContain('--cookie')
    expect(container.textContent).not.toContain('<your-session>')
    expect(screen.getByRole('link', { name: 'profile page' })).toHaveAttribute('href', '/profile')
  })

  it('offers a copy button on every string it exists to hand over', () => {
    // They were opacity-0 until hover, so a page whose only job is handing over
    // strings read as offering no way to copy any of them.
    renderPage(null)
    expect(screen.getAllByRole('button', { name: 'Copy code' })).toHaveLength(2)
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
