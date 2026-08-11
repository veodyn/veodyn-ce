import { describe, expect, it } from 'vitest'
import { toLocalLink } from '@/lib/link-utils'

describe('toLocalLink', () => {
  it('rewrites a Redash invite link to the current origin', () => {
    const result = toLocalLink('http://redash:5001/invite/token-123')

    expect(result).toBe(`${window.location.origin}/invite/token-123`)
  })

  it('returns malformed input unchanged', () => {
    const malformedLink = 'not a valid URL'

    expect(toLocalLink(malformedLink)).toBe(malformedLink)
  })
})
