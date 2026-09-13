import { FEATURES, featureList, type FeatureDescriptor } from '@/features'

export type DeploymentScale = 'node' | 'hub'

export type EditionCode = 'CE' | 'EE' | 'HUB'

export interface Edition {
  code: EditionCode
  label: string
}

const COMMUNITY: Edition = { code: 'CE', label: 'Community Edition' }
const ENTERPRISE: Edition = { code: 'EE', label: 'Enterprise Edition' }
const HUB: Edition = { code: 'HUB', label: 'Enterprise Hub' }

function installsEnterprise(registry: Record<string, FeatureDescriptor>): boolean {
  return featureList(registry).length > 0
}

export function instanceEdition(
  scale: DeploymentScale,
  registry: Record<string, FeatureDescriptor> = FEATURES
): Edition {
  if (!installsEnterprise(registry)) return COMMUNITY
  return scale === 'hub' ? HUB : ENTERPRISE
}

export function warnOnHubWithoutEnterprise(
  scale: DeploymentScale,
  registry: Record<string, FeatureDescriptor> = FEATURES
): void {
  if (scale !== 'hub' || installsEnterprise(registry)) return
  console.warn(
    '[config] deployment.scale is "hub" but this build installs no enterprise features, so the edition badge reads CE. There is no community hub.'
  )
}
