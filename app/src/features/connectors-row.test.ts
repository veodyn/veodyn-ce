import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Radio } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { NEUTRAL_CONFIG, toClientConfig, type ClientConfig } from '@/lib/config-schema'
import { buildSidebarSections, type SidebarModelInput } from '@/lib/sidebar-nav'
import { enabledFeatures, featureNavRows, type FeatureDescriptor } from './index'

const CONFIG = toClientConfig(NEUTRAL_CONFIG)

function withConnectors(enabled: boolean): ClientConfig {
  return { ...CONFIG, connectors: { enabled } }
}

const REGISTRY: Record<string, FeatureDescriptor> = {
  connectors: {
    id: 'connectors',
    enabled: (config) => config.connectors.enabled,
    nav: [{ label: 'Connectors', href: '/connectors', icon: Radio, section: 'admin' }],
    routes: [],
  },
}

const ADMIN: SidebarModelInput = {
  domains: [],
  canAccessAdmin: true,
  canViewInstanceAdmin: false,
  features: CONFIG.features,
}

function adminHrefs(config: ClientConfig, input: SidebarModelInput = ADMIN): string[] | undefined {
  const registry = enabledFeatures(config, REGISTRY)
  const sections = buildSidebarSections(input, (section) => featureNavRows(section, registry))
  return sections.find((s) => s.id === 'admin')?.items.map((i) => i.href)
}

describe('the Admin Connectors row', () => {
  it('rides the descriptor switch phase 10 added rather than a flag of its own', () => {
    expect(adminHrefs(withConnectors(true))).toContain('/connectors')
    expect(adminHrefs(withConnectors(false))).not.toContain('/connectors')
  })

  it('sits with the org-scoped admin rows, after Team and before Plugins', () => {
    expect(adminHrefs(withConnectors(true))).toEqual([
      '/data-sources',
      '/destinations',
      '/users',
      '/connectors',
      '/admin/plugins',
      '/settings',
    ])
  })

  it('is absent for a member who cannot reach Admin at all, switch on or off', () => {
    const member = { ...ADMIN, canAccessAdmin: false }
    expect(adminHrefs(withConnectors(true), member)).toBeUndefined()
  })

  it('leads to a route that exists', () => {
    expect(existsSync(join(process.cwd(), 'src', 'app', 'connectors', 'page.tsx'))).toBe(true)
  })

  it('is contributed by no package a stock community build installs', () => {
    expect(featureNavRows('admin').map((row) => row.href)).not.toContain('/connectors')
  })
})
