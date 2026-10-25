import { describe, expect, it } from 'vitest'
import { chatToolContributionFor, contributedResultKind, isContributedTool } from './chat-tools'
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
    expect(isContributedTool('show_kpi', REGISTRY)).toBe(true)
    expect(isContributedTool('list_kpis', REGISTRY)).toBe(true)
    expect(isContributedTool('search_library', REGISTRY)).toBe(false)
    expect(isContributedTool('toString', REGISTRY)).toBe(false)
    expect(contributedResultKind('show_kpi', REGISTRY)).toBe('kpi')
    expect(contributedResultKind('list_kpis', REGISTRY)).toBe('kpi_list')
  })

  it('takes the result kind of a tool only a pack names from the registry', () => {
    const registry: Record<string, FeatureDescriptor> = {
      kpis: {
        id: 'kpis',
        nav: [],
        routes: [],
        chatTools: [{ tool: 'update_kpi', resultKind: 'kpi_edit_check', execute: async () => ({ default: async () => ({ kind: 'kpi_edit_check', ok: true }) }) }],
      },
    }
    expect(isContributedTool('update_kpi', registry)).toBe(true)
    expect(contributedResultKind('update_kpi', registry)).toBe('kpi_edit_check')
    expect(contributedResultKind('update_kpi', {})).toBeUndefined()
  })
})
