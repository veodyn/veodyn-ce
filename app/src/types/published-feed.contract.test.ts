// Checked by `pnpm exec tsc --noEmit`, NOT by `vitest run`: expectTypeOf
// compiles to nothing and this file is .test.ts, not .test-d.ts. The same
// caveat is written out in generated/veodyn-api.contract.test.ts.
import { describe, expectTypeOf, it } from 'vitest'
import type { components } from './generated/veodyn-api'
import type {
  EntityNeeds,
  FeedCapabilities,
  PublishAttempt,
  PublishedFeed,
  PublishedFeedInput,
  StandardCapability,
} from './published-feed'

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

  // Keys both ways here too, because the form now reads this shape to decide
  // which of its own sections to render: a field added to the wire and not to
  // ours is a capability the form silently ignores.
  it('a standard capability carries exactly the keys the wire does', () => {
    expectTypeOf<keyof StandardCapability>().toEqualTypeOf<
      keyof components['schemas']['StandardCapabilityOut']
    >()
  })

  it('the entity needs carry every key the wire does', () => {
    expectTypeOf<keyof components['schemas']['EntityNeedsOut']>().toExtend<keyof EntityNeeds>()
  })

  it('the only key beyond the wire is the one a pack declares', () => {
    expectTypeOf<
      Exclude<keyof EntityNeeds, keyof components['schemas']['EntityNeedsOut']>
    >().toEqualTypeOf<'retainedArtifactUnsafe'>()
  })
})
