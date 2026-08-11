import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConfigProvider, useConfig } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'

function BrandName() {
  return <span>{useConfig().brand.name}</span>
}

describe('ConfigProvider', () => {
  it('exposes the provided config to children via useConfig', () => {
    const value = toClientConfig({ ...NEUTRAL_CONFIG, brand: { ...NEUTRAL_CONFIG.brand, name: 'RegionHub' } })
    render(
      <ConfigProvider value={value}>
        <BrandName />
      </ConfigProvider>
    )
    expect(screen.getByText('RegionHub')).toBeInTheDocument()
  })

  it('throws when useConfig is used outside a provider', () => {
    expect(() => render(<BrandName />)).toThrow(/ConfigProvider/)
  })
})
