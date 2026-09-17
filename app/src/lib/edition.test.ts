import { afterEach, describe, expect, it, vi } from 'vitest'
import { instanceEdition, warnOnHubWithoutEnterprise } from '@/lib/edition'
import { FEATURES, featureList, type FeatureDescriptor } from '@/features'

const enterprise = { kpis: { id: 'kpis' } as FeatureDescriptor }
const community = {}

afterEach(() => vi.restoreAllMocks())

describe('instanceEdition', () => {
  it('is Community when the build installs no feature packages', () => {
    expect(instanceEdition('node', community)).toEqual({ code: 'CE', label: 'Community Edition' })
  })

  it('is Enterprise when a feature package is installed', () => {
    expect(instanceEdition('node', enterprise)).toEqual({ code: 'EE', label: 'Enterprise Edition' })
  })

  it('is Hub only when the deployment declares hub scale on an enterprise build', () => {
    expect(instanceEdition('hub', enterprise)).toEqual({ code: 'HUB', label: 'Enterprise Hub' })
  })

  it('never claims Hub for a community build, whatever the config says', () => {
    expect(instanceEdition('hub', community).code).toBe('CE')
  })

  it('reads the real registry when none is passed', () => {
    expect(instanceEdition('node')).toEqual(instanceEdition('node', FEATURES))
    expect(instanceEdition('node').code).toBe(featureList(FEATURES).length > 0 ? 'EE' : 'CE')
  })
})

describe('warnOnHubWithoutEnterprise', () => {
  it('warns once when a community build declares hub scale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnOnHubWithoutEnterprise('hub', community)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0].join(' ')).toContain('deployment.scale')
  })

  it('stays quiet for a node, and for a hub that is enterprise', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnOnHubWithoutEnterprise('node', community)
    warnOnHubWithoutEnterprise('hub', enterprise)
    expect(warn).not.toHaveBeenCalled()
  })
})
