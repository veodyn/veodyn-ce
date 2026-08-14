// Checked by `pnpm exec tsc --noEmit`, NOT by `vitest run`: expectTypeOf
// compiles to nothing and this file is .test.ts, not .test-d.ts. The same
// caveat is written out in generated/veodyn-api.contract.test.ts.
import { describe, expectTypeOf, it } from 'vitest'
import type { components } from './generated/veodyn-api'
import type { FeedCapabilities, PublishAttempt, PublishedFeed, PublishedFeedInput } from './published-feed'

describe('published-feed contract', () => {
  // Asserted in this direction because the wire widens every enum to `string`,
  // so the wire type does not extend ours. Ours extending the wire's is what
  // catches the drift that matters: a renamed or removed field.
  it('the app feed is a valid PublishedFeedOut', () => {
    expectTypeOf<PublishedFeed>().toExtend<components['schemas']['PublishedFeedOut']>()
  })

  it('the app input is a valid PublishedFeedIn', () => {
    expectTypeOf<PublishedFeedInput>().toExtend<components['schemas']['PublishedFeedIn']>()
  })

  it('the app attempt is a valid PublishAttemptOut', () => {
    expectTypeOf<PublishAttempt>().toExtend<components['schemas']['PublishAttemptOut']>()
  })

  // Keys both ways, so a field ADDED to the wire fails here too.
  it('the feed carries exactly the keys the wire does', () => {
    expectTypeOf<keyof PublishedFeed>().toEqualTypeOf<
      keyof components['schemas']['PublishedFeedOut']
    >()
  })

  it('the attempt carries exactly the keys the wire does', () => {
    expectTypeOf<keyof PublishAttempt>().toEqualTypeOf<
      keyof components['schemas']['PublishAttemptOut']
    >()
  })

  it('the input carries exactly the keys the wire does', () => {
    expectTypeOf<keyof PublishedFeedInput>().toEqualTypeOf<
      keyof components['schemas']['PublishedFeedIn']
    >()
  })

  it('the app capabilities response is a valid FeedCapabilitiesOut', () => {
    expectTypeOf<FeedCapabilities>().toExtend<components['schemas']['FeedCapabilitiesOut']>()
  })

  it('capabilities carries exactly the keys the wire does', () => {
    expectTypeOf<keyof FeedCapabilities>().toEqualTypeOf<
      keyof components['schemas']['FeedCapabilitiesOut']
    >()
  })
})
