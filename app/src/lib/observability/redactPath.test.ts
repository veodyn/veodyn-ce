import { describe, expect, it } from 'vitest'
import { redactPath, redactUrl } from './redactPath'

describe('redactPath', () => {
  it.each([
    ['/reset/abc123', '/reset/[token]'],
    ['/invite/abc123', '/invite/[token]'],
    ['/verify/abc123', '/verify/[token]'],
    ['/dashboards/public/abc123', '/dashboards/public/[token]'],
    ['/embed/public/abc123/widget', '/embed/public/[token]/widget'],
  ])('replaces the credential segment of %s', (path, expected) => {
    expect(redactPath(path)).toBe(expected)
  })

  it.each(['/dashboards/5', '/reset/', '/queries/12/source', '/'])('leaves %s alone', (path) => {
    expect(redactPath(path)).toBe(path)
  })
})

describe('redactUrl', () => {
  it('keeps origin and query string around a redacted path', () => {
    expect(redactUrl('https://app.example/reset/abc123?next=%2F')).toBe('https://app.example/reset/[token]?next=%2F')
  })

  it('redacts a bare path', () => {
    expect(redactUrl('/invite/abc123')).toBe('/invite/[token]')
  })

  it('returns non-token values unchanged', () => {
    expect(redactUrl('https://app.example/dashboards/5')).toBe('https://app.example/dashboards/5')
    expect(redactUrl('web')).toBe('web')
  })
})
