import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CORE = '@veodyn/viz'

export function pinCorePeer(manifest, coreVersion) {
  if (!manifest.peerDependencies?.[CORE]) return manifest
  return { ...manifest, peerDependencies: { ...manifest.peerDependencies, [CORE]: coreVersion } }
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

function pack(dir, destination) {
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', destination], { cwd: dir, encoding: 'utf8' })
  )
  return filename
}

export function packEmbedPackages(appRoot, destination) {
  const packagesDir = join(appRoot, 'packages')
  const coreDir = join(packagesDir, 'viz')
  const coreVersion = readJson(join(coreDir, 'package.json')).version
  execFileSync(process.execPath, [join(coreDir, 'scripts/build.mjs'), join(coreDir, 'dist')], { stdio: 'inherit' })

  const pluginDirs = readdirSync(packagesDir)
    .filter((name) => name !== 'viz' && existsSync(join(packagesDir, name, 'build.mjs')))
    .map((name) => join(packagesDir, name))
  for (const dir of pluginDirs) {
    execFileSync(process.execPath, [join(dir, 'build.mjs'), appRoot, join(dir, 'dist')], { stdio: 'inherit' })
    const manifestPath = join(dir, 'package.json')
    writeFileSync(manifestPath, `${JSON.stringify(pinCorePeer(readJson(manifestPath), coreVersion), null, 2)}\n`)
  }

  mkdirSync(destination, { recursive: true })
  return [coreDir, ...pluginDirs].map((dir) => pack(dir, destination))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  for (const filename of packEmbedPackages(appRoot, join(appRoot, 'public/packages'))) console.log(filename)
}
