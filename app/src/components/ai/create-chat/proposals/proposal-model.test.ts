import { describe, expect, it } from 'vitest'
import { AppError, ErrorIds } from '@/lib/errorIds'
import {
  createErrorMessage,
  defaultDataSourceId,
  isCommunityProposal,
  partialDashboardMessage,
  removeAt,
  widgetPosition,
} from './proposal-model'

// The KPI cases that used to live here moved to
// components/kpi/kpi-proposal-model.test.ts with the code they cover.

describe('isCommunityProposal', () => {
  it('claims the three kinds this build draws itself', () => {
    expect(isCommunityProposal({ kind: 'query' })).toBe(true)
    expect(isCommunityProposal({ kind: 'dashboard' })).toBe(true)
    expect(isCommunityProposal({ kind: 'snippet' })).toBe(true)
  })

  it('disclaims a feature kind and an unknown one alike', () => {
    // Neither is an error here: one goes to the registry and the other is
    // logged and dropped. What matters is that neither reaches the switch.
    expect(isCommunityProposal({ kind: 'kpi' })).toBe(false)
    expect(isCommunityProposal({ kind: 'report' })).toBe(false)
    expect(isCommunityProposal({ kind: 'forecast' })).toBe(false)
  })
})

describe('defaultDataSourceId', () => {
  it('prefers a ClickHouse source over an earlier one of another type', () => {
    expect(
      defaultDataSourceId([
        { id: 7, name: 'Ops', type: 'pg' },
        { id: 3, name: 'Warehouse', type: 'clickhouse' },
      ])
    ).toBe(3)
  })

  it('matches the type case-insensitively and inside a longer name', () => {
    expect(
      defaultDataSourceId([
        { id: 7, name: 'Ops', type: 'pg' },
        { id: 9, name: 'Warehouse', type: 'ClickHouse (HTTP)' },
      ])
    ).toBe(9)
  })

  it('falls back to the first source, then to nothing at all', () => {
    expect(defaultDataSourceId([{ id: 7, name: 'Ops', type: 'pg' }])).toBe(7)
    expect(defaultDataSourceId([])).toBeNull()
  })
})

describe('widgetPosition', () => {
  it('lays widgets out two to a row on the six-column grid', () => {
    expect(widgetPosition(0)).toEqual({ col: 0, row: 0, sizeX: 3, sizeY: 8 })
    expect(widgetPosition(1)).toEqual({ col: 3, row: 0, sizeX: 3, sizeY: 8 })
    expect(widgetPosition(2)).toEqual({ col: 0, row: 8, sizeX: 3, sizeY: 8 })
    expect(widgetPosition(3)).toEqual({ col: 3, row: 8, sizeX: 3, sizeY: 8 })
  })

  it('never overlaps two widgets', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 10; index += 1) {
      const position = widgetPosition(index)
      seen.add(`${position.col}:${position.row}`)
    }
    expect(seen.size).toBe(10)
  })
})

describe('removeAt', () => {
  it('drops one entry by position and leaves the rest in order', () => {
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
    expect(removeAt(['a', 'b', 'c'], 9)).toEqual(['a', 'b', 'c'])
  })
})

describe('partialDashboardMessage', () => {
  it('says nothing when every widget landed', () => {
    expect(partialDashboardMessage([])).toBeNull()
  })

  it('names every widget that did not land', () => {
    const message = partialDashboardMessage(['Ridership', 'Air quality'])
    expect(message).toContain('Ridership')
    expect(message).toContain('Air quality')
    expect(message).toContain('2 widgets')
    // Never phrased as a success: the dashboard opened, the panels did not.
    expect(message).not.toMatch(/created successfully|all widgets/i)
  })

  it('reads as one widget in the singular', () => {
    expect(partialDashboardMessage(['Ridership'])).toContain('1 widget could not')
  })
})

describe('createErrorMessage', () => {
  it('surfaces the registry id of an AppError so a support request can grep it', () => {
    const message = createErrorMessage(
      'query',
      new AppError(ErrorIds.AUTH_FORBIDDEN, 'You may not write to this data source')
    )
    expect(message).toContain('You may not write to this data source')
    expect(message).toContain(ErrorIds.AUTH_FORBIDDEN)
  })

  it('falls back to the plain message, and says nothing without an error', () => {
    expect(createErrorMessage('KPI', new Error('Backend said 503'))).toBe(
      'Could not create this KPI. Backend said 503'
    )
    expect(createErrorMessage('KPI', null)).toBeNull()
  })
})
