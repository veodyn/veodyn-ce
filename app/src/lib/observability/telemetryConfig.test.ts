import { describe, expect, it, vi, afterEach } from 'vitest'
import { doNotTrackEnabled, telemetryEnabled } from './telemetryConfig'

const on = { key: 'phc_x', host: 'https://ph.example', disabled: false }

describe('telemetryEnabled', () => {
  it('is true when a key and host are present and it is not disabled', () => {
    expect(telemetryEnabled(on)).toBe(true)
  })

  it('is false when the key is empty', () => {
    expect(telemetryEnabled({ ...on, key: '' })).toBe(false)
  })

  it('is false when the host is empty', () => {
    expect(telemetryEnabled({ ...on, host: '' })).toBe(false)
  })

  it('is false when explicitly disabled', () => {
    expect(telemetryEnabled({ ...on, disabled: true })).toBe(false)
  })
})

describe('doNotTrackEnabled', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is true when the browser sets doNotTrack', () => {
    vi.stubGlobal('navigator', { doNotTrack: '1' })
    expect(doNotTrackEnabled()).toBe(true)
  })

  it('is false when the browser does not', () => {
    vi.stubGlobal('navigator', { doNotTrack: '0' })
    expect(doNotTrackEnabled()).toBe(false)
  })
})
