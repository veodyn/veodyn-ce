import '@/plugins'
import { registeredVisualizations } from '@veodyn/viz'
import { FEATURES, enabledFeatures } from '@/features'
import type { FeatureDescriptor } from '@/features'
import { config } from '@/lib/config'
import { effectiveMapProviders } from '@/lib/config-maps'
import { toClientConfig, type VeodynConfig } from '@/lib/config-schema'
import { instanceEdition } from '@/lib/edition'
import type { InstanceProfile } from './turn-context'

type Registry = Record<string, FeatureDescriptor>

function optionalSurfaces(source: VeodynConfig): string[] {
  const surfaces: [string, boolean][] = [
    ['query_snippets', source.features.query_snippets],
    ['query_drafts', source.features.query_drafts],
    ['messages', source.messages.enabled],
    ['connectors', source.connectors.enabled],
  ]
  return surfaces.filter(([, on]) => on).map(([name]) => name)
}

export function buildInstanceProfile(source: VeodynConfig, registry: Registry, plugins: string[]): InstanceProfile {
  const installed = enabledFeatures(toClientConfig(source), registry)
  return {
    name: source.brand.name,
    edition: instanceEdition(source.deployment.scale, registry).code,
    features: [...Object.keys(installed).sort(), ...optionalSurfaces(source)],
    plugins,
    maps: effectiveMapProviders(source.map).map(({ id, label }) => ({ id, label })),
  }
}

let memo: InstanceProfile | null = null

export function instanceProfile(): InstanceProfile {
  if (memo) return memo
  const plugins = registeredVisualizations()
    .filter((entry) => entry.origin === 'plugin')
    .map((entry) => entry.plugin.displayName)
  memo = buildInstanceProfile(config, FEATURES, plugins)
  return memo
}
