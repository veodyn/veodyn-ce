import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const appRoot = process.cwd()
const readJson = (path: string) => JSON.parse(readFileSync(join(appRoot, path), 'utf8'))

describe('@veodyn/viz package manifest', () => {
  const app = readJson('package.json')
  const pkg = readJson('packages/viz/package.json')
  const appRanges: Record<string, string> = { ...app.dependencies, ...app.devDependencies }

  it('is named, licensed and publishable', () => {
    expect(pkg.name).toBe('@veodyn/viz')
    expect(pkg.license).toBe('AGPL-3.0-only')
    expect(pkg.private).not.toBe(true)
  })

  it('carries the version it is released as, since the served tarball is named by it', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(pkg.version).not.toBe('0.0.0')
  })

  it('names the repository its provenance is signed from', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/veodyn/veodyn-ce.git',
      directory: 'app/packages/viz',
    })
  })

  it('pins every dependency range to the app range', () => {
    for (const [name, range] of Object.entries(pkg.dependencies as Record<string, string>)) {
      expect(appRanges[name], `${name} missing from app/package.json`).toBeDefined()
      expect(range, name).toBe(appRanges[name])
    }
  })

  it('takes any React 19 as a peer, which the app itself is on', () => {
    expect(pkg.peerDependencies.react).toBe('^19.0.0')
    expect(pkg.peerDependencies['react-dom']).toBe('^19.0.0')
    expect(appRanges.react).toMatch(/^19\./)
    expect(appRanges['react-dom']).toMatch(/^19\./)
    expect(pkg.peerDependencies['@tanstack/react-query']).toBe(appRanges['@tanstack/react-query'])
  })

  it('treats react, react-dom and react-query as peers', () => {
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual(['@tanstack/react-query', 'react', 'react-dom'])
  })
})
