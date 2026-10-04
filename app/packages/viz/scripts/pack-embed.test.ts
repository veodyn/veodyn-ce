import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { packEmbedPackages, pinCorePeer } from './pack-embed.mjs'

const coreVersion = JSON.parse(readFileSync('packages/viz/package.json', 'utf8')).version

describe('pinCorePeer', () => {
  it('pins a plugin package to the core version built beside it', () => {
    const manifest = { name: 'plugins', peerDependencies: { '@veodyn/viz': '0.0.0', react: '^19.0.0' } }

    expect(pinCorePeer(manifest, '1.2.3').peerDependencies).toEqual({ '@veodyn/viz': '1.2.3', react: '^19.0.0' })
  })

  it('leaves a package that does not peer on the core alone', () => {
    const manifest = { name: 'other', peerDependencies: { react: '^19.0.0' } }

    expect(pinCorePeer(manifest, '1.2.3')).toEqual(manifest)
  })
})

describe('packEmbedPackages', () => {
  it('packs the core package into the directory the app serves', () => {
    const destination = mkdtempSync(join(tmpdir(), 'veodyn-packages-'))

    const packed = packEmbedPackages(process.cwd(), destination)

    expect(packed).toEqual([`veodyn-viz-${coreVersion}.tgz`])
    const listing = execFileSync('tar', ['-tzf', join(destination, packed[0])], { encoding: 'utf8' }).split('\n')
    expect(listing).toEqual(expect.arrayContaining(['package/package.json', 'package/dist/index.js', 'package/dist/styles.css']))
  }, 120_000)
})
