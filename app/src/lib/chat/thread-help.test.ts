import { describe, expect, it } from 'vitest'
import { helpLinkHref, storedHelpLink } from './thread-help'

const INPUT = { page: 'features/queries', section: 'parameters', reason: 'How to add a date filter' }
const RESULT = {
  linked: true,
  page: 'features/queries',
  section: 'parameters',
  pageTitle: 'Queries',
  sectionTitle: 'Parameters',
}

describe('helpLinkHref', () => {
  it('points at the page directory, because the docs site keeps trailing slashes', () => {
    expect(helpLinkHref('https://veodyn.onriits.net/docs', 'features/queries', 'parameters')).toBe(
      'https://veodyn.onriits.net/docs/features/queries/#parameters'
    )
  })

  it('takes the site root for the introduction and tolerates a trailing slash on the base', () => {
    expect(helpLinkHref('https://veodyn.onriits.net/docs/', '', null)).toBe('https://veodyn.onriits.net/docs/')
  })

  it('has no href without a configured docs site', () => {
    expect(helpLinkHref(null, 'features/queries', 'parameters')).toBeNull()
  })
})

describe('storedHelpLink', () => {
  it('rebuilds the card from the stored call and its result', () => {
    expect(storedHelpLink('c1', INPUT, RESULT)).toEqual({
      callId: 'c1',
      page: 'features/queries',
      pageTitle: 'Queries',
      anchor: 'parameters',
      sectionTitle: 'Parameters',
      reason: 'How to add a date filter',
    })
  })

  it('rebuilds a whole-page link', () => {
    const link = storedHelpLink('c1', { page: 'features/queries', reason: 'Queries' }, { ...RESULT, section: null })
    expect(link).toMatchObject({ anchor: null, sectionTitle: null, page: 'features/queries' })
  })

  it('ignores a call the sidecar refused', () => {
    expect(storedHelpLink('c1', INPUT, { error: 'there is no documentation page' })).toBeNull()
    expect(storedHelpLink('c1', INPUT, {})).toBeNull()
  })
})
