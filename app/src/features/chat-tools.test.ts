import { describe, expect, it } from 'vitest'
import { chatToolContributionFor, CONTRIBUTED_RESULT_KIND, isContributedTool } from './chat-tools'
import type { ChatToolContribution } from './chat-tool-types'
import type { FeatureDescriptor } from './types'

const SHOW_KPI: ChatToolContribution = {
  tool: 'show_kpi',
  execute: async () => ({ default: async () => ({ kind: 'kpi', ok: true }) }),
  card: async () => ({ default: () => null }),
  phaseLabel: 'Reading the KPI…',
}

const REGISTRY: Record<string, FeatureDescriptor> = {
  kpis: { id: 'kpis', nav: [], routes: [], chatTools: [SHOW_KPI] },
  reports: { id: 'reports', nav: [], routes: [] },
}

describe('contributed chat tools', () => {
  it('finds the feature that answers for a tool', () => {
    expect(chatToolContributionFor('show_kpi', REGISTRY)).toBe(SHOW_KPI)
  })

  it('finds nothing for a tool nobody contributes, or in a build with no features', () => {
    expect(chatToolContributionFor('list_kpis', REGISTRY)).toBeUndefined()
    expect(chatToolContributionFor('show_kpi', {})).toBeUndefined()
  })

  it('knows which tools are contributed and what each one answers with', () => {
    expect(isContributedTool('show_kpi')).toBe(true)
    expect(isContributedTool('list_kpis')).toBe(true)
    expect(isContributedTool('search_library')).toBe(false)
    expect(isContributedTool('toString')).toBe(false)
    expect(CONTRIBUTED_RESULT_KIND).toEqual({ show_kpi: 'kpi', list_kpis: 'kpi_list' })
  })
})
