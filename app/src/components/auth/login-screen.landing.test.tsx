import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadSafeNextPath(landingPath: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_LANDING_PATH', landingPath)
  return (await import('./login-screen')).safeNextPath
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('safeNextPath with a landing path', () => {
  it('lands on the landing path when there is nowhere else to go', async () => {
    const safeNextPath = await loadSafeNextPath('/home')

    expect(safeNextPath(null)).toBe('/home')
    expect(safeNextPath('https://evil.example/')).toBe('/home')
  })

  it('reads a return to / as a return home, keeping its query', async () => {
    const safeNextPath = await loadSafeNextPath('/home')

    expect(safeNextPath('/?tab=recent')).toBe('/home?tab=recent')
  })

  it('follows any other same-origin path unchanged', async () => {
    const safeNextPath = await loadSafeNextPath('/home')

    expect(safeNextPath('/dashboards/14')).toBe('/dashboards/14')
  })
})
