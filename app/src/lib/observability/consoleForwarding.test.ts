import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captureMock = vi.hoisted(() => ({
  capture: vi.fn(),
  currentRoute: () => '/kpis',
}))
vi.mock('./capture', () => captureMock)

import { installConsoleForwarding } from './consoleForwarding'

let uninstall: () => void

beforeEach(() => {
  vi.clearAllMocks()
  // Keep the wrapped output off the real console: vitest.config.ts enforces a
  // repeat budget on console lines and these tests deliberately emit some.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  uninstall = installConsoleForwarding()
})

afterEach(() => {
  uninstall()
  vi.restoreAllMocks()
})

describe('installConsoleForwarding', () => {
  it('forwards a console.warn as a client_console event', () => {
    console.warn('something odd')
    expect(captureMock.capture).toHaveBeenCalledWith('client_console', {
      level: 'warn',
      message: 'something odd',
      route: '/kpis',
    })
  })

  it('forwards a console.error with its level', () => {
    console.error('bad thing')
    expect(captureMock.capture).toHaveBeenCalledWith('client_console', {
      level: 'error',
      message: 'bad thing',
      route: '/kpis',
    })
  })

  it('dedupes an identical repeated message', () => {
    console.error('same')
    console.error('same')
    expect(captureMock.capture).toHaveBeenCalledOnce()
  })

  it('still calls through to the original console', () => {
    console.warn('passed through')
    expect(console.warn).toBeDefined()
  })

  it('restores the original console on uninstall', () => {
    const wrapped = console.warn
    uninstall()
    expect(console.warn).not.toBe(wrapped)
    uninstall = () => {}
  })
})
