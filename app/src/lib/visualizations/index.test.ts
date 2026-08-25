import { describe, expect, it } from 'vitest'
import * as barrel from './index'

// The barrel is the whole plugin API: a plugin may import nothing else from
// the product (src/plugins/plugin-boundary.test.ts). So what it exports is a
// contract, and a formatter dropped from it is a plugin-breaking change that
// nothing in the product itself would notice.
describe('the visualization barrel exposes the date formatters to plugins', () => {
  it('formats a time through the same helper the product uses', () => {
    expect(barrel.formatDate('2026-08-22T14:05:00', 'HH:mm')).toBe('14:05')
    expect(barrel.DEFAULT_TIME_FORMAT).toBe('HH:mm')
  })

  it('resolves a column template', () => {
    expect(barrel.formatColumnTemplate('{{ route }} to {{ @ }}', { route: 'B' }, 'Union')).toBe(
      'B to Union'
    )
  })
})
