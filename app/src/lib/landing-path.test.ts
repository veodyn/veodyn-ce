import { describe, expect, it } from 'vitest'
import { landingPathFrom, landingRedirect } from './landing-path'

describe('landingPathFrom', () => {
  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/home', '/home'],
    ['/start/here', '/start/here'],
    ['home', '/'],
    ['//evil.example', '/'],
    ['/home/', '/'],
    ['https://evil.example/home', '/'],
  ])('reads %s as %s', (raw, expected) => {
    expect(landingPathFrom(raw)).toBe(expected)
  })
})

describe('landingRedirect', () => {
  it('serves / and sends /home to it without the flag', () => {
    expect(landingRedirect('/', '/')).toBeNull()
    expect(landingRedirect('/home', '/')).toBe('/')
  })

  it('sends / to /home when the landing path is /home, and serves /home itself', () => {
    expect(landingRedirect('/', '/home')).toBe('/home')
    expect(landingRedirect('/home', '/home')).toBeNull()
  })

  it('never touches any other path', () => {
    expect(landingRedirect('/dashboards', '/home')).toBeNull()
    expect(landingRedirect('/home/x', '/home')).toBeNull()
  })
})
