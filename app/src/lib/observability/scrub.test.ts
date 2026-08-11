import { describe, expect, it } from 'vitest'
import { scrubEvent, scrubProperties } from './scrub'

describe('scrubProperties', () => {
  it('keeps allow-listed shape-only keys', () => {
    const out = scrubProperties({ route: '/dashboards/5', errorId: 'E_UP_003', status: 502 })
    expect(out).toEqual({ route: '/dashboards/5', errorId: 'E_UP_003', status: 502 })
  })

  it('redacts anything not on the allow-list, because it may be query data', () => {
    const out = scrubProperties({ customerName: 'Acme', revenue: 91234 })
    expect(out).toEqual({ customerName: '[redacted]', revenue: '[redacted]' })
  })

  it('passes posthog internal properties through untouched', () => {
    const out = scrubProperties({ $current_url: 'https://x.test/a' })
    expect(out.$current_url).toBe('https://x.test/a')
  })

  // `token` carries the project api_key and has no `$` prefix, so the allow-list
  // redacted it and every event was dropped server-side while capture still
  // answered 200. Nothing else in the suite would have caught that: the payload
  // stayed well-formed and the loss happened after ingestion accepted it.
  it('keeps the ingestion token, which is not $-prefixed and is not optional', () => {
    const out = scrubProperties({ token: 'phc_realprojecttoken', customerName: 'Acme' })
    expect(out.token).toBe('phc_realprojecttoken')
    expect(out.customerName).toBe('[redacted]')
  })

  it('truncates a long message rather than redacting it', () => {
    const out = scrubProperties({ message: 'x'.repeat(400) })
    expect(out.message).toHaveLength(200)
  })

  it('leaves a short message intact', () => {
    expect(scrubProperties({ message: 'Could not load' }).message).toBe('Could not load')
  })
})

describe('scrubEvent', () => {
  it('scrubs an event in place and returns it', () => {
    const event = { properties: { route: '/a', secretValue: 42 } }
    expect(scrubEvent(event)?.properties).toEqual({ route: '/a', secretValue: '[redacted]' })
  })

  it('passes null through, which is how posthog drops an event', () => {
    expect(scrubEvent(null)).toBeNull()
  })

  it('tolerates an event with no properties', () => {
    expect(scrubEvent({})).toEqual({})
  })

  // The end-to-end shape of the bug: a real $pageleave went out with
  // `api_key: "[redacted]"`, was answered 200, and was never stored.
  it('leaves an event still ingestable, token intact, after scrubbing', () => {
    const event = { properties: { token: 'phc_realprojecttoken', $host: 'app.test', rows: 500 } }
    expect(scrubEvent(event)?.properties).toEqual({
      token: 'phc_realprojecttoken',
      $host: 'app.test',
      rows: '[redacted]',
    })
  })
})
